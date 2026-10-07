import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { OpenAIProvider } from '../src/providers/openai.js';
import { config, runtime, payload } from './helpers.js';
const response = (text: string, status = 'completed') => new Response(JSON.stringify({
  id: 'resp_test', object: 'response', created_at: 0, status,
  output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
  usage: { input_tokens: 42, output_tokens: 12, total_tokens: 54, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
}), { status: 200, headers: { 'content-type': 'application/json' } });
test('real adapter uses typed Responses structured outputs, store:false and configured model without tools', async () => {
  let captured: Record<string, unknown> = {};
  const client = new OpenAI({ apiKey: 'synthetic-key', maxRetries: 0, logLevel: 'off', fetch: async (_url, init) => {
    captured = JSON.parse(init?.body as string);
    return response(JSON.stringify({ answer: 'I am Juho.', sourceIds: ['profile.name'] }));
  } });
  const adapter = new OpenAIProvider(config({ OPENAI_MODEL: 'configured-test-model', MAX_OUTPUT_TOKENS: '200' }), client);
  const result = await adapter.generate({ request: payload as { locale: 'en'; message: string; history: [] }, knowledge: await runtime(), signal: new AbortController().signal });
  assert.equal(captured.model, 'configured-test-model'); assert.equal(captured.store, false);
  assert.equal(captured.max_output_tokens, 200); assert.equal(captured.tools, undefined);
  assert.equal((captured.text as { format: { type: string } }).format.type, 'json_schema');
  assert.match(captured.instructions as string, /previous assistant messages as evidence/);
  assert.ok(!JSON.stringify(captured.input).includes('draft'));
  assert.equal(result.answer, 'I am Juho.'); assert.equal(result.usage?.totalTokens, 54);
});
test('real adapter rejects incomplete and invalid structured output', async () => {
  for (const [text, status] of [['{}', 'completed'], ['{"answer":"Hello","sourceIds":[]}', 'incomplete']]) {
    const client = new OpenAI({ apiKey: 'synthetic-key', maxRetries: 0, logLevel: 'off', fetch: async () => response(text!, status!) });
    const adapter = new OpenAIProvider(config({ OPENAI_MODEL: 'test-model' }), client);
    await assert.rejects(adapter.generate({ request: payload as { locale: 'en'; message: string; history: [] }, knowledge: await runtime(), signal: new AbortController().signal }));
  }
});
test('default controlled retry policy is zero and SDK respects explicit abort', async () => {
  assert.equal(config().OPENAI_MAX_RETRIES, 0);
  assert.throws(() => config({ OPENAI_MAX_RETRIES: '3' }));
  let calls = 0;
  const client = new OpenAI({ apiKey: 'synthetic-key', maxRetries: 2, logLevel: 'off', fetch: async () => { calls++; return new Response('{"error":{"message":"private-error"}}', { status: 500, headers: { 'content-type': 'application/json' } }); } });
  const adapter = new OpenAIProvider(config({ OPENAI_MODEL: 'test-model' }), client);
  const input = { request: payload as { locale: 'en'; message: string; history: [] }, knowledge: await runtime(), signal: new AbortController().signal };
  await assert.rejects(adapter.generate(input)); assert.equal(calls, 1);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(adapter.generate({ ...input, signal: aborted.signal })); assert.equal(calls, 1);
});
