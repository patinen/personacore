import { z } from 'zod';
import type { Config } from '../src/config.js';
import { chatRequestSchema } from '../src/contracts.js';
export const casesSchema = z.array(z.object({
  id: z.string().min(1), pack: z.enum(['runtime', 'synthetic', 'documentation']), locale: z.enum(['fi', 'en']),
  message: z.string(), history: z.array(z.object({ role: z.enum(['visitor', 'assistant']), content: z.string() })).optional(), expect: z.string().min(1),
}).strict()).refine(cases => new Set(cases.map(c => c.id)).size === cases.length);
export function selectCases(cases: z.infer<typeof casesSchema>, synthetic: boolean, ids?: string[], documentation = false) {
  const eligible = cases.filter(c => c.pack === (documentation ? 'documentation' : synthetic ? 'synthetic' : 'runtime'));
  if (ids && (ids.length === 0 || ids.some(id => !eligible.some(c => c.id === id)))) throw new Error('Unknown or incompatible selected cases');
  return ids ? eligible.filter(c => ids.includes(c.id)) : eligible;
}
export function admissionPlan(config: Config, count: number, used = 0, paceMs?: number) {
  const minimumPaceMs = Math.max(Math.ceil(config.VISITOR_RATE_WINDOW_MS / config.VISITOR_RATE_MAX), Math.ceil(config.RATE_LIMIT_WINDOW_MS / config.RATE_LIMIT_MAX)) + 1;
  const pace = paceMs ?? minimumPaceMs;
  const blockers: string[] = [];
  if (!count) blockers.push('Select at least one case.');
  if (!config.CHAT_ENABLED) blockers.push('CHAT_ENABLED must be explicitly true for paid evaluation.');
  if (count > config.VISITOR_DAILY_ALLOWANCE) blockers.push('Selected cases exceed VISITOR_DAILY_ALLOWANCE; select fewer cases or explicitly configure a suitable evaluation allowance.');
  if (count > config.DAILY_ATTEMPT_CAP - used) blockers.push('Selected cases exceed remaining aggregate allowance.');
  if (!Number.isSafeInteger(pace) || pace < minimumPaceMs) blockers.push('Pacing is below the configured rate-window requirement.');
  return { count, timezone: 'Europe/Helsinki', aggregateUsed: used, aggregateRemaining: config.DAILY_ATTEMPT_CAP - used, visitorAllowance: config.VISITOR_DAILY_ALLOWANCE, minimumPaceMs, paceMs: pace, blockers };
}
export function validateCases(cases: z.infer<typeof casesSchema>, config: Config) {
  for (const item of cases) chatRequestSchema(config).parse({ locale: item.locale, history: item.history ?? [], message: item.message });
}
