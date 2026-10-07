# Phase 1 validation — 2026-10-07

Completed locally with Node v22.17.1 and npm 10.9.2. The npm v3 lockfile resolves Fastify 5.12.5, OpenAI SDK 6.49.0 and Zod 4.6.5. The SDK's installed Responses and Zod helper types were inspected before completing the real adapter.

| Check | Result |
| --- | --- |
| npm run lint | Passed |
| npm run typecheck | Passed, strict TypeScript |
| npm test | Passed: 24 tests, 0 failures; provider injection/mock SDK transport only |
| npm run build | Passed |
| npm run eval:live without opt-in | Refused with exit code 1, as expected; no provider call |
| docker build -t personacore:phase1 . | Passed; Node 22 Alpine multistage image and npm ci from lockfile |
| Local container smoke | Passed: HTTP health 200, missing auth 401, valid synthetic auth with unconfigured real provider 503 |
| Container packaging | Nonroot, no test/example knowledge, no TypeScript development dependency or .env |
| Docker healthcheck | healthy |
| Container SIGTERM shutdown | Clean exit code 0; temporary container removed |
| Paid live model evaluation | Not run; explicitly opt-in only |
| Portfolio git status | Clean before and after; no existing repository files modified |

Coverage includes published-only knowledge, duplicate/schema/review validation, synthetic/runtime separation, privileged client role rejection, auth, source ID/URL validation, provider failures/refusals/incomplete output, timeout and concurrency retention, input/history/body/output/context limits, rate limiting, fake-provider restrictions, log privacy and the Responses request shape. A citation URL test caught URL normalization stripping control characters before validation; original strings are now checked directly.

The restricted Windows runner could not initially start command processes and prevented tsx from querying OS user information. Installation and requested checks succeeded using the working approved runner. Docker 28.3.2 was available and the container checks ran locally. No required check remained unavailable.

These are deterministic application/transport checks and a production-container smoke test. They do not prove real-model hallucination or prompt-injection resistance. The 15-case behavioural evaluation set and manual rubrics are provided separately. No API keys, paid requests, commits, pushes, remote repository creation, deployment or production Directus changes were used.

## Routed chat authentication and rate-limit fix — 2026-10-07

Reviewed baseline: b1a652511a02c5241e6d3567dcdd35769d5d0c48. PersonaCore was clean before changes; no applicable AGENTS.md was found. Work is limited to src/app.ts, tests/chat-route-security.test.ts and this validation record.

The baseline global onRequest hook checked the raw URL against /v1/chat. Fastify also dispatches /v1/%63hat and /v1/ch%61t to that registered route, so those paths skipped both protection checks. With the new injected-provider regression file and the implementation still unchanged, node --import tsx --test tests/chat-route-security.test.ts ran 16 cases: 6 passed and 10 failed, reproducing unauthorized/unconfigured provider invocations and shared-quota bypasses.

Authentication and the existing shared fixed-window limiter now run in the registered POST /v1/chat route's onRequest hook. Protection does not compare, decode or normalize request URLs. The shared bucket and rate-limit-before-auth ordering are preserved, including quota consumption by unauthorized requests. Global request timing, generated IDs, response headers and completion logging remain global. The handler's validation, concurrency, timeout and output handling are unchanged.

The 16 new regression cases cover canonical and both router-supported encoded paths: missing/incorrect credentials return 401 within quota without provider invocation; missing bearer configuration returns 503 without invocation; valid credentials succeed; consuming quota through any of these paths blocks every variant with 429 and Retry-After without another invocation; /health remains public and makes no provider calls after exhaustion. They also check request IDs/headers and that unauthorized encoded attempts consume the shared bucket.

| Fix validation (Node v22.17.1) | Actual result |
| --- | --- |
| npm run lint | Passed |
| npm run typecheck | Passed |
| npm test | Passed: 40 tests, 0 failures (24 existing + 16 new) |
| npm run build | Passed |

All new regressions use injected providers only. Existing SDK tests mock transport. No paid calls or real-model behaviour were tested. The knowledge pack and dependencies were not modified. Phase 2 was not started; no commit, push or deployment was performed. The original Phase 1 Docker results above are historical; Docker was not rebuilt for this narrowly scoped fix.

## Phase 2 validation — 2026-10-08

Started from a clean reviewed baseline 39f127e1b9584ef22d4cab6906c3b51c11b099c2. No applicable AGENTS.md was found. Knowledge content remains unchanged. The portfolio repository was modified separately as explicitly requested.

| Check | Actual result |
| --- | --- |
| Node / npm | v22.17.1 / 10.9.2 |
| npm run lint | Passed |
| npm run typecheck | Passed |
| npm test | 56 passed, 0 failed |
| npm run build | Passed |
| Final Docker build | Passed; Node 22 Alpine, container Node v22.23.3 |
| Local container smoke | Passed: public health, auth rejection, unavailable real provider, nonroot process, writable data volume, read-only knowledge, production-only packaging |
| Persistence | Reservation survived restart and replacement of the container using the same disposable local volume |
| Operational inspection | Aggregate-only readonly query returned one reserved attempt, zero successes and zero measured calls |
| Healthcheck / shutdown | healthy / SIGTERM exit 0 |
| Live model evaluation | Not run |

Coverage retains the canonical and encoded-path security regressions and adds validated internal identities, atomic concurrent admission, reopening/migrations, separate database handles and lock failure, aggregate/visitor allowances, visitor rate windows, Helsinki summer/winter midnight and DST boundaries, retention, errors/timeouts/disconnects retaining reservations, measured usage, disabled/unconfigured service, database fail-closed behaviour and concurrency rejection before reservation. The mocked SDK transport confirms a request overrides even an injected client's retry setting to zero. Logs exclude raw visitor identity as well as conversations and secrets.

Docker smoke used only a synthetic bearer secret and no provider credentials. Initial local invocations with an insufficient secret and without the inspection command's required path were rejected as expected; corrected invocations passed. The final image was tested with the persistent QA volume, then the disposable container and volume were removed. SQLite emits Node's experimental-feature warning; the implementation uses the documented Node 22.17 APIs.

These are deterministic application, mocked-transport and container checks. They do not establish actual model behaviour, hallucination resistance or an exact currency cap. No paid calls, commit, push, deployment or production Directus mutation occurred. Activation also requires the portfolio/CMS operational steps and later real-model evaluation.

## Rejected-response usage correction — 2026-10-08

Reviewed baseline 496e123f4979cca47f3fe06b275de09c738a4adc; working tree initially clean. Installed OpenAI SDK types and implementation were inspected: responses.parse invokes output parsing after create and can reject before exposing usage. The adapter now uses non-streaming responses.create with the same structured-output schema, store:false, signal and zero retries. It captures counters before status/refusal checks and strict JSON/Zod parsing. A typed ProviderRejected error carries counters only to application accounting; raw responses and parsing errors are never exposed. Successful and rejected settlement paths are mutually exclusive, so measured usage is recorded once independently of answer acceptance.

Mock adapter-to-application regressions cover completed, incomplete, refused, malformed JSON, invalid schema, transport failure, absent usage and invalid counters. Rejected answers return 502 with attempts=1, successes=0, measured_calls=1 and tokens=42/12/54 when those counters were returned. Transport/unknown/invalid usage creates no measurements. Reservations, concurrency, cancellation, encoded-route protection and zero retries remain covered.

Node v22.17.1: lint, typecheck, full tests (64 passed, zero failures) and build passed. All SDK requests use mocked transport; no live model behaviour or paid calls were tested. Knowledge, activation and deployment were unchanged; no commits or pushes.

Official API context: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) documents refusal and incomplete-response handling. Installed SDK implementation was the source for the local create/parse decision.
