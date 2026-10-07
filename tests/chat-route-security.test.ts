import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { config, provider, headers, payload } from './helpers.js';

const chatPaths = ['/v1/chat', '/v1/%63hat', '/v1/ch%61t'];

for (const url of chatPaths) {
  for (const credentials of ['missing', 'incorrect'] as const) {
    test(credentials + ' credentials cannot invoke provider through ' + url, async t => {
      let calls = 0;
      const app = await buildApp(config(), { logger: false, provider: provider(async () => {
        calls++; return { answer: 'Injected answer', sourceIds: [] };
      }) });
      t.after(() => app.close());
      const res = await app.inject({ method: 'POST', url, payload, headers: credentials === 'missing' ? {} : { authorization: 'Bearer incorrect' } });
      assert.equal(calls, 0, 'Unauthorized requests must never invoke the provider');
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, 'unauthorized');
      assert.equal(res.json().requestId, res.headers['x-request-id']);
      assert.equal(res.headers['cache-control'], 'no-store');
    });
  }

  test('missing bearer configuration blocks provider through ' + url, async t => {
    let calls = 0;
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', KNOWLEDGE_DIR: './knowledge/runtime' }), {
      logger: false, provider: provider(async () => { calls++; return { answer: 'Injected answer', sourceIds: [] }; }),
    });
    t.after(() => app.close());
    const res = await app.inject({ method: 'POST', url, payload, headers });
    assert.equal(calls, 0, 'Unconfigured authentication must never invoke the provider');
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.code, 'service_unavailable');
  });

  test('valid credentials invoke provider through ' + url, async t => {
    let calls = 0;
    const app = await buildApp(config(), { logger: false, provider: provider(async () => {
      calls++; return { answer: 'Injected answer', sourceIds: [] };
    }) });
    t.after(() => app.close());
    const res = await app.inject({ method: 'POST', url, payload, headers: { ...headers, 'x-request-id': 'untrusted-client-id' } });
    assert.equal(res.statusCode, 200);
    assert.equal(calls, 1);
    assert.equal(res.json().answer, 'Injected answer');
    assert.equal(res.json().requestId, res.headers['x-request-id']);
    assert.notEqual(res.json().requestId, 'untrusted-client-id');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.ok(res.json().metadata.durationMs >= 0);
  });

  test('quota consumed through ' + url + ' blocks every chat path but not health', async t => {
    let calls = 0;
    const app = await buildApp(config({ RATE_LIMIT_MAX: '1' }), { logger: false, provider: provider(async () => {
      calls++; return { answer: 'Injected answer', sourceIds: [] };
    }) });
    t.after(() => app.close());
    const first = await app.inject({ method: 'POST', url, payload, headers });
    assert.equal(first.statusCode, 200);
    assert.equal(calls, 1);
    for (const path of chatPaths) {
      const limited = await app.inject({ method: 'POST', url: path, payload, headers });
      assert.equal(calls, 1, 'Exhausted shared quota must prevent further provider invocations');
      assert.equal(limited.statusCode, 429, path);
      assert.equal(limited.json().error.code, 'rate_limited');
      assert.ok(Number(limited.headers['retry-after']) > 0);
      assert.equal(limited.json().requestId, limited.headers['x-request-id']);
      assert.equal(limited.headers['cache-control'], 'no-store');
    }
    const health = await app.inject('/health');
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: 'ok' });
    assert.equal(health.headers['cache-control'], 'no-store');
    assert.ok(health.headers['x-request-id']);
    assert.equal(calls, 1, 'Health must never invoke the provider');
  });
}

test('unauthorized encoded requests consume the shared quota before authentication', async t => {
  let calls = 0;
  const app = await buildApp(config({ RATE_LIMIT_MAX: '1' }), { logger: false, provider: provider(async () => {
    calls++; return { answer: 'Injected answer', sourceIds: [] };
  }) });
  t.after(() => app.close());
  const denied = await app.inject({ method: 'POST', url: '/v1/%63hat', payload });
  assert.equal(calls, 0);
  assert.equal(denied.statusCode, 401);
  const limited = await app.inject({ method: 'POST', url: '/v1/chat', payload, headers });
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal(calls, 0);
});
