import { z } from 'zod';
const number = (fallback: number, max: number) => z.coerce.number().int().positive().max(max).default(fallback);
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: number(3001, 65535),
  CHAT_ENABLED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  DATA_DIR: z.string().min(1).optional(),
  DAILY_ATTEMPT_CAP: number(100, 100000),
  VISITOR_DAILY_ALLOWANCE: number(10, 10000),
  VISITOR_RATE_MAX: number(5, 1000),
  VISITOR_RATE_WINDOW_MS: number(60000, 3600000),
  USAGE_RETENTION_DAYS: number(14, 90),
  KNOWLEDGE_DIR: z.string().min(1),
  CHAT_BEARER_SECRET: z.string().min(32).optional(),
  PROVIDER: z.enum(['openai', 'fake']).default('openai'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  MAX_MESSAGE_CHARS: number(4000, 20000),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(40).default(12),
  MAX_HISTORY_CHARS: number(16000, 100000),
  MAX_CONTEXT_CHARS: number(30000, 200000),
  MAX_OUTPUT_CHARS: number(4000, 20000),
  MAX_OUTPUT_TOKENS: number(1000, 8000),
  REQUEST_TIMEOUT_MS: number(20000, 120000),
  MAX_CONCURRENCY: number(4, 32),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(0),
  RATE_LIMIT_MAX: number(30, 10000),
  RATE_LIMIT_WINDOW_MS: number(60000, 3600000),
  MAX_BODY_BYTES: number(32768, 262144),
  SHUTDOWN_TIMEOUT_MS: number(25000, 150000),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error('Invalid configuration fields: ' + result.error.issues.map(i => i.path.join('.')).join(', '));
  const config = result.data;
  if (config.PROVIDER === 'fake' && config.NODE_ENV === 'production') throw new Error('Fake provider is restricted to development/testing.');
  if (config.OPENAI_MAX_RETRIES !== 0) throw new Error('Attempt controls require OPENAI_MAX_RETRIES=0.');
  if (config.NODE_ENV === 'production' && !config.DATA_DIR) throw new Error('Production requires DATA_DIR on a persistent volume.');
  return config;
}
