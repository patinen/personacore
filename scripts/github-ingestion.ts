import { createHash } from 'node:crypto';
import { z } from 'zod';
import { entrySchema, githubProvenanceSchema, packSchema, prepareKnowledge } from '../src/knowledge.js';
export const repositories = ['patinen/secureshare', 'patinen/projectpulse', 'patinen/statuscore', 'patinen/personacore'] as const;
export const sourceSchema = z.object({
  id: z.string().regex(/^docs\.[a-z0-9.-]+$/).max(80), repository: z.enum(repositories),
  branch: z.string().regex(/^[a-zA-Z0-9._/-]+$/).max(100),
  path: z.string().regex(/^(README\.md|docs\/[a-zA-Z0-9._-]+\.md)$/),
  heading: z.string().min(1).max(200), projectSlug: z.string().regex(/^[a-z][a-z0-9-]+$/),
  section: z.enum(['overview', 'architecture', 'system_flow', 'engineering', 'implementation', 'interface']),
}).strict();
export const manifestSchema = z.object({ version: z.literal(1), sources: z.array(sourceSchema).min(1).max(20) }).strict()
  .refine(m => new Set(m.sources.map(s => s.id)).size === m.sources.length, 'Duplicate source IDs')
  .refine(m => new Set(m.sources.map(s => s.repository + '/' + s.path + '#' + s.heading)).size === m.sources.length, 'Duplicate source selection');
export type Source = z.infer<typeof sourceSchema>;
export const batchSchema = z.object({
  version: z.literal(1), purpose: z.literal('github-drafts'), retrievedAt: z.iso.datetime(),
  results: z.array(z.object({
    source: sourceSchema, commitSha: z.string().regex(/^[a-f0-9]{40}$/).optional(),
    status: z.enum(['available', 'removed', 'oversized', 'selection_missing', 'failed']),
    note: z.string(), candidate: entrySchema.optional(),
  }).strict()).max(20),
}).strict().refine(b => new Set(b.results.map(r => r.source.id)).size === b.results.length);
export type Batch = z.infer<typeof batchSchema>;
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
class FetchFailure extends Error {
  constructor(readonly status?: number) { super('Documentation request failed'); }
}
export async function boundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new FetchFailure();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new Error('oversized');
      parts.push(part.value);
    }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(joined);
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
// Exact heading, outside fenced code; never follows links or interprets directives.
export function extractSection(markdown: string, heading: string): string | undefined {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let fence: string | undefined, start = -1, level = 0;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (fence === marker[0]) fence = undefined; continue; }
    if (fence) continue;
    const match = /^(#{1,6}) +(.+?) *#* *$/.exec(line);
    if (!match) continue;
    if (start >= 0 && match[1]!.length <= level) return lines.slice(start, index).join('\n').trim();
    if (start < 0 && match[2] === heading) { start = index; level = match[1]!.length; }
  }
  return start < 0 ? undefined : lines.slice(start).join('\n').trim();
}
export async function fetchDrafts(sources: Source[], allowlist: Source[], options: {
  fetch?: typeof fetch; now?: () => Date; timeoutMs?: number; maxDocumentBytes?: number; maxCandidateChars?: number;
} = {}): Promise<Batch> {
  const transport = options.fetch ?? fetch;
  const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
  if (!sources.length || sources.length > 20) throw new Error('Invalid source selection');
  for (const source of sources) {
    sourceSchema.parse(source);
    if (!allowlist.some(allowed => JSON.stringify(sourceSchema.parse(allowed)) === JSON.stringify(sourceSchema.parse(source)))) throw new Error('Source is not exactly allowlisted');
  }
  const request = async (url: string, bytes: number, missing = false) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    try {
      const response = await transport(url, { headers: { Accept: url.includes('api.github.com') ? 'application/vnd.github+json' : 'text/plain', 'User-Agent': 'PersonaCore-reviewed-docs' }, signal: controller.signal, redirect: 'error' });
      if (missing && response.status === 404) { await response.body?.cancel(); throw new FetchFailure(404); }
      if (!response.ok) { await response.body?.cancel(); throw new FetchFailure(response.status); }
      return await boundedText(response, bytes);
    } finally { clearTimeout(timer); controller.abort(); }
  };
  const revisions = new Map<string, string>();
  const results: Batch['results'] = [];
  for (const source of sources) {
    let commitSha: string | undefined;
    try {
      const key = source.repository + '@' + source.branch;
      commitSha = revisions.get(key);
      if (!commitSha) {
        const repo = z.object({ private: z.literal(false) }).parse(JSON.parse(await request('https://api.github.com/repos/' + source.repository, 200000)));
        void repo;
        const commit = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }).parse(JSON.parse(await request('https://api.github.com/repos/' + source.repository + '/commits/' + encodeURIComponent(source.branch), 200000)));
        commitSha = commit.sha; revisions.set(key, commitSha);
      }
      const text = await request('https://raw.githubusercontent.com/' + source.repository + '/' + commitSha + '/' + source.path, options.maxDocumentBytes ?? 65536, true);
      const content = extractSection(text, source.heading);
      if (!content) { results.push({ source, commitSha, status: 'selection_missing', note: 'Exact heading absent. Review selection; no retirement inferred.' }); continue; }
      const candidate = entrySchema.parse({
        id: source.id, category: 'projects', projectSlug: source.projectSlug, section: source.section,
        title: source.projectSlug + ': ' + source.heading, content: content.length > (options.maxCandidateChars ?? 6000) ? '' : content, status: 'draft',
        source: { kind: 'project-documentation', reference: 'GitHub documentation; untrusted reference, not personal proficiency evidence',
          url: 'https://github.com/' + source.repository + '/blob/' + commitSha + '/' + source.path,
          github: { repository: source.repository, path: source.path, commitSha, retrievedAt, documentHash: digest(text), heading: source.heading } },
      });
      if (content.length > (options.maxCandidateChars ?? 6000)) {
        results.push({ source, commitSha, status: 'oversized', note: 'Selected section exceeds candidate limit. Review immutable document and supply a manual summary; nothing truncated.', candidate: entrySchema.parse({ ...candidate, content: '' }) });
        continue;
      }
      results.push({ source, commitSha, status: 'available', note: 'Draft only; review claims, instructions, links and size before promotion.', candidate });
    } catch (error) {
      const status = error instanceof FetchFailure && error.status === 404 && commitSha ? 'removed' : error instanceof Error && error.message === 'oversized' ? 'oversized' : 'failed';
      results.push({ source, ...(commitSha ? { commitSha } : {}), status, note: status === 'removed' ? '404 at resolved revision; explicit reviewed retirement required.' : status === 'oversized' ? 'Document exceeds byte limit; narrow upstream document or manually curate; nothing truncated.' : 'Fetch/validation failed; no source removal inferred.' });
    }
  }
  return batchSchema.parse({ version: 1, purpose: 'github-drafts', retrievedAt, results });
}
export function promote(rawPack: unknown, rawBatch: unknown, allowlist: Source[], options: {
  id: string; reviewer: string; reviewDate: string; version: string; maxContextChars?: number; summary?: string; retire?: boolean;
}) {
  const pack = packSchema.parse(rawPack), batch = batchSchema.parse(rawBatch);
  z.string().trim().min(1).max(200).parse(options.reviewer);
  z.iso.date().parse(options.reviewDate);
  if (options.reviewDate < batch.retrievedAt.slice(0, 10) || options.reviewDate > new Date().toISOString().slice(0, 10)) throw new Error('Review date must cover retrieval and not be in the future');
  if (!options.version.trim() || options.version === pack.version) throw new Error('A new pack version is required');
  if (pack.purpose !== 'runtime') throw new Error('Only runtime pack may be promoted');
  const result = batch.results.find(r => r.source.id === options.id);
  if (!result || !allowlist.some(s => JSON.stringify(sourceSchema.parse(s)) === JSON.stringify(result.source))) throw new Error('Candidate is not exactly allowlisted');
  const old = pack.entries.find(e => e.id === options.id);
  if (pack.entries.some(e => e.id !== options.id && e.source.github?.repository === result.source.repository && e.source.github.path === result.source.path && e.source.github.heading === result.source.heading)) throw new Error('Conflicting published source ID');

  if (old && (!old.source.github || old.category !== 'projects' ||
    old.source.github.repository !== result.source.repository || old.source.github.path !== result.source.path || old.source.github.heading !== result.source.heading)) throw new Error('Stable ID conflict; owner knowledge cannot be replaced');
  if (old?.source.github && old.source.github.retrievedAt > batch.retrievedAt) throw new Error('Stale candidate batch');
  const review = { reviewedBy: options.reviewer.trim(), reviewedAt: options.reviewDate };
  let change: string;
  let replacement;
  if (options.retire) {
    if (result.status !== 'removed' || !old || !result.commitSha) throw new Error('Retirement requires reviewed 404 at immutable revision and existing imported entry');
    replacement = entrySchema.parse({ ...old, status: 'draft', review });
    change = 'retired';
  } else {
    if ((result.status !== 'available' && !(result.status === 'oversized' && options.summary)) || !result.candidate) throw new Error('No promotable candidate; narrow selection or prepare a reviewed draft');
    const candidate = result.candidate, github = githubProvenanceSchema.parse(candidate.source.github);
    if (candidate.id !== options.id || candidate.category !== 'projects' || candidate.projectSlug !== result.source.projectSlug ||
      candidate.section !== result.source.section || candidate.status !== 'draft' || candidate.review ||
      github.repository !== result.source.repository || github.path !== result.source.path || github.heading !== result.source.heading ||
      github.commitSha !== result.commitSha || github.retrievedAt !== batch.retrievedAt) throw new Error('Candidate provenance mismatch');
    replacement = entrySchema.parse({ ...candidate, content: options.summary ?? candidate.content, status: 'published', review });
    change = old ? old.source.github?.documentHash === github.documentHash ? 'same-source' : 'updated' : 'added';
  }
  const next = packSchema.parse({ ...pack, version: options.version, entries: [...pack.entries.filter(e => e.id !== options.id), replacement] });
  const knowledge = prepareKnowledge(next, options.maxContextChars ?? 30000);
  return { pack: next, change, publishedEntries: knowledge.entries.length, contextChars: knowledge.context.length };
}
