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

## Phase 3A owner knowledge and evaluation preparation — 2026-10-08

Started clean at service baseline 0970fe4a2ae8c69334380b874d3c5bcb0e2102e2 and portfolio feature baseline 57e656787aa200763ce1698d4dedf61ca6e94a6b. No applicable AGENTS.md was found. Portfolio stayed clean on feat/personacore-chat; main was untouched.

Runtime pack 2026-10-08.1 contains 21 published owner-interview entries, 16,681 context characters against the unchanged 30,000 default. Instructions v2 (2.0.0) add approved dry voice, evidence distinctions and categorical privacy. No cat identifier or excluded personal values were supplied/stored; no external project material was fetched.

Node v22.17.1: lint, strict typecheck, all 68 deterministic tests and production build passed. Existing security, persistent usage, rejected-output accounting and timeout/disconnect regressions remain passing. Initial metadata assertions for old knowledge/instructions versions failed and were updated to the explicitly versioned new content.

Offline plans passed for all 46 runtime cases, selected bilingual subsets and the 3 isolated synthetic cases, without API keys or provider calls. The full plan reports the default visitor allowance mismatch before paid execution. Planning tests cover selection, invalid IDs, config/remaining-aggregate/pacing blockers and no-key CLI output. npm PowerShell forwarding initially omitted switches; verified npm.cmd and direct-node invocations select the intended cases, and documentation uses those forms.

No paid evaluation, activation, CMS changes, deployment, commits or pushes. Deterministic checks do not establish model behaviour or hallucination resistance. Portfolio compatibility edits were unnecessary; no portfolio validation was rerun because it was unchanged.

### Approved Phase 3A supplement — 2026-10-08

Included collaboration arrangements, remote/international openness, technology tradeoffs and agent interest with explicit experience/tool boundaries. Replaced the earlier employment-arrangements gap; availability, schedules, rates and project commitments remain unconfirmed. Added the two optional voice examples without mandatory repetition.

Pack 2026-10-08.2: 22 published entries, 18,581 context characters within the unchanged 30,000 budget. Runtime rubrics now number 54, with 3 separate synthetic cases. Lint, typecheck, all 68 deterministic tests, production build and offline selected planning passed on Node 22.17.1. Portfolio remains clean on feat/personacore-chat. No paid calls, activation, CMS mutation, deployment or commits. This supplement remains in the same uncommitted Phase 3A scope.

## Phase 3B reviewed GitHub ingestion — 2026-10-08

Started clean at be94c92b7cdd89c90e0bf0f2cf2a6e29b7a288eb. No applicable AGENTS.md was found. Scope is PersonaCore only; portfolio remains clean at 57e656787aa200763ce1698d4dedf61ca6e94a6b on feat/personacore-chat.

Implemented the explicit repository/path/heading manifest, bounded immutable GitHub fetch-to-draft workflow, compatible source.github provenance, individual offline promotion preview/apply with review identity/date/version, stable-ID updates/retirement and context-budget validation. Instructions already treat documentation as untrusted and distinguish project statements from personal evidence; no instruction/version change was necessary. Six Finnish/English documentation evaluations use a separate fictional fixture lane.

Node v22.17.1: lint, typecheck, full deterministic suite (82 passed, zero failures), production build and offline documentation evaluation plan passed. Fourteen new mocked ingestion/promotion tests cover immutable pinning, exact allowlist, public repository enforcement, failure/timeout/size limits, drafts, provenance, manual summaries, updates/removals, owner preservation and overflow. Existing route-security, usage, rejected-response accounting and cancellation regressions remain passing. Initial test-only async syntax issue was corrected before the successful run.

A small public fetch succeeded for all five manifest selections, saving ingestion/drafts/2026-10-08T11-46-46-998Z.json. Both PersonaCore paths share one resolved SHA. Sources and revisions:
- patinen/secureshare README.md / Architecture: d56eacf35045d786cac19fc0a4fd26057646000e
- patinen/projectpulse README.md / Architecture: edbcd54c462cb4c2e997d1bff21a540964364c4d
- patinen/statuscore README.md / Architecture: 1ba527b2bafc3f00d8002b1727bcf515c8b23ade
- patinen/personacore README.md / API and docs/api.md / PersonaCore API v1: be94c92b7cdd89c90e0bf0f2cf2a6e29b7a288eb

Offline CLI promotion preview succeeded for SecureShare with an explicitly non-owner validation reviewer; --apply was never used. The runtime pack remains byte-for-byte unchanged (22 published entries, 18,581 context characters). All five raw excerpts together would be approximately 32,032 characters with a short reviewer label, exceeding 30,000; particularly the 5,818-character API-contract selection needs narrower selection/manual summary if all sources are desired. Exact size is checked individually at every promotion.

All new imported entries remain draft, separate from runtime. No paid calls or real-model behaviour tests, commits, pushes, activation, Directus changes, production configuration changes or deployment occurred.
