import Fastify, { LogController, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Config } from './config.js';
import { chatRequestSchema, modelAnswerSchema, type ChatResponse, type TokenUsage } from './contracts.js';
import { loadKnowledge, resolveSources, type Knowledge } from './knowledge.js';
import { instructionsVersion } from './instructions/v2.js';
import { OpenAIProvider } from './providers/openai.js';
import { FakeProvider } from './providers/fake.js';
import { AdmissionDenied, SQLiteUsageStore, validVisitor, visitorHeader, type UsageStore, type Reservation } from './usage.js';
import { ProviderUnavailable, ProviderRejected, type ChatProvider } from './providers/provider.js';
class ServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const hash = (value: string) => createHash('sha256').update(value).digest();
const codes: Record<string, [number, string, string]> = {
  invalid_request: [400, 'invalid_request', 'Invalid request or configured input limit exceeded.'],
  unauthorized: [401, 'unauthorized', 'Valid server bearer authentication is required.'],
  unavailable: [503, 'service_unavailable', 'Chat service is not configured. Contact the service operator.'],
  busy: [503, 'busy', 'Chat capacity is full; retry later.'],
  timeout: [504, 'provider_timeout', 'Chat request exceeded its time limit.'],
  output: [502, 'invalid_provider_output', 'Chat provider returned an invalid answer.'],
  provider: [502, 'provider_error', 'Chat provider could not complete the request.'],
};
function fail(key: keyof typeof codes): never { const [status, code, message] = codes[key]!; throw new ServiceError(status, code, message); }
export async function buildApp(config: Config, options: { provider?: ChatProvider; knowledge?: Knowledge; logger?: FastifyServerOptions['logger']; usageStore?: UsageStore; clock?: () => Date } = {}) {
  if (config.PROVIDER === 'fake' && config.NODE_ENV === 'production') throw new Error('Fake provider is restricted to development/testing');
  const knowledge = options.knowledge ?? await loadKnowledge(config.KNOWLEDGE_DIR, config.MAX_CONTEXT_CHARS);
  if (knowledge.context.length > config.MAX_CONTEXT_CHARS || knowledge.entries.some(e => e.status !== 'published')) throw new Error('Invalid runtime knowledge');
  const provider = options.provider ?? (config.PROVIDER === 'fake' ? new FakeProvider(config.NODE_ENV) : new OpenAIProvider(config));
  if (provider.kind === 'fake' && config.NODE_ENV === 'production') throw new Error('Fake provider is restricted to development/testing');
  const app = Fastify({
    bodyLimit: config.MAX_BODY_BYTES, requestTimeout: config.REQUEST_TIMEOUT_MS, logController: new LogController({ disableRequestLogging: true }),
    // Generate our own IDs: never reflect attacker-controlled request-id headers into logs.
    genReqId: () => randomUUID(), requestIdHeader: false,
    logger: options.logger ?? { level: 'info', redact: ['req.headers.authorization', 'headers.authorization', 'apiKey', 'body', 'conversation', 'knowledge'] },
    trustProxy: false,
  });
  let store: UsageStore | undefined = options.usageStore;
  let databaseFailed = false;
  try { store ??= new SQLiteUsageStore(config); } catch { databaseFailed = true; }
  const clock = options.clock ?? (() => new Date());
  const schema = chatRequestSchema(config);
  const started = new WeakMap<FastifyRequest, number>();
  const usage = new WeakMap<FastifyRequest, TokenUsage>();
  const controllers = new Set<AbortController>();
  let active = 0;
  // One shared fixed-window bucket: this private endpoint serves one trusted portfolio server.
  let windowStart = performance.now();
  let requestsInWindow = 0;
  app.addHook('onRequest', async (request, reply) => {
    started.set(request, performance.now());
    reply.header('x-request-id', request.id).header('cache-control', 'no-store');
  });
  // Bind protection to the registered route so router-supported aliases cannot bypass it.
  const protectChat = async (request: FastifyRequest, reply: FastifyReply) => {
    const now = performance.now();
    if (now - windowStart >= config.RATE_LIMIT_WINDOW_MS) { windowStart = now; requestsInWindow = 0; }
    if (++requestsInWindow > config.RATE_LIMIT_MAX) {
      reply.header('retry-after', Math.max(1, Math.ceil((config.RATE_LIMIT_WINDOW_MS - (now - windowStart)) / 1000)));
      throw new ServiceError(429, 'rate_limited', 'Private service request limit exceeded; retry later.');
    }
    if (!config.CHAT_BEARER_SECRET) fail('unavailable');
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !timingSafeEqual(hash(authorization), hash('Bearer ' + config.CHAT_BEARER_SECRET))) fail('unauthorized');
  };
  app.addHook('onResponse', async (request, reply) => {
    const tokens = usage.get(request);
    app.log.info({ requestId: request.id, status: reply.statusCode, durationMs: Math.round(performance.now() - (started.get(request) ?? performance.now())), ...(tokens ? { usage: tokens } : {}) }, 'request_completed');
    started.delete(request); usage.delete(request);
  });
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof ServiceError;
    const details = (typeof error === 'object' && error !== null ? error : {}) as { code?: string; statusCode?: number };
    const tooLarge = details.code === 'FST_ERR_CTP_BODY_TOO_LARGE';
    const badJson = details.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || details.statusCode === 400;
    const unsupported = details.statusCode === 415;
    const status = known ? error.status : tooLarge ? 413 : badJson ? 400 : unsupported ? 415 : 500;
    reply.code(status).send({ error: { code: known ? error.code : tooLarge ? 'input_too_large' : badJson ? 'invalid_request' : unsupported ? 'unsupported_media_type' : 'internal_error', message: known ? error.message : tooLarge ? 'Request body limit exceeded.' : badJson ? 'Invalid JSON request.' : unsupported ? 'Use application/json.' : 'Internal service error.' }, requestId: request.id });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/v1/chat', { onRequest: protectChat }, async (request, reply): Promise<ChatResponse> => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) fail('invalid_request');
    const visitor = request.headers[visitorHeader];
    if (!validVisitor(visitor)) throw new ServiceError(400, 'invalid_visitor', 'Valid internal visitor identity is required.');
    if (!config.CHAT_ENABLED || databaseFailed || !store || !provider.isAvailable()) fail('unavailable');
    if (active >= config.MAX_CONCURRENCY) { reply.header('retry-after', '1'); fail('busy'); }
    if (performance.now() - (started.get(request) ?? performance.now()) >= config.REQUEST_TIMEOUT_MS) fail('timeout');
    let reservation: Reservation;
    try { reservation = store.reserve(visitor, clock()); } catch (error) {
      if (error instanceof AdmissionDenied) {
        if (error.retryAfter) reply.header('retry-after', error.retryAfter);
        throw new ServiceError(429, error.code, 'Chat usage allowance exceeded.');
      }
      databaseFailed = true; fail('unavailable');
    }
    active++;
    const controller = new AbortController(); controllers.add(controller);
    const start = performance.now();
    let expired = false;
    const disconnected = () => controller.abort();
    reply.raw.on('close', disconnected);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; controller.abort(); reject(new ServiceError(504, 'provider_timeout', 'Chat request exceeded its time limit.')); }, Math.max(1, config.REQUEST_TIMEOUT_MS - (performance.now() - (started.get(request) ?? start))));
    });
    // Slot is held until the underlying call settles, even if it ignores abort.
    const recordMeasuredUsage = (tokens: TokenUsage | undefined) => {
      if (tokens && [tokens.inputTokens, tokens.outputTokens, tokens.totalTokens].every(n => Number.isSafeInteger(n) && n >= 0)) {
        usage.set(request, tokens);
        try { store.recordUsage(reservation, tokens); } catch { databaseFailed = true; fail('unavailable'); }
      }
    };
    const task = Promise.resolve().then(() => provider.generate({ request: parsed.data, knowledge, signal: controller.signal })).then(result => {
      recordMeasuredUsage(result.usage);
      return result;
    }, (error: unknown) => {
      if (error instanceof ProviderRejected) recordMeasuredUsage(error.usage);
      throw error;
    });
    const tracked = task.finally(() => { active--; controllers.delete(controller); });
    try {
      const result = await Promise.race([tracked, deadline]);
      const answer = modelAnswerSchema.safeParse({ answer: result.answer, sourceIds: result.sourceIds });
      if (!answer.success || !answer.data.answer.trim() || answer.data.answer.length > config.MAX_OUTPUT_CHARS || answer.data.sourceIds.length > 20) fail('output');
      // Citations are separate server-owned metadata. Reject provider-authored links.
      if (/https?:|www\.|\[[^\]]*\]\(|<\s*a\b|(?:javascript|data|ftp|file|mailto):/i.test(answer.data.answer)) fail('output');
      let sources;
      try { sources = resolveSources(answer.data.sourceIds, knowledge); } catch { fail('output'); }
      try { store.recordSuccess(reservation); } catch { databaseFailed = true; fail('unavailable'); }
      return { answer: answer.data.answer, sources, requestId: request.id, metadata: {
        durationMs: Math.round(performance.now() - start), knowledgeVersion: knowledge.version,
        instructionsVersion, provider: provider.kind, simulated: provider.kind === 'fake',
        ...(usage.has(request) ? { usage: usage.get(request)! } : {}),
      } };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (expired) fail('timeout');
      if (error instanceof ProviderUnavailable) fail('unavailable');
      fail('provider');
    } finally {
      clearTimeout(timer); reply.raw.off('close', disconnected);
    }
  });
  app.addHook('onClose', async () => { try { store?.close(); } catch { /* No raw database details in logs. */ } });
  app.addHook('preClose', async () => { for (const controller of controllers) controller.abort(); });
  return app;
}
