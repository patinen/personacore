# Reviewed GitHub documentation ingestion

This is an offline authoring workflow. Chat never fetches GitHub. Fetching creates untrusted drafts outside knowledge/runtime; it cannot publish or replace owner interview entries. Documentation describes project behaviour, not Juho's proficiency, sole authorship, professional experience, audits or compliance. Owner interview and documentation provenance remain distinct.

## Selected sources

Public root/docs listings and README headings were inspected on 2026-10-08. SecureShare, ProjectPulse and StatusCore have root README.md but no root docs directory. PersonaCore also has docs/api.md. Exact selections are versioned in ingestion/sources.json:

| Repository | Path | Exact heading | Stable ID |
| --- | --- | --- | --- |
| patinen/secureshare | README.md | Architecture | docs.secureshare.architecture |
| patinen/projectpulse | README.md | Architecture | docs.projectpulse.architecture |
| patinen/statuscore | README.md | Architecture | docs.statuscore.architecture |
| patinen/personacore | README.md | API | docs.personacore.api |
| patinen/personacore | docs/api.md | PersonaCore API v1 | docs.personacore.api-contract |

All currently select main. No recursive traversal, source-code discovery, issues, chats, environment files, linked documents, image retrieval or credentials. Adding paths/sections is an explicit manifest review, not automatic discovery.

## Fetch to drafts

From the repository root:

```powershell
npm.cmd run docs:fetch
npm.cmd run docs:fetch -- --ids=docs.secureshare.architecture
```

On POSIX use npm. The CLI rejects unknown/duplicate switches and IDs. It verifies each repository is public, resolves the selected branch through GitHub to a 40-character SHA once per repository/branch, then fetches every selected document at that immutable SHA. It uses no authentication, follows no redirects and makes no retries.

Limits: at most 20 selected sources; each request has a 10-second deadline including body reading, metadata at most 200,000 bytes and each Markdown document at most 65,536 bytes. Content-Length is not trusted. UTF-8 must be valid. Only the exact heading and its subsections are extracted, respecting fenced code and stopping at the next heading of equal/higher level. No content is silently truncated.

A new, exclusively created ingestion/drafts/<retrieval-time>.json contains available draft entries and explicit failed/removed/oversized/selection_missing results. Each candidate records repository, path, SHA, retrieval timestamp, heading, full decoded-document SHA-256 and immutable GitHub blob URL. Normal runtime loading reads only knowledge/runtime/pack.json and filters drafts before context construction. Draft bundles are a different purpose/schema and cannot be used as runtime packs.

## Review and individual promotion

Review the immutable source and candidate yourself. Check factual scope, limitations, unsupported personal claims, stale/contradictory statements, malicious instructions, links and authoring size. Fetched prose is reference data, never behavioural authority. A review approval does not establish an independent audit.

Promotion is offline, one ID at a time, preview by default:

```powershell
npm.cmd run docs:promote -- --batch=ingestion/drafts/<file>.json --id=docs.secureshare.architecture --reviewer="Owner reviewer" --review-date=2026-10-08 --version=<new-pack-version>
```

Use the actual reviewer/date, on or after retrieval and not in the future. Inspect the preview, then repeat the same command with --apply to write the local runtime pack. No promotion was applied during Phase 3B.

Optional --summary-file=<local-markdown-file> replaces the extracted text with an individually reviewed manual summary while retaining original provenance. It is not AI summarization. Selected sections above 6,000 characters produce an empty draft plus an oversized report; a source-checked manual summary is required. Documents above the byte limit have no candidate: narrow/split the source document or curate a smaller allowlisted documentation path and refetch. Missing headings require explicit selection review. Never guess or silently cut material.

Promotion validates the draft, provenance, reviewer, date, version and resulting pack. It checks the full published context against 30,000 characters by default, not just the new excerpt. --max-context-chars may explicitly match an already-reviewed service budget; it does not change service configuration. Prefer concise summaries/narrower selections over increasing it. Overflow leaves the runtime file untouched and explains authoring guidance.

The apply path uses an exclusive local lock, a temporary file and atomic rename after verifying the runtime file has not changed. Do not edit the runtime concurrently. A leftover lock/temp file after interruption requires inspection before manually removing it. This is local authoring, not a database or multi-writer publication service.

## Updates and removals

Refetch selected sources to a new bundle. Full document hashes show upstream changes even outside the selected section. Preview reports added/updated/same-source. A new revision replaces the same stable ID; it never appends a second published version. Older retrieval batches, ID collisions with owner entries and conflicting source IDs are rejected. Always compare updated text and existing owner-described statements; docs do not silently supersede the interview.

Only a document 404 at a successfully resolved public immutable revision means removed. Auth/rate/network errors, missing branches or missing headings do not imply deletion. Retirement is explicit:

```powershell
npm.cmd run docs:promote -- --batch=ingestion/drafts/<file>.json --id=<existing-import-id> --reviewer="Owner reviewer" --review-date=<actual-date> --version=<new-version> --retire
```

Preview, then --apply after review. Retirement marks the imported entry draft and excludes it from model context; the prior immutable provenance remains available for authoring history. For a removed manifest selection or renamed heading/path, first review/withdraw the old entry explicitly, then review the new manifest ID/selection. Do not reuse a stable ID for unrelated content.

## Evaluation and maintenance

Six Finnish/English documentation cases live in a separate fictional documentation-fixture lane:

```powershell
npm.cmd run eval:plan -- --documentation
npm.cmd run eval:plan -- --documentation --cases=doc-facts-fi,doc-unknown-en,doc-injection-fi
```

They cover documentation-backed architecture, unknown implementation/audit details and hostile embedded directives. The fixture is labelled fictional and is never owner/runtime evidence. Existing runtime and synthetic lanes remain separate. Any later paid run still requires both consent switches and normal usage admission; no paid calls are part of ingestion or tests.

After an approved local promotion, update matching runtime cases to the actual published IDs, then lint, typecheck, run deterministic tests/build and offline planning. Human real-model review remains later opt-in work. Deterministic tests establish workflow contracts, not hallucination or injection resistance.

Initial public fetch review note: all five selections succeeded and remain drafts. Their combined raw promotion would be approximately 32,032 context characters (reviewer-label dependent), above 30,000. The API-contract section alone is 5,818 characters; curate a shorter reviewed summary or narrower selection before publishing all five.
