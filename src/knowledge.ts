import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import type { SourceReference } from './contracts.js';
export class KnowledgeConfigurationError extends Error {}
export const safeUrl = z.string().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return value.startsWith('https://') && url.protocol === 'https:' && !url.username && !url.password && !/[\u0000-\u0020\u007f]/.test(value);
  } catch { return false; }
}, 'Sources must use HTTPS without credentials or control characters');
const id = z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/);
const metadata = z.object({
  kind: z.enum(['owner', 'project-documentation', 'editorial']),
  reference: z.string().min(1).max(500),
  url: safeUrl.optional(),
}).strict();
const review = z.object({ reviewedBy: z.string().min(1), reviewedAt: z.iso.date() }).strict();
const base = z.object({
  id, title: z.string().min(1).max(200), content: z.string().max(12000),
  status: z.enum(['draft', 'published']), source: metadata, review: review.optional(),
});
const ordinary = base.extend({ category: z.enum(['profile', 'working_style', 'preferences', 'services']) });
const skill = base.extend({ category: z.literal('skills'), technology: z.string().min(1), experience: z.string().max(4000), independence: z.string().max(2000), evidence: z.array(z.string().min(1)).max(20), limitations: z.array(z.string().min(1)).max(20) });
const project = base.extend({ category: z.literal('projects'), projectSlug: id, section: z.enum(['overview', 'architecture', 'system_flow', 'engineering', 'implementation', 'interface']) });
const voice = base.extend({ category: z.literal('voice'), style: z.object({ concise: z.boolean(), tone: z.string().min(1).max(1000), languages: z.array(z.enum(['fi', 'en'])).min(1) }).strict() });
export const entrySchema = z.discriminatedUnion('category', [ordinary.strict(), skill.strict(), project.strict(), voice.strict()]).superRefine((entry, ctx) => {
  if (entry.status === 'published' && (!entry.content.trim() || !entry.review)) ctx.addIssue({ code: 'custom', message: 'Published entries require content and owner review metadata' });
  if (entry.status === 'published' && entry.category === 'skills' && (!entry.experience.trim() || !entry.independence.trim() || !entry.evidence.length)) ctx.addIssue({ code: 'custom', message: 'Published skills require experience, independence, and evidence' });
});
export const packSchema = z.object({
  schemaVersion: z.literal(1), version: z.string().min(1).max(80),
  purpose: z.enum(['runtime', 'example', 'test']), entries: z.array(entrySchema).max(500),
}).strict().superRefine((pack, ctx) => {
  if (new Set(pack.entries.map(e => e.id)).size !== pack.entries.length) ctx.addIssue({ code: 'custom', message: 'Duplicate entry IDs' });
});
export type Entry = z.infer<typeof entrySchema>;
export type Knowledge = { version: string; entries: Entry[]; context: string };
export function prepareKnowledge(data: unknown, maxContextChars: number, allowSynthetic = false): Knowledge {
  const validated = packSchema.safeParse(data);
  if (!validated.success) throw new KnowledgeConfigurationError('Invalid knowledge fields: ' + validated.error.issues.map(issue => issue.path.join('.')).join(', '));
  const pack = validated.data;
  if (pack.purpose !== 'runtime' && !allowSynthetic) throw new KnowledgeConfigurationError('Runtime knowledge must have purpose runtime; examples and synthetic fixtures are forbidden.');
  const entries = pack.entries.filter(entry => entry.status === 'published');
  // Return only the filtered pack: draft content never reaches the prompt builder.
  const context = JSON.stringify(entries);
  if (context.length > maxContextChars) throw new KnowledgeConfigurationError('Published knowledge exceeds MAX_CONTEXT_CHARS. Review the pack or explicitly raise the configured budget; no entries were dropped.');
  return { version: pack.version, entries, context };
}
export async function loadKnowledge(directory: string, maxContextChars: number): Promise<Knowledge> {
  // Exactly one named file, no recursive discovery, no symlink to an unrelated file.
  const basePath = await realpath(resolve(directory));
  const file = resolve(basePath, 'pack.json');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000 || dirname(await realpath(file)) !== basePath) throw new KnowledgeConfigurationError('Invalid knowledge pack file');
  return prepareKnowledge(JSON.parse(await readFile(file, 'utf8')) as unknown, maxContextChars);
}
export function resolveSources(ids: string[], knowledge: Knowledge): SourceReference[] {
  if (ids.length > 20) throw new Error('Too many source IDs');
  return [...new Set(ids)].map(sourceId => {
    const entry = knowledge.entries.find(e => e.id === sourceId);
    if (!entry) throw new Error('Unknown source ID');
    const result: SourceReference = { id: entry.id, title: entry.title };
    if (entry.source.url) result.url = safeUrl.parse(entry.source.url);
    return result;
  });
}
