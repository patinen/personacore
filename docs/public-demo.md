# Persistent public-demo admission (Phase 2)

Keep CHAT_ENABLED=false until the portfolio CMS/configuration and later real-model evaluation are complete. The service is private: browser → same-origin portfolio API → PersonaCore → provider. The portfolio adds the matching CHAT_BEARER_SECRET and an internal x-personacore-visitor header containing a verified/generated 32-byte base64url anonymous identity (43 characters). All registered canonical/encoded chat requests run the repaired route-level rate/auth hook. Missing/invalid visitor identity returns 400 invalid_visitor, never an unlimited path.

## Configuration and ordering

Node >=22.17 <23 is required. The implementation uses the [documented Node 22.17 node:sqlite DatabaseSync API](https://nodejs.org/download/release/v22.17.0/docs/api/sqlite.html); Node may emit an experimental SQLite warning. Production requires DATA_DIR configured separately from KNOWLEDGE_DIR. An unwritable/malformed/unavailable database makes chat return a sanitized 503 while /health remains process health. Configuration errors (including absent production DATA_DIR) prevent startup. No application can prove a writable path is backed by a durable volume.

Admission validates bearer authentication, input and internal identity; checks the disable switch, provider availability and concurrency capacity; then executes BEGIN IMMEDIATE to atomically check and reserve aggregate/per-visitor allowances and visitor rate capacity. COMMIT completes before provider invocation. No reservation is refunded on provider errors, invalid answers, timeouts, client/proxy disconnects or process crash. Capacity rejection and missing provider configuration do not reserve attempts. Measured usage is recorded when the provider returns counts, including a late result if the process/database remain available; unknown/aborted usage is never invented. successes counts validated completed answers, not a guarantee of browser delivery. measured_calls and token columns are separate from attempts.

| Setting | Default |
| --- | --- |
| CHAT_ENABLED | false |
| DATA_DIR | required in production; .env.example uses ./data locally |
| DAILY_ATTEMPT_CAP | 100 aggregate reserved attempts/day |
| VISITOR_DAILY_ALLOWANCE | 10 attempts/session/day |
| VISITOR_RATE_MAX / VISITOR_RATE_WINDOW_MS | 5 admitted attempts per 60-second fixed window/session |
| USAGE_RETENTION_DAYS | 14, maximum 90 |
| RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS | 30 chat requests per 60 seconds/process, including unauthenticated attempts |
| MAX_CONCURRENCY | 4 provider calls, no queue |
| OPENAI_MAX_RETRIES | must be 0; enforced on client and each Responses request |

Calendar days use Europe/Helsinki, not rolling 24-hour periods. Intl timezone rules handle summer/winter offsets; tests inject the clock and cover midnight and DST dates. Counter cleanup runs transactionally on admission, keeping current/retained days; it is lazy if the service is idle or admissions are refused. No session/IP claim is treated as a unique person. Cookie deletion, expiry or signing-secret rotation may grant a new per-session allowance, but never resets the aggregate daily cap. Fixed-window boundary bursts are possible. No X-Forwarded-For or proxy/IP trust is configured.

This is a hard model-attempt allowance with bounded input/context and MAX_OUTPUT_TOKENS, not an exact currency budget. Prices and reasoning-token behavior depend on the selected model. Aborted calls can cost usage without measured tokens; retries would break one-reservation/one-attempt accounting and are prohibited. Proxy retries are also disabled.

## One instance and persistent storage

Deploy exactly ONE PersonaCore instance with ONE persistent local volume at /app/data. Separate SQLite files do not coordinate replicas. Do not horizontally scale this deployment. SQLite WAL and synchronous=FULL are configured. Versioned, idempotent migration v1 is applied under a transaction using PRAGMA user_version; newer unknown versions fail closed. Back up the database consistently with its WAL or stop the instance before copying. Do not delete/replace the database to rotate a container. Protect host volume backups as operational data.

The Docker image runs as node (UID/GID 1000), creates /app/data with mode 700 and mounts that directory separately from read-only /app/knowledge/runtime. For bind mounts, the host directory must already be writable by UID/GID 1000. A named local Docker volume initializes from the prepared image directory; explicitly mount the same named volume on every replacement container. Coolify must retain this volume across rebuilds/redeploys; writability alone does not establish durability. Never place usage.sqlite in the knowledge pack.

Local example, no deployment:
```sh
docker build -t personacore:local .
docker volume create personacore-data
docker run --rm --name personacore-local --mount type=volume,source=personacore-data,target=/app/data --env-file .env -e NODE_ENV=production -e DATA_DIR=/app/data -e KNOWLEDGE_DIR=/app/knowledge/runtime -e CHAT_ENABLED=false personacore:local
```

Inspect aggregate counters locally without an API/admin dashboard:
```sh
npm run usage:inspect -- /absolute/data/usage.sqlite
docker exec personacore-local node scripts/usage.mjs /app/data/usage.sqlite
```
The read-only command prints day, attempts, successes, measured calls and measured tokens only. Counters store hashed visitor IDs, never raw IDs, cookies, bearer/API secrets, profile content, messages or answers. Default request logs include request ID, status, duration and measured tokens, not visitor identities/conversations. Use the operator disable switch to stop new model attempts; in-flight work remains reserved and may finish. Database/accounting failure latches chat unavailable until a corrected process restart.

## Matching portfolio configuration

Portfolio requires PERSONACORE_ENABLED=true, PERSONACORE_URL (private origin), PERSONACORE_ORIGIN (exact browser origin), PERSONACORE_BEARER_SECRET matching CHAT_BEARER_SECRET and a separate random PERSONACORE_SESSION_SECRET. Keep both services off by default. Set OPENAI_API_KEY and OPENAI_MODEL on PersonaCore only. Rotate bearer secrets on both servers together; mismatches sanitize to unavailable/failure. Rotate the portfolio session secret separately: old signed cookies are rejected (not silently accepted or renewed); users must clear invalid cookies or await an operational session transition. Aggregate counters remain intact.

Portfolio v1 matches MAX_MESSAGE_CHARS=4000, MAX_HISTORY_MESSAGES=12, MAX_HISTORY_CHARS=16000, MAX_BODY_BYTES=32768 and MAX_OUTPUT_CHARS=4000. Do not reduce service limits below these or increase them expecting the proxy/UI to follow automatically. The proxy accepts at most 32768 response bytes and 20 safe HTTPS sources. PersonaCore REQUEST_TIMEOUT_MS defaults to 20000; portfolio overall PERSONACORE_TIMEOUT_MS defaults to 25000, allowing some CMS/transport overhead. Keep upstream/platform timeouts above the application deadlines. Each hop aborts on its deadline/disconnect and never retries generation.

## Still required before activation

Mount/verify the persistent volume, configure the secrets/model/limits/private ingress, apply/review the portfolio CMS package, and perform explicitly opt-in real-model evaluation. Phase 3 will expand approved owner context and skill evidence, ingest reviewed project documentation, author the case study, and strengthen abuse/behavioural evaluation. The existing knowledge pack remains unchanged. No booking, calendar, email or execution ability was added.
