import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadKnowledge, packSchema } from '../src/knowledge.js';
import { resolve } from 'node:path';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => [k, canonical(v)]));
  return value;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
test('curated runtime retains every pre-publication owner entry and only four real documentation summaries', async () => {
  const pack = packSchema.parse(JSON.parse(await readFile('knowledge/runtime/pack.json', 'utf8')));
  const review = JSON.parse(await readFile('ingestion/curated/2026-10-08/review.json', 'utf8'));
  const owner = pack.entries.filter(e => e.source.kind === 'owner');
  assert.equal(owner.length, 22);
  assert.deepEqual(Object.fromEntries(owner.map(e => [e.id, hash(e)])), review.ownerEntryHashes);
  const docs = pack.entries.filter(e => e.source.kind === 'project-documentation');
  assert.deepEqual(docs.map(e => e.id).sort(), review.entries.map((e: { id: string }) => e.id).sort());
  assert.equal(docs.length, 4);
  const batch = JSON.parse(await readFile(review.batch, 'utf8'));
  for (const entry of docs) {
    const input = review.entries.find((e: { id: string }) => e.id === entry.id);
    const result = batch.results.find((r: { source: { id: string } }) => r.source.id === entry.id);
    assert.equal(entry.status, 'published');
    assert.equal(entry.content, await readFile(input.summaryFile, 'utf8'));
    assert.deepEqual(entry.source, result.candidate.source);
    assert.equal(entry.source.github!.commitSha, input.commitSha);
    assert.equal(entry.source.github!.documentHash, input.documentHash);
    assert.deepEqual(entry.review, { reviewedBy: review.reviewer, reviewedAt: review.reviewDate });
    if (entry.category === 'projects') assert.deepEqual(entry.ingestionObservation, { retrievedAt: batch.retrievedAt, commitSha: input.commitSha, status: 'available' });
    assert.match(entry.review!.reviewedBy, /not a personal interview or independent audit/);
  }
});
test('curated publication reserves room for later owner answers and keeps fictional evidence isolated', async () => {
  const knowledge = await loadKnowledge(resolve('knowledge/runtime'), 30000);
  assert.equal(knowledge.version, '2026-10-08.3');
  assert.equal(knowledge.entries.length, 26);
  assert.ok(30000 - knowledge.context.length >= 3000);
  assert.ok(!knowledge.context.includes('projects.fixture.architecture'));
  assert.ok(!knowledge.context.includes('docs.personacore.api-contract'));
  const entry = (id: string) => knowledge.entries.find(e => e.id === id)!;
  assert.match(entry('docs.projectpulse.overview').content, /future work/);
  assert.match(entry('docs.statuscore.overview').content, /not exactly-once/);
  assert.match(entry('docs.secureshare.overview').content, /not E2EE/);
  assert.match(entry('docs.personacore.overview').content, /stale unknown-owner-fact claims/);
});
