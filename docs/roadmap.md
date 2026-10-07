# Roadmap

## Phase 1 implemented

Independent TypeScript/Fastify service, validated published-only file knowledge, reviewed minimal product facts, versioned conversational Finnish/English first-person instructions, typed health/chat APIs, real Responses adapter and explicit development fixture, server bearer authentication, per-process rate/concurrency/input/context/output/time limits, sanitized structured request logs, Docker packaging, deterministic tests, Finnish owner questionnaire and opt-in live evaluation cases.

## Phase 2 before public use

- Fill and review owner context, evidence-based skill entries and project responsibilities; keep unknown details unpublished.
- Add a portfolio server proxy that holds the bearer secret; visitors must never receive it. Fit chat into the existing cold technical portfolio and clearly label it an AI representative. Do not create a biography, booking interface or sales landing page.
- Add public visitor/session limits, persistent aggregate usage/spending budgets and coordination across replicas. Handle proxy authentication, abuse controls and safe source rendering.
- Review real model behaviour with the opt-in evaluation set and additional owner-grounded regression cases; mocked tests do not establish hallucination resistance.
- Plan explicit reviewed Directus documentation sync with publication boundaries and project sections overview, architecture, system_flow, engineering, implementation and interface. No automatic private repository/account ingestion.
- Write PersonaCore's portfolio case study using those existing sections. Describe actual implementation and limitations, not future features as if deployed.

## Later, optional

Streaming, retrieval if the reviewed corpus outgrows explicit context, richer citations and operational visibility. Booking could be a separate integration in another implementation; this portfolio demo has no calendar/booking functionality. No deployment or production Directus mutation is included in Phase 1.
