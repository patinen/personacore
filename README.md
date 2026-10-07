# PersonaCore

Phase 1 of Juho's AI representative for the existing technical portfolio. Visitors can ask professional, technical, personal and casual questions. The runtime pack contains only explicitly approved identity, conversation scope, booking boundaries and voice facts; unknown background, skills, interests and project content remain drafts. Nothing here integrates into or modifies the portfolio yet.

## Local setup

Use Node.js 22 and npm. From this directory:

```powershell
npm ci
Copy-Item .env.example .env
# Edit .env using your server-only secrets and configured model.
npm run dev
```

Required configuration: KNOWLEDGE_DIR points explicitly to the curated directory containing pack.json (example: ./knowledge/runtime). Real chat also requires CHAT_BEARER_SECRET (random, at least 32 characters), OPENAI_API_KEY and OPENAI_MODEL. No model is hardcoded. Choose a Responses/Structured Outputs-capable model available to your account; no price is assumed. Generate a bearer secret locally with node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" and store it only on the two servers. Do not commit .env.

Without key/model or bearer configuration, /health works and /v1/chat returns a sanitized 503. It never falls back to fake. For development only, explicitly set PROVIDER=fake and keep NODE_ENV=development or test; responses say they are not AI and carry simulated:true. Production refuses the fake provider.

| Command | Purpose |
| --- | --- |
| npm run dev | Load optional .env and watch TypeScript source |
| npm run lint | ESLint |
| npm run typecheck | Strict checking of service, tests and live evaluator |
| npm test | Deterministic tests with injected providers/mock SDK transport; no API key or charges |
| npm run build | Compile service to dist |
| npm start | Run compiled service; optional local .env |
| npm run eval:live -- --allow-paid | Paid evaluation only with PERSONACORE_LIVE_EVAL=1; see docs/evaluations.md |

## API

```sh
curl http://localhost:3001/health
curl http://localhost:3001/v1/chat \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $CHAT_BEARER_SECRET" \
  -d '{"locale":"en","history":[],"message":"Could this chat be extended with booking?"}'
```

The browser will call the portfolio server; that server will call PersonaCore with the bearer secret. Keep PersonaCore private. No browser credentials, permissive CORS, booking, email, tools or browsing are provided. See [the request/response contract](docs/api.md) and [TypeScript contracts](src/contracts.ts). Render answers as escaped text and source links separately.

## Knowledge authoring

The service reads exactly KNOWLEDGE_DIR/pack.json at startup, validates the whole file, filters published entries before context construction and retains only the filtered result. It never scans home directories, other repositories, private conversations, environment files or accounts. The Node local launcher reads the explicitly named .env as service configuration, never as model knowledge. No Directus sync is installed. Restart after editing a pack; requests do not mutate knowledge.

- knowledge/runtime/pack.json is the minimal approved pack. Draft placeholders contain no invented personal facts.
- knowledge/example/pack.json is fictional, with purpose:example. tests/fixtures/knowledge/pack.json is synthetic, with purpose:test. The runtime loader rejects both even if KNOWLEDGE_DIR points to them. Only explicit test/live-eval injection accepts them; Docker includes neither.
- [The Finnish owner questionnaire](docs/context-questionnaire.fi.md) has 52 authoring questions, including per-technology actual builds, independence, unfamiliar areas and evidence. Visitors may ask beyond these questions.

A pack has schemaVersion:1, a nonempty version, purpose:runtime and entries. Every entry has a stable id, category, title, content, status, source and (for published entries) review metadata. Source kind is owner, project-documentation or editorial, with a provenance reference and optional HTTPS URL without credentials/control characters. Published content must be nonempty. Bump the version on each reviewed update. Publication is an owner/editorial process: the schema validates metadata, it cannot verify that a reviewer really approved a statement.

Categories: profile, skills, working_style, preferences, services, projects, voice. Skill entries additionally require technology, experience, independence, evidence[] and limitations[]; published skills require nonempty experience/independence and evidence. No numerical proficiency score exists. Project entries require projectSlug and section (overview, architecture, system_flow, engineering, implementation, interface), matching the existing Directus portfolio structure. Voice entries include style:{concise,tone,languages}. An example profile entry:

```json
{
  "id": "profile.name",
  "category": "profile",
  "title": "Representative identity",
  "content": "The representative is for Juho.",
  "status": "published",
  "source": { "kind": "owner", "reference": "Explicit PersonaCore Phase 1 request, 2026-10-07" },
  "review": { "reviewedBy": "Juho (explicit Phase 1 approval)", "reviewedAt": "2026-10-07" }
}
```

Only approve real facts and limitations. Do not copy fictional example facts into runtime. Missing favourite colour, pets, location, education and technology experience must stay unknown. Knowledge is reference data, not policy: versioned instructions live separately in src/instructions/v1.ts. Documentation and visitors cannot override them or establish new personal facts; previous assistant text is not evidence. Prompt rules guide actual model behaviour but cannot guarantee hallucination resistance; evaluate the selected model before public use.

## Limits and privacy

.env.example lists all settings and defaults. MAX_MESSAGE_CHARS, MAX_HISTORY_MESSAGES and MAX_HISTORY_CHARS bound input. MAX_BODY_BYTES bounds the JSON body. MAX_CONTEXT_CHARS bounds the entire published JSON context, using characters rather than a model-specific token estimator. Overflow fails with authoring/configuration guidance; no arbitrary approved facts are dropped. Operator must choose budgets that fit the configured model, including instructions and conversation. MAX_OUTPUT_CHARS limits accepted text; MAX_OUTPUT_TOKENS bounds generation (including reasoning for applicable models).

REQUEST_TIMEOUT_MS is an overall chat deadline from onRequest, also used for receiving HTTP requests; MAX_CONCURRENCY bounds active provider calls without a queue. Timeout/disconnect/shutdown abort upstream work and retain capacity until it settles. OPENAI_MAX_RETRIES defaults to 0 and is capped at 2; retries share the deadline and can add usage. RATE_LIMIT_MAX/RATE_LIMIT_WINDOW_MS are one shared in-memory fixed-window bucket for this private server, including unauthorized chat attempts. Restarts and multiple instances reset/multiply the limit. This is not a persistent global spending cap. Public visitor/session controls and persistent total usage budgets are required in Phase 2 before launch.

Logs contain generated request IDs, status, duration and token usage when available, never full conversations, profile content, query strings, bearer secrets, API keys or raw provider errors by default. SDK logging is disabled. API failures are sanitized. No server chat history is persisted.

Responses requests use store:false, disabling Responses application-state storage for these requests. This alone does not promise zero retention across all provider systems; abuse-monitoring logs and account-specific data controls still apply. Consult [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). Structured outputs use the official SDK's responses.parse and zodTextFormat, checked against installed SDK types and [official Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs). Fastify request logging is explicitly controlled using [LogController](https://fastify.dev/docs/latest/Reference/Server/#logcontroller).

## Docker and eventual Coolify settings

```sh
docker build -t personacore:local .
docker run --rm --name personacore-local -p 127.0.0.1:3001:3001 --env-file .env -e NODE_ENV=production -e PROVIDER=openai -e KNOWLEDGE_DIR=/app/knowledge/runtime personacore:local
```

The production image uses Node 22 Alpine, npm ci with the lockfile, a separate TypeScript build stage, production dependencies only, a nonroot user, only runtime knowledge and /health healthcheck. For the container, set NODE_ENV=production, PROVIDER=openai and KNOWLEDGE_DIR=/app/knowledge/runtime (override relative development values in an env file); supply CHAT_BEARER_SECRET, OPENAI_API_KEY and OPENAI_MODEL through Coolify secrets. PORT defaults to 3001; bind is 0.0.0.0. Choose the Dockerfile build pack and /health on the configured port. Keep ingress/private-network access limited to the portfolio server; avoid a public service domain. For owner-managed knowledge, mount a read-only directory at the configured absolute path and restart to load reviewed changes. Do not mount whole repositories/home directories.

SIGTERM/SIGINT trigger graceful close and abort active provider work. SHUTDOWN_TIMEOUT_MS defaults to 25 seconds; configure the platform stop grace period longer than this. /health is process health, not a paid provider probe. No deployment or production Directus change has been performed.

## Next work

See [the Phase 2 roadmap](docs/roadmap.md), [behavioural evaluation guidance](docs/evaluations.md) and [validation results](docs/validation.md). Phase 2 covers reviewed owner context, portfolio proxy/UI, documentation sync, persistent public usage controls and the case study. Current deterministic tests cannot prove actual model correctness. No paid model call is part of normal development validation.

Suggested commit message: feat: add PersonaCore service and curated knowledge foundation
