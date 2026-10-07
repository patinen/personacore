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
