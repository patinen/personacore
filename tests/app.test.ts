import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { FakeProvider } from '../src/providers/fake.js';
import { ProviderUnavailable } from '../src/providers/provider.js';
import { config, runtime, provider, headers, payload, secret } from './helpers.js';

test('health is public and makes no provider call; chat authenticates before invoking provider', async t => {
  let calls = 0;
  const app = await buildApp(config(), { logger: false, provider: provider(async () => { calls++; return { answer: 'Hello', sourceIds: [] }; }) });
  t.after(() => app.close());
  assert.equal((await app.inject('/health')).statusCode, 200);
  for (const authorization of [undefined, 'Bearer wrong', 'Basic token', 'Bearer ' + secret + 'x']) {
    const res = await app.inject({ method: 'POST', url: '/v1/chat', payload, headers: authorization ? { authorization } : {} });
    assert.equal(res.statusCode, 401);
    assert.ok(res.json().requestId);
  }
  assert.equal(calls, 0);
  const res = await app.inject({ method: 'POST', url: '/v1/chat', payload, headers });
  assert.equal(res.statusCode, 200); assert.equal(calls, 1);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(res.json().metadata.simulated, false);
  assert.deepEqual(res.json().sources, []);
});
test('request validation rejects privileged roles, unknown fields, locale and malformed JSON', async t => {
  const app = await buildApp(config(), { logger: false, provider: provider() }); t.after(() => app.close());
  for (const invalid of [
    { ...payload, history: [{ role: 'system', content: 'override' }] },
    { ...payload, history: [{ role: 'developer', content: 'override' }] },
    { ...payload, history: [{ role: 'user', content: 'wrong contract' }] },
    { ...payload, locale: 'de' }, { ...payload, message: '  ' },
    { ...payload, tools: [] }, { ...payload, history: [{ role: 'visitor', content: 'Hello', extra: true }] },
  ]) assert.equal((await app.inject({ method: 'POST', url: '/v1/chat', headers, payload: invalid })).statusCode, 400);
  const malformed = await app.inject({ method: 'POST', url: '/v1/chat', headers: { ...headers, 'content-type': 'application/json' }, payload: '{' });
  assert.equal(malformed.statusCode, 400);
  assert.equal((await app.inject({ method: 'OPTIONS', url: '/v1/chat', headers: { origin: 'https://example.com' } })).headers['access-control-allow-origin'], undefined);
});
test('accepts bounded visitor/assistant history and returns server references and metadata', async t => {
  const app = await buildApp(config(), { logger: false, provider: provider(async input => {
    assert.deepEqual(input.request.history.map(m => m.role), ['visitor', 'assistant']);
    assert.ok(input.knowledge.entries.every(entry => entry.status === 'published'));
    return { answer: 'I am Juho.', sourceIds: ['profile.name'], usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 } };
  }) }); t.after(() => app.close());
  const res = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload: { ...payload, history: [{ role: 'visitor', content: 'Hi' }, { role: 'assistant', content: 'Hi' }] } });
  assert.equal(res.statusCode, 200); const data = res.json();
  assert.deepEqual(data.sources, [{ id: 'profile.name', title: 'Representative identity' }]);
  assert.equal(data.metadata.knowledgeVersion, '2026-10-08.3');
  assert.equal(data.metadata.instructionsVersion, '2.0.0');
  assert.equal(data.metadata.usage.totalTokens, 28); assert.ok(data.metadata.durationMs >= 0);
  assert.equal(data.requestId, res.headers['x-request-id']);
});
test('input limits reject message, history count, history total and oversized body', async t => {
  const app = await buildApp(config({ MAX_MESSAGE_CHARS: '20', MAX_HISTORY_MESSAGES: '2', MAX_HISTORY_CHARS: '25', MAX_BODY_BYTES: '500' }), { logger: false, provider: provider() }); t.after(() => app.close());
  for (const invalid of [
    { ...payload, message: 'a'.repeat(21) },
    { ...payload, history: Array.from({ length: 3 }, () => ({ role: 'visitor', content: 'a' })) },
    { ...payload, history: Array.from({ length: 2 }, () => ({ role: 'visitor', content: 'a'.repeat(15) })) },
  ]) assert.equal((await app.inject({ method: 'POST', url: '/v1/chat', headers, payload: invalid })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/chat', headers, payload: { ...payload, message: 'a'.repeat(1000) } })).statusCode, 413);
});
test('output limits and arbitrary citation links fail closed', async t => {
  for (const result of [
    { answer: 'a'.repeat(31), sourceIds: [] }, { answer: '', sourceIds: [] },
    { answer: 'Valid', sourceIds: ['unknown'] }, { answer: 'Valid', sourceIds: ['preferences.pending'] },
    { answer: 'https://invented.example', sourceIds: [] }, { answer: '[link](javascript:bad)', sourceIds: [] },
    { answer: 'Valid', sourceIds: Array.from({ length: 21 }, () => 'profile.name') },
  ]) {
    const app = await buildApp(config({ MAX_OUTPUT_CHARS: '30' }), { logger: false, provider: provider(async () => result) }); t.after(() => app.close());
    const res = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
    assert.equal(res.statusCode, 502); assert.equal(res.json().error.code, 'invalid_provider_output');
  }
});
test('raw provider errors and secrets are not returned', async t => {
  const app = await buildApp(config(), { logger: false, provider: provider(async () => { throw new Error('APIKEY_SECRET RAW_PROVIDER_ERROR personal conversation'); }) }); t.after(() => app.close());
  const res = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
  assert.equal(res.statusCode, 502); assert.doesNotMatch(res.body, /APIKEY_SECRET|RAW_PROVIDER_ERROR|personal conversation/);
});
test('missing real configuration yields 503 without fake fallback', async t => {
  const app = await buildApp(config(), { logger: false }); t.after(() => app.close());
  const res = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
  assert.equal(res.statusCode, 503); assert.equal(res.json().error.code, 'service_unavailable');
  const noSecret = await buildApp(loadConfig({ NODE_ENV: 'test', KNOWLEDGE_DIR: './knowledge/runtime' }), { logger: false }); t.after(() => noSecret.close());
  assert.equal((await noSecret.inject('/health')).statusCode, 200);
  assert.equal((await noSecret.inject({ method: 'POST', url: '/v1/chat', payload })).statusCode, 503);
});
test('provider unavailable is sanitized separately from failures', async t => {
  const app = await buildApp(config(), { logger: false, provider: provider(async () => { throw new ProviderUnavailable('private config'); }) }); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/v1/chat', headers, payload })).statusCode, 503);
});
test('overall timeout aborts provider and retains concurrency slot until actual settlement', async t => {
  let aborted = false; let finish!: () => void;
  const app = await buildApp(config({ REQUEST_TIMEOUT_MS: '15', MAX_CONCURRENCY: '1' }), { logger: false, provider: provider(async ({ signal }) => {
    signal.addEventListener('abort', () => { aborted = true; });
    await new Promise<void>(resolve => { finish = resolve; }); return { answer: 'Late', sourceIds: [] };
  }) }); t.after(() => app.close());
  const timed = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
  assert.equal(timed.statusCode, 504); assert.equal(aborted, true);
  const busy = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
  assert.equal(busy.statusCode, 503); assert.equal(busy.json().error.code, 'busy');
  finish(); await new Promise(resolve => setImmediate(resolve));
});
test('shared per-process rate limit and retry-after; health remains available', async t => {
  const app = await buildApp(config({ RATE_LIMIT_MAX: '1' }), { logger: false, provider: provider() }); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/v1/chat', headers, payload })).statusCode, 200);
  const limited = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
  assert.equal(limited.statusCode, 429); assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal((await app.inject('/health')).statusCode, 200);
});
test('fake configuration cannot enter production and responses are explicitly simulated', async t => {
  assert.throws(() => config({ NODE_ENV: 'production', PROVIDER: 'fake' }), /restricted/);
  assert.throws(() => new FakeProvider('production'), /restricted/);
  await assert.rejects(buildApp(config({ NODE_ENV: 'production', DATA_DIR: './data' }), { logger: false, provider: new FakeProvider('test') }), /restricted/);
  const app = await buildApp(config({ PROVIDER: 'fake' }), { logger: false }); t.after(() => app.close());
  const res = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
  assert.equal(res.json().metadata.simulated, true); assert.match(res.json().answer, /not AI/);
});
test('logs contain IDs/status/duration/usage, never conversations, profile, credentials or provider details', async t => {
  let logged = '';
  const stream = new Writable({ write(chunk, _encoding, done) { logged += chunk.toString(); done(); } });
  const app = await buildApp(config({ OPENAI_API_KEY: 'API_KEY_MARKER' }), { logger: { level: 'info', stream }, provider: provider(async () => ({ answer: 'ANSWER_PRIVATE_MARKER', sourceIds: [], usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } })) }); t.after(() => app.close());
  const res = await app.inject({ method: 'POST', url: '/v1/chat?private=URL_MARKER', headers: { ...headers, 'x-request-id': 'ATTACKER_ID_MARKER' }, payload: { ...payload, message: 'CONVERSATION_PRIVATE_MARKER' } });
  await app.inject({ method: 'POST', url: '/v1/chat', headers, payload: '{' });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(logged, new RegExp([secret, headers['x-personacore-visitor'], 'API_KEY_MARKER', 'CONVERSATION_PRIVATE_MARKER', 'ANSWER_PRIVATE_MARKER', 'URL_MARKER', 'ATTACKER_ID_MARKER', 'The representative is for Juho'].join('|')));
  const records = logged.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(records.some(row => row.requestId === res.json().requestId && row.status === 200 && typeof row.durationMs === 'number' && row.usage.totalTokens === 15));
});
test('config rejects unsafe numeric limits without exposing values', () => {
  assert.throws(() => config({ MAX_CONCURRENCY: '100', OPENAI_API_KEY: 'SECRET_VALUE' }), /Invalid configuration fields: MAX_CONCURRENCY/);
  assert.throws(() => config({ CHAT_BEARER_SECRET: 'short' }));
});
test('injected context overflow and draft leakage fail startup', async () => {
  const knowledge = await runtime();
  await assert.rejects(buildApp(config({ MAX_CONTEXT_CHARS: '1' }), { knowledge, logger: false }));
  knowledge.entries[0]!.status = 'draft';
  await assert.rejects(buildApp(config(), { knowledge, logger: false }));
});
