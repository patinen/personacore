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
