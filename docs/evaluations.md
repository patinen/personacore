# Grounded behavioural evaluation

Normal tests check application contracts, provenance, isolation and evaluator admission planning. Mocks and fake providers do not demonstrate real-model voice, accuracy or hallucination/prompt-injection resistance.

evals/cases.json contains 74 runtime and 3 isolated synthetic cases. Finnish/English runtime rubrics reflect the approved interview. Synthetic colour/skill/document-injection facts remain fictional, never owner evidence.

## Offline review

No API key, consent switches or provider request required:

```powershell
npm run eval:plan
npm.cmd run eval:plan -- --cases=pets-fi,colour-en,postgresql-fi
npm.cmd run eval:plan -- --synthetic
```

Plans show selected prompts/rubrics, knowledge/instructions versions, context size, admission requirements, pacing and blockers. The plan defaults to runtime knowledge without reading .env. Supply relevant environment configuration explicitly to inspect limits. Existing DATA_DIR counters are queried read-only without migration/reservation; unreadable databases stop planning. No secrets are printed.

## Later paid evaluation — owner action

Both PERSONACORE_LIVE_EVAL=1 and --allow-paid remain mandatory. Configure PROVIDER=openai, OPENAI_API_KEY, OPENAI_MODEL, CHAT_BEARER_SECRET, KNOWLEDGE_DIR, CHAT_ENABLED=true and zero SDK retries. Production requires persistent DATA_DIR. Use a dedicated local evaluation configuration; the evaluator never raises production limits.

```powershell
$env:PERSONACORE_LIVE_EVAL = '1'
npm.cmd run eval:live -- --allow-paid --cases=pets-fi,colour-en,postgresql-fi
Remove-Item Env:PERSONACORE_LIVE_EVAL
```

The full 74-case runtime set exceeds the default visitor allowance of 10 and is blocked before calls. Select a small subset or explicitly configure suitable evaluation limits yourself. Remaining aggregate allowance must cover the selection. One fresh identity is used per run, never rotated between cases; aggregate counters are not replenished.

Calls are sequential without retries. Default pacing conservatively derives from visitor and aggregate windows. --pace-ms can increase pacing but cannot be below the displayed minimum. Each call passes normal admission. Preflight counters are advisory: concurrent activity can consume allowance after inspection. Service errors stop evaluation; reservations remain consumed.

Review answers yourself against rubrics; record model/knowledge/instructions versions and failures with reasons. No judging-model calls. Keep saved outputs local. No paid evaluation was performed.

PowerShell examples use npm.cmd to preserve forwarded CLI switches in this environment. On POSIX use npm, or invoke node --import tsx scripts/evaluate-live.ts --dry-run --cases=pets-fi,colour-en directly. Always inspect the selected case IDs in the offline plan before paid execution.

Phase 3B adds 6 separate fictional documentation cases: npm.cmd run eval:plan -- --documentation. Use --cases=doc-facts-fi,doc-unknown-en,doc-injection-fi to select a subset. This lane loads tests/fixtures/ingestion/evaluation-pack.json, never the active runtime pack; --documentation and --synthetic are mutually exclusive. Documentation cases do not establish actual project or owner facts.

Phase 3C adds 20 Finnish/English runtime cases grounded in docs.*.overview entries, covering workflows, source limitations, planned versus implemented behaviour, missing details, stale README facts and personal-skill boundaries. Fictional documentation cases remain in their separate lane. Representative offline plan: npm.cmd run eval:plan -- --cases=real-secureshare-flow-fi,real-projectpulse-plans-en,real-statuscore-flow-en,real-personacore-flow-fi,real-docs-vs-skills-en
