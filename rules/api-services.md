---
description: "API service patterns — workspace scoping, provider cascade, route scaffolding, JSONB types"
alwaysApply: false
paths: ["api/src/services/**", "api/src/routes/**", "api/src/middleware/**"]
globs: ["api/src/services/**", "api/src/routes/**", "api/src/middleware/**"]
tags: [api, services]
---

# API Service Patterns

## Workspace Scoping

- Every Drizzle query MUST include `eq(table.workspaceId, workspaceId)`.
- Forgetting this filter = cross-workspace data leak.
- No exceptions, even for "admin" queries — scope first, filter second.

## Large Files Navigation

- `chat-service.ts` (~5000 lines), `queue-manager.ts` (~4000), `tool-service.ts` (~2500), `llm-runtime/index.ts` (~1800).
- Search by section comment (`// === SECTION NAME ===`), don't read entire file.
- Use `grep` or `rg` to locate the function you need before opening.

## Route Pattern

- Zod input schema defines the contract.
- Hono router registers the endpoint.
- Auth middleware: `requireAuth()` for identity, `requireWorkspaceAccessRole()` for authorization.
- Route handler calls service method, returns `c.json()`.
- Never query DB directly from a route handler — always go through a service.

## Service Pattern

- Singleton class exported as a default instance (`export const fooService = new FooService()`).
- Async CRUD methods with explicit return types.
- Type conventions:
  - `*Row` — Drizzle select result (DB shape).
  - `*Data` — JSONB business payload (typed interface).
  - `*Input` — API request payload (Zod-inferred).

## Provider Cascade

- 5 LLM providers: OpenAI, Gemini, Claude, Mistral, Cohere.
- Each provider needs:
  - Message format conversion (system/user/assistant/tool roles).
  - Tool definition translation (function calling schema).
  - Response parsing (streaming chunks + final assembly).
- Changing one provider's integration requires verifying the 4 others still work.
- Provider-specific quirks are isolated in `llm-runtime/providers/`.

## JSONB Evolution

- Key JSONB columns: `initiatives.data`, `organizations.data`, `context_documents.data`.
- Adding a new field requires:
  - Update the TypeScript interface (`InitiativeData`, `OrganizationData`, etc.).
  - Update all `context-*` loaders that hydrate the data for LLM prompts.
  - Consider backward compatibility for rows missing the new field.

## Streaming

- SSE via PostgreSQL `NOTIFY`/`LISTEN` channels.
- Stream events stored in `chat_stream_events` table.
- Sequence numbers must be gap-free — missing a sequence breaks client reassembly.
- StreamHub on the UI side handles reconnection and delta aggregation.

## Circular Dependencies Warning

- `chat-service` <-> `tools` <-> `toolService` <-> `queueManager` form a dependency web.
- Refactoring any of these files is fragile — trace the full call chain before changing signatures.
- Prefer adding new methods over modifying existing ones when extending functionality.
