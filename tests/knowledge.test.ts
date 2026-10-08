import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadKnowledge, prepareKnowledge, resolveSources, safeUrl } from '../src/knowledge.js';
import { runtime } from './helpers.js';
const fixture = async () => JSON.parse(await readFile('tests/fixtures/knowledge/pack.json', 'utf8'));
test('validates packs and excludes drafts before prompt construction', async () => {
  const pack = await fixture();
  const knowledge = prepareKnowledge(pack, 30000, true);
  assert.equal(knowledge.entries.length, 4);
  assert.ok(!knowledge.context.includes('DRAFT_SECRET_NOT_FOR_CONTEXT'));
  assert.ok(!knowledge.context.includes('draft.secret'));
  pack.entries[0].review = undefined;
  assert.throws(() => prepareKnowledge(pack, 30000, true));
});
test('rejects malformed packs, duplicate IDs and unsupported skill scores', async () => {
  const pack = await fixture();
  pack.entries.push(pack.entries[0]);
  assert.throws(() => prepareKnowledge(pack, 30000, true));
  pack.entries.pop(); pack.entries[1].proficiency = 9;
  assert.throws(() => prepareKnowledge(pack, 30000, true));
});
test('runtime contains only approved facts and excludes synthetic packs', async () => {
  const knowledge = await runtime();
  assert.equal(knowledge.entries.length, 22);
  assert.ok(knowledge.context.length <= 30000);
  assert.ok(knowledge.entries.every(e => e.source.kind === 'owner' && e.review?.reviewedAt === '2026-10-08'));
  assert.doesNotMatch(knowledge.context, /violet|DRAFT_SECRET/);
  await assert.rejects(loadKnowledge(resolve('tests/fixtures/knowledge'), 30000), /Runtime knowledge/);
  await assert.rejects(loadKnowledge(resolve('knowledge/example'), 30000), /Runtime knowledge/);
});
test('published context budget fails with actionable authoring guidance', async () => {
  const pack = await fixture();
  assert.throws(() => prepareKnowledge(pack, 10, true), /Review the pack.*no entries were dropped/);
});
test('resolves only published IDs and server-owned titles/URLs', async () => {
  const knowledge = prepareKnowledge(await fixture(), 30000, true);
  assert.deepEqual(resolveSources(['projects.example.overview', 'projects.example.overview'], knowledge), [{ id: 'projects.example.overview', title: 'Synthetic project overview', url: 'https://example.com/projects/fictional' }]);
  assert.throws(() => resolveSources(['unknown'], knowledge));
  assert.throws(() => resolveSources(['draft.secret'], knowledge));
  assert.throws(() => resolveSources(Array.from({ length: 21 }, () => 'preferences.colour'), knowledge));
});
test('citation URL validation rejects unsafe destinations', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file:///secret', '//example.com', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/\nmalicious']) assert.equal(safeUrl.safeParse(url).success, false, url);
  assert.equal(safeUrl.safeParse('https://example.com/docs?q=one#section').success, true);
  const pack = await fixture(); pack.entries[3].source.url = 'javascript:alert(1)';
  assert.throws(() => prepareKnowledge(pack, 30000, true));
});
test('loader reads only pack.json in the explicitly configured directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personacore-test-'));
  try {
    await mkdir(join(dir, 'unrelated'));
    await writeFile(join(dir, 'unrelated', 'private.json'), '{private data}');
    await writeFile(join(dir, 'ignored.json'), '{bad json}');
    await writeFile(join(dir, 'pack.json'), await readFile('knowledge/runtime/pack.json'));
    assert.equal((await loadKnowledge(dir, 30000)).entries.length, 22);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
