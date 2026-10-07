import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { SQLiteUsageStore, AdmissionDenied, helsinkiDay, visitorHash, type UsageStore } from '../src/usage.js';
import { config, provider, headers, payload } from './helpers.js';
const now = new Date('2026-10-07T12:00:00Z');
const id = 'A'.repeat(43), other = 'B'.repeat(43);
const totals = (store: SQLiteUsageStore) => store.db.prepare('SELECT * FROM aggregate_daily').all();

test('visitor identity is required on canonical and encoded protected requests', async t => {
  let calls = 0;
  const app = await buildApp(config(), { logger: false, provider: provider(async () => { calls++; return { answer: 'Hi', sourceIds: [] }; }) });
  t.after(() => app.close());
  for (const url of ['/v1/chat', '/v1/%63hat', '/v1/ch%61t']) for (const value of [undefined, 'short', 'A'.repeat(44), '../untrusted', 'a,b']) {
    const res = await app.inject({ method: 'POST', url, payload, headers: { authorization: headers.authorization, ...(value ? { 'x-personacore-visitor': value } : {}) } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'invalid_visitor');
  }
  assert.equal(calls, 0);
});
test('atomic concurrent admission cannot exceed aggregate remaining allowance', async t => {
  let calls = 0;
  const store = new SQLiteUsageStore(config({ DAILY_ATTEMPT_CAP: '2', VISITOR_DAILY_ALLOWANCE: '10' }));
  const app = await buildApp(config({ MAX_CONCURRENCY: '32' }), { usageStore: store, clock: () => now, logger: false, provider: provider(async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 10)); return { answer: 'Hi', sourceIds: [] };
  }) });
  t.after(() => app.close());
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => app.inject({ method: 'POST', url: '/v1/chat', payload, headers: { ...headers, 'x-personacore-visitor': String.fromCharCode(65 + i).repeat(43) } })));
  assert.equal(calls, 2);
  assert.equal(responses.filter(r => r.statusCode === 200).length, 2);
  assert.equal(responses.filter(r => r.json().error?.code === 'daily_limit').length, 10);
  assert.equal(totals(store)[0]!.attempts, 2);
});
test('visitor allowance, rate window and aggregate allowance share committed counters', () => {
  const store = new SQLiteUsageStore(config({ DAILY_ATTEMPT_CAP: '3', VISITOR_DAILY_ALLOWANCE: '2', VISITOR_RATE_MAX: '1' }));
  try {
    store.reserve(id, now);
    assert.throws(() => store.reserve(id, now), (e: unknown) => e instanceof AdmissionDenied && e.code === 'visitor_rate_limited');
    store.reserve(id, new Date(now.getTime() + 60000));
    assert.throws(() => store.reserve(id, new Date(now.getTime() + 120000)), (e: unknown) => e instanceof AdmissionDenied && e.code === 'visitor_daily_limit');
    store.reserve(other, now);
    assert.throws(() => store.reserve('C'.repeat(43), now), (e: unknown) => e instanceof AdmissionDenied && e.code === 'daily_limit');
    assert.equal(totals(store)[0]!.attempts, 3);
    assert.equal(store.db.prepare('SELECT visitor_hash FROM visitor_daily WHERE visitor_hash=?').get(visitorHash(id))!.visitor_hash, visitorHash(id));
  } finally { store.close(); }
});
test('reopening same database and idempotent migrations do not replenish reservations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personacore-usage-'));
  try {
    const conf = config({ DATA_DIR: dir, DAILY_ATTEMPT_CAP: '1' });
    let store = new SQLiteUsageStore(conf); store.reserve(id, now); store.close();
    store = new SQLiteUsageStore(conf);
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 1);
    assert.throws(() => store.reserve(other, now), AdmissionDenied);
    assert.equal(totals(store)[0]!.attempts, 1);
    store.close();
    const bytes = await readFile(join(dir, 'usage.sqlite'));
    assert.ok(!bytes.includes(Buffer.from(id)));
    assert.ok(!bytes.includes(Buffer.from(payload.message)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('separate database handles enforce the same allowance and fail closed under a write lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personacore-lock-'));
  try {
    const conf = config({ DATA_DIR: dir, DAILY_ATTEMPT_CAP: '1' });
    const one = new SQLiteUsageStore(conf), two = new SQLiteUsageStore(conf);
    try {
      one.db.exec('BEGIN IMMEDIATE');
      assert.throws(() => two.reserve(id, now));
      one.db.exec('ROLLBACK');
      one.reserve(id, now);
      assert.throws(() => two.reserve(other, now), AdmissionDenied);
    } finally { one.close(); two.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Helsinki daily rollover uses local midnight in summer/winter and across DST dates', () => {
  const pairs = [
    ['2026-10-07T20:59:59Z', '2026-10-07'], ['2026-10-07T21:00:00Z', '2026-10-08'],
    ['2026-01-01T21:59:59Z', '2026-01-01'], ['2026-01-01T22:00:00Z', '2026-01-02'],
    ['2026-03-29T00:59:59Z', '2026-03-29'], ['2026-03-29T01:00:00Z', '2026-03-29'],
    ['2026-10-25T00:59:59Z', '2026-10-25'], ['2026-10-25T01:00:00Z', '2026-10-25'],
  ];
  for (const [date, day] of pairs) assert.equal(helsinkiDay(new Date(date!)), day);
  const store = new SQLiteUsageStore(config({ DAILY_ATTEMPT_CAP: '1' }));
  try {
    store.reserve(id, new Date(pairs[0]![0]!));
    assert.throws(() => store.reserve(other, new Date(pairs[0]![0]!)), AdmissionDenied);
    store.reserve(id, new Date(pairs[1]![0]!));
    assert.equal(totals(store).length, 2);
  } finally { store.close(); }
});
test('old counter retention is bounded and cleanup preserves current counters', () => {
  const store = new SQLiteUsageStore(config({ USAGE_RETENTION_DAYS: '2' }));
  try {
    store.reserve(id, new Date('2026-10-01T12:00:00Z'));
    store.reserve(other, now);
    assert.equal(totals(store).length, 1);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM visitor_daily').get()!.n, 1);
  } finally { store.close(); }
});
for (const failure of ['error', 'timeout'] as const) test('provider ' + failure + ' retains a committed reservation and no invented usage', async t => {
  const conf = config({ REQUEST_TIMEOUT_MS: '20', DAILY_ATTEMPT_CAP: '1' });
  const store = new SQLiteUsageStore(conf);
  let calls = 0;
  const app = await buildApp(conf, { usageStore: store, clock: () => now, logger: false, provider: provider(async ({ signal }) => {
    calls++;
    if (failure === 'timeout') await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    throw new Error('private provider details');
  }) }); t.after(() => app.close());
  const result = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
  assert.equal(result.statusCode, failure === 'timeout' ? 504 : 502);
  assert.equal(totals(store)[0]!.attempts, 1);
  assert.equal(totals(store)[0]!.successes, 0);
  assert.equal(totals(store)[0]!.measured_calls, 0);
  const denied = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
  assert.equal(denied.json().error.code, 'daily_limit'); assert.equal(calls, 1);
});
test('successful answers record measured tokens separately from attempts', async t => {
  const store = new SQLiteUsageStore(config());
  const app = await buildApp(config(), { usageStore: store, clock: () => now, logger: false, provider: provider(async () => ({ answer: 'Hello', sourceIds: [], usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 } })) }); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/v1/chat', headers, payload })).statusCode, 200);
  const row = totals(store)[0]!;
  assert.equal(row.attempts, 1); assert.equal(row.successes, 1); assert.equal(row.measured_calls, 1); assert.equal(row.total_tokens, 24);
});
test('database errors disable chat but preserve health without leaking errors', async t => {
  let calls = 0;
  const broken: UsageStore = { reserve() { throw new Error('PRIVATE_DATABASE_PATH SECRET'); }, recordUsage() {}, recordSuccess() {}, close() {} };
  const app = await buildApp(config(), { usageStore: broken, logger: false, provider: provider(async () => { calls++; return { answer: 'Hi', sourceIds: [] }; }) }); t.after(() => app.close());
  for (let i = 0; i < 2; i++) {
    const result = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
    assert.equal(result.statusCode, 503); assert.doesNotMatch(result.body, /SECRET|PRIVATE_DATABASE/);
  }
  assert.equal(calls, 0); assert.equal((await app.inject('/health')).statusCode, 200);
});
test('disabled service and unavailable provider do not reserve attempts', async t => {
  for (const disabled of [true, false]) {
    const store = new SQLiteUsageStore(config());
    const stub = provider(); if (!disabled) stub.isAvailable = () => false;
    const app = await buildApp(config({ CHAT_ENABLED: disabled ? 'false' : 'true' }), { usageStore: store, logger: false, provider: stub }); t.after(() => app.close());
    assert.equal((await app.inject({ method: 'POST', url: '/v1/chat', headers, payload })).statusCode, 503);
    assert.equal(totals(store).length, 0);
  }
});
test('production requires persistent directory and all attempt controls require zero SDK retries', () => {
  assert.throws(() => config({ NODE_ENV: 'production' }), /DATA_DIR/);
  assert.throws(() => config({ OPENAI_MAX_RETRIES: '1' }), /require OPENAI_MAX_RETRIES=0/);
});

test('client disconnect keeps reservation and aborts provider without inventing usage', async t => {
  const store = new SQLiteUsageStore(config());
  let entered!: () => void, aborted = false;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const app = await buildApp(config(), { usageStore: store, clock: () => now, logger: false, provider: provider(async ({ signal }) => {
    entered();
    await new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('disconnected')); }, { once: true }));
    return { answer: 'Unreachable', sourceIds: [] };
  }) });
  t.after(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as { port: number };
  const controller = new AbortController();
  const response = fetch('http://127.0.0.1:' + address.port + '/v1/chat', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal }).catch(() => undefined);
  await ready; controller.abort(); await response;
  for (let i = 0; i < 30 && !aborted; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(aborted, true); assert.equal(totals(store)[0]!.attempts, 1);
  assert.equal(totals(store)[0]!.measured_calls, 0);
});
test('concurrency rejection cannot reserve an additional attempt', async t => {
  const store = new SQLiteUsageStore(config());
  let finish!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const app = await buildApp(config({ MAX_CONCURRENCY: '1' }), { usageStore: store, clock: () => now, logger: false, provider: provider(async () => {
    entered(); await new Promise<void>(resolve => { finish = resolve; }); return { answer: 'Hi', sourceIds: [] };
  }) }); t.after(() => app.close());
  const first = app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
  await ready;
  const busy = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
  assert.equal(busy.json().error.code, 'busy'); assert.equal(totals(store)[0]!.attempts, 1);
  finish(); assert.equal((await first).statusCode, 200);
});
test('closed database fails admission before provider and knowledge directory cannot be used as data', async t => {
  let calls = 0;
  const store = new SQLiteUsageStore(config()); store.close();
  const app = await buildApp(config(), { usageStore: store, logger: false, provider: provider(async () => { calls++; return { answer: 'Hi', sourceIds: [] }; }) }); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/v1/chat', headers, payload })).statusCode, 503);
  assert.equal(calls, 0);
  assert.throws(() => new SQLiteUsageStore(config({ DATA_DIR: './knowledge/runtime' })), /separate from knowledge/);
});
