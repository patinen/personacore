import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { manifestSchema, fetchDrafts, promote } from './github-ingestion.js';
async function file(path: string) {
  if ((await stat(path)).size > 2_000_000) throw new Error('Local review file exceeds limit');
  return readFile(path, 'utf8');
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...flags] = args;
  const allowed = command === 'fetch' ? ['--ids='] : ['--batch=', '--id=', '--reviewer=', '--review-date=', '--version=', '--summary-file=', '--max-context-chars=', '--apply', '--retire'];
  if (!['fetch', 'promote'].includes(command ?? '') || flags.some(f => !allowed.some(a => a.endsWith('=') ? f.startsWith(a) : f === a)) || new Set(flags.map(f => f.split('=')[0])).size !== flags.length) throw new Error('Invalid or duplicate command arguments');
  const value = (key: string) => flags.find(f => f.startsWith(key + '='))?.slice(key.length + 1);
  const sources = manifestSchema.parse(JSON.parse(await file('ingestion/sources.json'))).sources;
  if (command === 'fetch') {
    const ids = value('--ids')?.split(',');
    if (ids?.some(id => !sources.some(s => s.id === id))) throw new Error('Unknown source ID');
    const batch = await fetchDrafts(ids ? sources.filter(s => ids.includes(s.id)) : sources, sources);
    await mkdir('ingestion/drafts', { recursive: true });
    const path = resolve('ingestion/drafts', batch.retrievedAt.replace(/[:.]/g, '-') + '.json');
    await writeFile(path, JSON.stringify(batch, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ path, results: batch.results.map(r => ({ id: r.source.id, status: r.status, revision: r.commitSha, note: r.note })) }, null, 2));
    if (batch.results.some(r => r.status === 'failed')) process.exitCode = 1;
    return;
  }
  const batchPath = value('--batch'), id = value('--id'), reviewer = value('--reviewer'), reviewDate = value('--review-date'), version = value('--version');
  if (!batchPath || !id || !reviewer || !reviewDate || !version) throw new Error('Promotion needs batch, individual ID, reviewer, review date and new version');
  const maxContextChars = value('--max-context-chars') ? Number(value('--max-context-chars')) : 30000;
  if (!Number.isSafeInteger(maxContextChars) || maxContextChars < 1 || maxContextChars > 200000) throw new Error('Invalid context budget');
  const runtimePath = resolve('knowledge/runtime/pack.json');
  const original = await file(runtimePath);
  const summaryPath = value('--summary-file');
  const result = promote(JSON.parse(original), JSON.parse(await file(batchPath)), sources, {
    id, reviewer, reviewDate, version, maxContextChars,
    ...(summaryPath ? { summary: await file(summaryPath) } : {}), retire: flags.includes('--retire'),
  });
  console.log(JSON.stringify({ mode: flags.includes('--apply') ? 'apply' : 'preview', id, change: result.change, contextChars: result.contextChars, publishedEntries: result.publishedEntries, entry: result.pack.entries.find(e => e.id === id) }, null, 2));
  if (!flags.includes('--apply')) return;
  const lock = resolve('ingestion/.promotion.lock'), temp = runtimePath + '.promotion.tmp';
  await writeFile(lock, 'Offline promotion in progress\n', { flag: 'wx' });
  let created = false;
  try {
    if (await file(runtimePath) !== original) throw new Error('Runtime pack changed during review');
    await writeFile(temp, JSON.stringify(result.pack, null, 2) + '\n', { flag: 'wx' }); created = true;
    if (await file(runtimePath) !== original) throw new Error('Runtime pack changed during review');
    await rename(temp, runtimePath); created = false;
  } finally {
    if (created) await unlink(temp);
    await unlink(lock);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Ingestion command failed'); process.exitCode = 1;
});
