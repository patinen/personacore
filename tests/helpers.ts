import { resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { loadKnowledge } from '../src/knowledge.js';
import type { ChatProvider, ProviderInput, ProviderResult } from '../src/providers/provider.js';
export const secret = 'test-server-secret-32-characters-long';
export const config = (overrides: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', KNOWLEDGE_DIR: resolve('knowledge/runtime'), CHAT_BEARER_SECRET: secret, ...overrides });
export const runtime = () => loadKnowledge(resolve('knowledge/runtime'), 30000);
export function provider(generate: (input: ProviderInput) => Promise<ProviderResult> = async () => ({ answer: 'Test answer', sourceIds: ['profile.name'] })): ChatProvider { return { kind: 'openai', generate }; }
export const headers = { authorization: 'Bearer ' + secret };
export const payload = { locale: 'en', message: 'Hello', history: [] };
