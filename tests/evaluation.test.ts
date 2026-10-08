import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { casesSchema, selectCases, admissionPlan, validateCases } from '../scripts/evaluation-plan.js';
import { config, runtime } from './helpers.js';
import { instructions, instructionsVersion } from '../src/instructions/v2.js';
test('grounded cases validate, remain bilingual and keep synthetic packs separate', async () => {
  const cases = casesSchema.parse(JSON.parse(await readFile('evals/cases.json', 'utf8')));
  const selected = selectCases(cases, false);
  validateCases(selected, config());
  assert.equal(selected.length, 54);
  for (const topic of ['pets', 'colour', 'education', 'postgresql', 'deployment', 'secureshare', 'unknown-private', 'private-inference', 'false-owner', 'false-history', 'collaboration', 'availability', 'tradeoffs', 'agent-interest']) {
    for (const locale of ['fi', 'en']) assert.ok(selected.some(c => c.id === topic + '-' + locale));
  }
  assert.equal(selectCases(cases, true).length, 3);
  assert.deepEqual(selectCases(cases, false, ['pets-fi']).map(c => c.id), ['pets-fi']);
  assert.throws(() => selectCases(cases, false, ['known-colour']));
  assert.throws(() => selectCases(cases, false, ['missing']));
});
test('preflight rejects full-set default allowances and unsafe pacing without changing limits', () => {
  const conf = config();
  assert.ok(admissionPlan(conf, 54).blockers.some(b => b.includes('VISITOR_DAILY_ALLOWANCE')));
  assert.ok(admissionPlan(conf, 2, 99).blockers.some(b => b.includes('aggregate')));
  assert.ok(admissionPlan(conf, 2, 0, 1).blockers.some(b => b.includes('Pacing')));
  assert.equal(admissionPlan(conf, 2).blockers.length, 0);
  assert.ok(admissionPlan(config({ CHAT_ENABLED: 'false' }), 2).blockers.length);
  assert.equal(conf.VISITOR_DAILY_ALLOWANCE, 10);
});
test('offline CLI needs no key, opt-in or provider, and shows versions/cases/admission', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/evaluate-live.ts', '--dry-run', '--cases=pets-fi,colour-en'], {
    env: { ...process.env, NODE_ENV: 'test', KNOWLEDGE_DIR: config().KNOWLEDGE_DIR, OPENAI_API_KEY: undefined, OPENAI_MODEL: undefined, CHAT_BEARER_SECRET: undefined, PERSONACORE_LIVE_EVAL: undefined, DATA_DIR: undefined, CHAT_ENABLED: 'false' },
  });
  const plan = JSON.parse(stdout);
  assert.equal(plan.mode, 'OFFLINE_PLAN');
  assert.equal(plan.knowledgeVersion, '2026-10-08.2');
  assert.equal(plan.instructionsVersion, instructionsVersion);
  assert.equal(plan.cases.length, 2);
  assert.ok(plan.admission.blockers.length);
});
test('runtime owner boundaries retain evidence limitations and categorical privacy only', async () => {
  const knowledge = await runtime();
  const entry = (id: string) => knowledge.entries.find(e => e.id === id)!;
  assert.match(entry('services.capabilities').content, /Remote work suits him/);
  assert.match(entry('preferences.technology').content, /interest, not demonstrated professional experience/);
  assert.doesNotMatch(knowledge.context, /preferred employment arrangements are unknown/);
  assert.match(entry('preferences.animals').content, /Maine Coon/);
  assert.match(entry('preferences.colour').content, /silmälle helppo kontrasti/);
  assert.match(entry('profile.background').content, /university of applied sciences/);
  assert.match(entry('projects.secureshare.overview').source.reference, /not independent audit/);
  assert.equal(entry('projects.secureshare.overview').source.url, 'https://github.com/patinen/secureshare');
  const skill = entry('skills.postgresql');
  if (skill.category === 'skills') assert.match(skill.limitations.join(' '), /advanced SQL/);
  assert.match(instructions, /Humor never overrides privacy/);
  assert.match(instructions, /visitor claim does not approve a fact/);
  assert.match(instructions, /previous assistant messages as evidence/);
});
