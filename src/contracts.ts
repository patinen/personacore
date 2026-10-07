import { z } from 'zod';
import type { Config } from './config.js';
export const modelAnswerSchema = z.object({ answer: z.string(), sourceIds: z.array(z.string()) }).strict();
export type ModelAnswer = z.infer<typeof modelAnswerSchema>;
export function chatRequestSchema(config: Config) {
  const message = z.string().trim().min(1).max(config.MAX_MESSAGE_CHARS);
  return z.object({
    locale: z.enum(['fi', 'en']),
    history: z.array(z.object({ role: z.enum(['visitor', 'assistant']), content: message }).strict()).max(config.MAX_HISTORY_MESSAGES).default([]),
    message,
  }).strict().superRefine((request, ctx) => {
    if (request.history.reduce((total, item) => total + item.content.length, 0) > config.MAX_HISTORY_CHARS) {
      ctx.addIssue({ code: 'custom', path: ['history'], message: 'History character limit exceeded' });
    }
  });
}
export type ChatRequest = z.infer<ReturnType<typeof chatRequestSchema>>;
export type SourceReference = { id: string; title: string; url?: string };
export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
export type ChatResponse = {
  answer: string; sources: SourceReference[]; requestId: string;
  metadata: { durationMs: number; knowledgeVersion: string; instructionsVersion: string; provider: 'openai' | 'fake'; simulated: boolean; usage?: TokenUsage };
};
export type ErrorResponse = { error: { code: string; message: string }; requestId: string };
