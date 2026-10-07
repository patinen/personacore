import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { loadKnowledge, prepareKnowledge } from '../src/knowledge.js';
const casesSchema = z.array(z.object({ id: z.string(), pack: z.enum(['runtime', 'synthetic']), locale: z.enum(['fi', 'en']), message: z.string(), history: z.array(z.object({ role: z.enum(['visitor', 'assistant']), content: z.string() })).optional(), expect: z.string() }));
async function main() {
  // Both switches are deliberate; this script is never included in normal test/build/start.
  if (process.env.PERSONACORE_LIVE_EVAL !== '1' || !process.argv.includes('--allow-paid')) throw new Error('Live evaluation is disabled. Set PERSONACORE_LIVE_EVAL=1 and pass --allow-paid to explicitly authorize paid calls.');
  const config = loadConfig(process.env);
  if (config.PROVIDER !== 'openai' || !config.OPENAI_API_KEY || !config.OPENAI_MODEL || !config.CHAT_BEARER_SECRET) throw new Error('Live evaluation requires explicit real-provider configuration and a server secret.');
  const synthetic = process.argv.includes('--synthetic');
  const cases = casesSchema.parse(JSON.parse(await readFile(resolve('evals/cases.json'), 'utf8'))).filter(c => c.pack === (synthetic ? 'synthetic' : 'runtime'));
  const knowledge = synthetic
    ? prepareKnowledge(JSON.parse(await readFile(resolve('tests/fixtures/knowledge/pack.json'), 'utf8')), config.MAX_CONTEXT_CHARS, true)
    : await loadKnowledge(config.KNOWLEDGE_DIR, config.MAX_CONTEXT_CHARS);
  const app = await buildApp(config, { knowledge, logger: false });
  console.log(JSON.stringify({ mode: 'PAID_LIVE_EVALUATION', model: config.OPENAI_MODEL, knowledgeVersion: knowledge.version, cases: cases.length, synthetic, grading: 'Human review required; no automated hallucination pass is asserted.' }));
  try {
    for (const item of cases) {
      const response = await app.inject({ method: 'POST', url: '/v1/chat', headers: { authorization: 'Bearer ' + config.CHAT_BEARER_SECRET }, payload: { locale: item.locale, message: item.message, history: item.history ?? [] } });
      console.log(JSON.stringify({ caseId: item.id, rubric: item.expect, status: response.statusCode, response: response.json() }));
      if (response.statusCode !== 200) { process.exitCode = 1; break; }
    }
  } finally { await app.close(); }
}
main().catch(() => { console.error('Live evaluation did not complete. Check the opt-in switches, configuration and validated knowledge. Provider details and secrets are suppressed.'); process.exitCode = 1; });
