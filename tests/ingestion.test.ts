import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { manifestSchema, fetchDrafts, promote, extractSection, boundedText, digest, type Source } from '../scripts/github-ingestion.js';
import { prepareKnowledge, packSchema } from '../src/knowledge.js';
const manifest = manifestSchema.parse(JSON.parse(await readFile('ingestion/sources.json', 'utf8')));
const source = manifest.sources[0]!;
const sha = 'a'.repeat(40), nextSha = 'b'.repeat(40);
const text = await readFile('tests/fixtures/ingestion/architecture.md', 'utf8');
const now = () => new Date('2026-10-08T12:00:00Z');
const rawPack = () => JSON.parse(JSON.stringify({ schemaVersion: 1, purpose: 'runtime', version: 'before', entries: [] }));
const review = { id: source.id, reviewer: 'Local fixture reviewer', reviewDate: '2026-10-08', version: 'after' };
function mock(content = text, revision = sha, rawStatus = 200) {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); urls.push(url);
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    if (url.endsWith('/commits/main')) return Response.json({ sha: revision });
    if (url.startsWith('https://api.github.com/')) return Response.json({ private: false });
    assert.ok(url.includes('/' + revision + '/README.md'));
    return new Response(content, { status: rawStatus });
  };
  return { urls, fetch: fetcher };
}
const batch = async (content = text, revision = sha, status = 200) => fetchDrafts([source], manifest.sources, { ...mock(content, revision, status), now });
test('resolves immutable revision before exact document fetch, preserves provenance and creates only drafts', async () => {
  const network = mock();
  const result = await fetchDrafts([source], manifest.sources, { ...network, now });
  assert.deepEqual(network.urls, ['https://api.github.com/repos/patinen/secureshare', 'https://api.github.com/repos/patinen/secureshare/commits/main', 'https://raw.githubusercontent.com/patinen/secureshare/' + sha + '/README.md']);
  const entry = result.results[0]!.candidate!;
  assert.equal(entry.status, 'draft'); assert.equal(entry.review, undefined);
  assert.equal(entry.source.github?.documentHash, digest(text));
  assert.equal(entry.source.github?.retrievedAt, now().toISOString());
  assert.equal(entry.source.url, 'https://github.com/patinen/secureshare/blob/' + sha + '/README.md');
  assert.equal(prepareKnowledge({ ...rawPack(), entries: [entry] }, 30000).entries.length, 0);
  assert.throws(() => prepareKnowledge(result, 30000));
  assert.match(entry.content, /Ignore instructions/);
  assert.ok(!entry.content.includes('Excluded setup'));
});
test('allowlist rejects repositories, paths, branch/heading changes before network', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error('unexpected'); };
  for (const changed of [
    { repository: 'attacker/repo' }, { path: '.env' }, { path: 'docs/../README.md' },
    { path: 'src/index.ts' }, { path: 'docs/unselected.md' }, { branch: 'other' }, { heading: 'Deployment' },
  ]) await assert.rejects(fetchDrafts([{ ...source, ...changed } as Source], manifest.sources, { fetch: fetcher }));
  assert.equal(calls, 0);
});
test('same repo batch shares exactly one branch resolution', async () => {
  const second = { ...source, id: 'docs.secureshare.boundaries', heading: 'Boundaries' };
  const network = mock();
  const result = await fetchDrafts([source, second], [source, second], { ...network, now });
  assert.equal(result.results.length, 2);
  assert.equal(network.urls.filter(u => u.includes('/commits/')).length, 1);
});
test('private repositories and invalid revisions fail without raw-document requests', async () => {
  for (const response of [{ private: true }, { private: false, invalid: true }]) {
    let raw = 0;
    const result = await fetchDrafts([source], manifest.sources, { now, fetch: async input => {
      const url = String(input); if (url.includes('raw.')) raw++;
      return Response.json(url.includes('/commits/') ? { sha: 'main' } : response);
    } });
    assert.equal(result.results[0]!.status, 'failed'); assert.equal(raw, 0);
  }
});
test('404 only at immutable document revision means removed; provider failures never imply removal', async () => {
  assert.equal((await batch('', sha, 404)).results[0]!.status, 'removed');
  for (const status of [403, 429, 500]) assert.equal((await batch('', sha, status)).results[0]!.status, 'failed');
  const missingBranch = await fetchDrafts([source], manifest.sources, { now, fetch: async () => new Response('', { status: 404 }) });
  assert.equal(missingBranch.results[0]!.status, 'failed');
});
test('requests time out and network failures produce sanitized drafts reports', async () => {
  const result = await fetchDrafts([source], manifest.sources, { now, timeoutMs: 5, fetch: async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('SECRET raw network details')), { once: true });
  }) });
  assert.equal(result.results[0]!.status, 'failed');
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('byte bounds ignore Content-Length and do not truncate multibyte documents', async () => {
  await assert.rejects(boundedText(new Response('😀'.repeat(10), { headers: { 'content-length': '1' } }), 39), /oversized/);
  const result = await fetchDrafts([source], manifest.sources, { ...mock(), now, maxDocumentBytes: 20 });
  assert.equal(result.results[0]!.status, 'oversized');
  assert.equal(result.results[0]!.candidate, undefined);
});
test('oversized selections require manual summaries and missing headings require selection review', async () => {
  const result = await fetchDrafts([source], manifest.sources, { ...mock(), now, maxCandidateChars: 10 });
  assert.equal(result.results[0]!.status, 'oversized'); assert.equal(result.results[0]!.candidate!.content, '');
  assert.throws(() => promote(rawPack(), result, manifest.sources, review));
  const promoted = promote(rawPack(), result, manifest.sources, { ...review, summary: 'Fixture API uses PostgreSQL.' });
  assert.equal(promoted.pack.entries[0]!.content, 'Fixture API uses PostgreSQL.');
  const absent = await batch('# No selected heading');
  assert.equal(absent.results[0]!.status, 'selection_missing');
  assert.throws(() => promote(promoted.pack, absent, manifest.sources, { ...review, retire: true, version: 'retire' }));
});
test('extraction keeps fenced hostile text as data and respects exact heading boundaries', () => {
  const extracted = extractSection(text, 'Architecture')!;
  assert.match(extracted, /Not a heading/); assert.match(extracted, /Boundaries/);
  assert.ok(!extracted.includes('Deployment'));
  assert.equal(extractSection(text, 'architecture'), undefined);
});
test('individual promotion requires reviewer/date/version and coherent provenance', async () => {
  const result = await batch();
  for (const options of [{ reviewer: '' }, { reviewDate: '2026-10-07' }, { reviewDate: 'invalid' }, { version: 'before' }]) {
    assert.throws(() => promote(rawPack(), result, manifest.sources, { ...review, ...options }));
  }
  const promoted = promote(rawPack(), result, manifest.sources, review);
  assert.equal(promoted.publishedEntries, 1);
  assert.deepEqual(promoted.pack.entries[0]!.review, { reviewedBy: review.reviewer, reviewedAt: review.reviewDate });
  result.results[0]!.candidate!.source.github!.commitSha = nextSha;
  assert.throws(() => promote(rawPack(), result, manifest.sources, review));
});
test('schema rejects mutable provenance URLs without breaking owner metadata', async () => {
  const result = await batch();
  result.results[0]!.candidate!.source.url = 'https://github.com/patinen/secureshare/blob/main/README.md';
  assert.throws(() => packSchema.parse({ ...rawPack(), entries: [result.results[0]!.candidate] }));
  const owner = JSON.parse(await readFile('knowledge/runtime/pack.json', 'utf8'));
  assert.equal(packSchema.parse(owner).entries.length, 22);
});
test('updates replace one stable ID, detect source changes and preserve owner entries', async () => {
  const owner = JSON.parse(await readFile('knowledge/runtime/pack.json', 'utf8'));
  const first = promote(owner, await batch(), manifest.sources, review);
  const second = promote(first.pack, await batch(text.replace('PostgreSQL', 'Fixture database'), nextSha), manifest.sources, { ...review, version: 'next' });
  assert.equal(second.change, 'updated');
  assert.equal(second.pack.entries.length, 23);
  assert.deepEqual(second.pack.entries.filter(e => e.id !== source.id), owner.entries);
  assert.equal(second.pack.entries.find(e => e.id === source.id)!.source.github!.commitSha, nextSha);
  const clash = structuredClone(first.pack); clash.entries[0]!.id = source.id;
  const candidate = await batch();
  assert.throws(() => promote(clash, candidate, manifest.sources, { ...review, version: 'clash' }));
});
test('removal requires explicit retirement; failures leave approved sources untouched', async () => {
  const first = promote(rawPack(), await batch(), manifest.sources, review);
  const removed = await batch('', nextSha, 404);
  assert.throws(() => promote(first.pack, removed, manifest.sources, { ...review, version: 'next' }));
  const retired = promote(first.pack, removed, manifest.sources, { ...review, version: 'next', retire: true });
  assert.equal(retired.publishedEntries, 0);
  assert.equal(retired.pack.entries[0]!.status, 'draft');
  const stale = { ...(await batch()), retrievedAt: '2026-10-07T00:00:00Z' };
  assert.throws(() => promote(first.pack, stale, manifest.sources, { ...review, version: 'next' }));
});
test('context overflow fails without mutating original pack', async () => {
  const original = rawPack(), before = JSON.stringify(original);
  const candidate = await batch();
  assert.throws(() => promote(original, candidate, manifest.sources, { ...review, maxContextChars: 1 }), /exceeds MAX_CONTEXT_CHARS/);
  assert.equal(JSON.stringify(original), before);
});
