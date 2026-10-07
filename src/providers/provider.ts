import type { ChatRequest, ModelAnswer, TokenUsage } from '../contracts.js';
import type { Knowledge } from '../knowledge.js';
export type ProviderInput = { request: ChatRequest; knowledge: Knowledge; signal: AbortSignal };
export type ProviderResult = ModelAnswer & { usage?: TokenUsage };
export interface ChatProvider {
  readonly kind: 'openai' | 'fake';
  isAvailable(): boolean;
  generate(input: ProviderInput): Promise<ProviderResult>;
}
export class ProviderUnavailable extends Error {}

// Carries only measured counters, never provider output or error details.
export class ProviderRejected extends Error {
  constructor(readonly usage?: TokenUsage) { super('Provider answer rejected'); }
}
