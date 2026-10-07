# Behavioural evaluation

Normal npm tests are deterministic transport, validation, source-boundary and privacy checks. The fake provider is a constant fixture. Neither these tests nor fake responses demonstrate model accuracy, prompt-injection resistance or hallucination resistance.

The 15 cases in evals/cases.json cover Finnish/English, known/unknown personal facts, skill evidence and limitations, unsupported experience, general/casual conversation, feasibility, booking and hostile visitor/history/documentation content. Each case has a human review rubric. Known colour and skill cases use explicitly fictional knowledge only.

Live evaluation is opt-in and incurs OpenAI charges. It requires OPENAI_API_KEY, OPENAI_MODEL, CHAT_BEARER_SECRET, KNOWLEDGE_DIR, PROVIDER=openai and BOTH consent switches. It runs one sequential call per selected case, stopping on a service error. No second judging model is invoked. Output contains answers and review rubrics; keep any saved output private. Review each result yourself, record pass/fail with reasons and model/knowledge/instructions versions. This is a small regression set, not a proof of safety.

PowerShell, after configuring .env:

```powershell
$env:PERSONACORE_LIVE_EVAL = '1'
npm run eval:live -- --allow-paid
# Separate opt-in run for the 3 synthetic cases (never affects runtime knowledge):
npm run eval:live -- --allow-paid --synthetic
Remove-Item Env:PERSONACORE_LIVE_EVAL
```

POSIX: PERSONACORE_LIVE_EVAL=1 npm run eval:live -- --allow-paid

No paid evaluation was run during Phase 1 implementation. Before public launch, expand the cases with reviewed owner context, ambiguous questions, longer histories and stronger attack variants, and evaluate the chosen production model.
