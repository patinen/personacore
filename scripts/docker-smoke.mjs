import assert from 'node:assert/strict';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
const base = 'http://127.0.0.1:' + (process.env.PORT || '3001');
let health;
for (let i = 0; i < 40; i++) {
  try { health = await fetch(base + '/health', { signal: AbortSignal.timeout(1000) }); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
}
assert.ok(health, 'process must become healthy');
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { status: 'ok' });
const body = JSON.stringify({ locale: 'en', history: [], message: 'Hello' });
const denied = await fetch(base + '/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
assert.equal(denied.status, 401);
const unavailable = await fetch(base + '/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.CHAT_BEARER_SECRET, 'x-personacore-visitor': 'A'.repeat(43) }, body });
assert.equal(unavailable.status, 503);
assert.equal((await unavailable.json()).error.code, 'service_unavailable');
for (const path of ['/app/knowledge/example', '/app/tests', '/app/node_modules/typescript', '/app/.env']) assert.equal(existsSync(path), false, path);
assert.notEqual(process.getuid(), 0);
writeFileSync(process.env.DATA_DIR + '/permission-check', 'fixture');
unlinkSync(process.env.DATA_DIR + '/permission-check');
assert.ok(existsSync(process.env.DATA_DIR + '/usage.sqlite'));
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(process.env.DATA_DIR + '/usage.sqlite');
assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
db.close();
const { SQLiteUsageStore, AdmissionDenied } = await import('/app/dist/usage.js');
const { loadConfig } = await import('/app/dist/config.js');
const store = new SQLiteUsageStore(loadConfig({ ...process.env, DAILY_ATTEMPT_CAP: '1' }));
const previous = store.db.prepare('SELECT sum(attempts) AS attempts FROM aggregate_daily').get().attempts;
if (!previous) store.reserve('B'.repeat(43), new Date());
else assert.throws(() => store.reserve('C'.repeat(43), new Date()), AdmissionDenied);
assert.equal(store.db.prepare('SELECT sum(attempts) AS attempts FROM aggregate_daily').get().attempts, 1);
store.close();
assert.throws(() => writeFileSync('/app/knowledge/runtime/write-check', 'forbidden'));

console.log('PASS: public health, auth rejection, real-provider 503, nonroot user, writable persistent data, read-only knowledge, retained allowance, production-only files. No model calls.');
