import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { loadKnowledge, prepareKnowledge } from '../src/knowledge.js';
import { instructionsVersion } from '../src/instructions/v2.js';
import { helsinkiDay } from '../src/usage.js';
import { casesSchema, selectCases, admissionPlan, validateCases } from './evaluation-plan.js';
export async function main(args = process.argv.slice(2), env = process.env) {
  const dry = args.includes('--dry-run');
  if (!dry && (env.PERSONACORE_LIVE_EVAL !== '1' || !args.includes('--allow-paid'))) throw new Error('Paid opt-in missing');
  const config = loadConfig({ ...env, KNOWLEDGE_DIR: env.KNOWLEDGE_DIR ?? resolve('knowledge/runtime') });
  const synthetic = args.includes('--synthetic');
  const selected = args.find(arg => arg.startsWith('--cases='))?.slice(8).split(',');
  const cases = selectCases(casesSchema.parse(JSON.parse(await readFile(resolve('evals/cases.json'), 'utf8'))), synthetic, selected);
  validateCases(cases, config);
  const knowledge = synthetic
    ? prepareKnowledge(JSON.parse(await readFile(resolve('tests/fixtures/knowledge/pack.json'), 'utf8')), config.MAX_CONTEXT_CHARS, true)
    : await loadKnowledge(config.KNOWLEDGE_DIR, config.MAX_CONTEXT_CHARS);
  let used = 0;
  const path = config.DATA_DIR ? resolve(config.DATA_DIR, 'usage.sqlite') : undefined;
  if (path && existsSync(path)) {
    const db = new DatabaseSync(path, { readOnly: true, timeout: 1000 });
    try { used = Number(db.prepare('SELECT attempts FROM aggregate_daily WHERE day=?').get(helsinkiDay(new Date()))?.attempts ?? 0); }
    finally { db.close(); }
  }
  const paceArg = args.find(arg => arg.startsWith('--pace-ms='));
  const plan = admissionPlan(config, cases.length, used, paceArg ? Number(paceArg.slice(10)) : undefined);
  console.log(JSON.stringify({ mode: dry ? 'OFFLINE_PLAN' : 'PAID_PREFLIGHT', knowledgeVersion: knowledge.version, instructionsVersion, contextChars: knowledge.context.length, synthetic, cases, admission: plan, requirements: ['PROVIDER=openai', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'CHAT_BEARER_SECRET', 'zero retries', 'CHAT_ENABLED=true', 'production DATA_DIR; one instance', 'both paid opt-in switches'], note: 'Read-only counters are advisory; concurrent activity can change remaining allowance. Each case still passes normal admission.' }, null, 2));
  if (dry) return;
  if (plan.blockers.length || config.PROVIDER !== 'openai' || !config.OPENAI_API_KEY || !config.OPENAI_MODEL || !config.CHAT_BEARER_SECRET) throw new Error('Preflight blocked');
  const visitor = randomBytes(32).toString('base64url');
  const app = await buildApp(config, { knowledge, logger: false });
  try {
    for (const [index, item] of cases.entries()) {
      if (index) await new Promise(resolve => setTimeout(resolve, plan.paceMs));
      const response = await app.inject({ method: 'POST', url: '/v1/chat', headers: { authorization: 'Bearer ' + config.CHAT_BEARER_SECRET, 'x-personacore-visitor': visitor }, payload: { locale: item.locale, message: item.message, history: item.history ?? [] } });
      console.log(JSON.stringify({ caseId: item.id, rubric: item.expect, status: response.statusCode, response: response.json(), grading: 'Human review required; no automatic model-behaviour pass.' }));
      if (response.statusCode !== 200) { process.exitCode = 1; break; }
    }
  } finally { await app.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('Evaluation stopped before completion. Review opt-in, admission plan and configuration; details/secrets suppressed.');
  process.exitCode = 1;
});
