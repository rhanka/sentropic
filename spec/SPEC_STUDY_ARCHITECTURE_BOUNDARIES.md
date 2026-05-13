# SPEC_STUDY — Architecture Boundaries (sentropic packages)

Study only. No SPEC_VOL: intention to be validated separately.

Output of BR23 multi-source peer review (Vercel AI SDK, LangGraph, Temporal, Anthropic Agent SDK, Codex CLI, Claude Code SDK, and independent peer review).

## 1. Package cartography (post-peer-review)

Seven packages under `@sentropic/*`. The original six-package proposal was revised to add `@sentropic/events` after the peer review flagged that observability arriving last would fossilize an ad-hoc event taxonomy in `chat-core`.

| Package | Status | Owns | Doesn't own |
|---|---|---|---|
| `@sentropic/llm-mesh` | published 0.1.0 | provider adapters, model catalog, credentials, low-level provider streaming (provider-level token/delta/tool-call deltas as **provider events**, not session events), retry/fallback policy at provider call level | chat sessions, message lifecycle, persistence, workflow, telemetry sinks. Must NOT expose chat lifecycle types. |
| `@sentropic/events` (added) | new | `EventEnvelope`, `EventType` taxonomy aligned with OTel GenAI semantic conventions, sequence numbers, redaction primitives, signing hooks | sinks (Postgres/Langfuse/Datadog), business meaning of events |
| `@sentropic/chat-core` (BR14b) | in scoping | one chat session orchestration: tool loop, reasoning loop, continuation, cancel, retry, checkpoints, message lifecycle. Owns `ChatCheckpointStore<TChatState>` port. Owns `StreamBuffer` port. Owns wire protocol contract (versioned). | providers (→ mesh), UI (→ chat-ui), multi-step workflow (→ flow), persistence backend (→ adapter), transport implementation (Hono/SSE lives in `chat-core/server` sub-entry, not in mesh nor in adapters) |
| `@sentropic/chat-ui` (BR14a) | in scoping | Svelte components, hooks consuming chat-core wire protocol, stream reassembly, optimistic UI, tool result rendering, reconnect/replay client logic | server logic, mesh access, persistence |
| `@sentropic/flow` (future) | to scope | multi-step DAG (start/normal/conditional/fanout/join/end), durable execution, retries with idempotency keys, human approvals via signals/interrupts, multi-agent handoff with typed I/O contracts. Owns `FlowCheckpointStore<TFlowState>` port (distinct from `ChatCheckpointStore`). | provider access (→ mesh), single-session chat orchestration (→ chat-core), UI |
| `@sentropic/persistence-postgres` (future) | to scope | reference impl of `MessageStore`, `SessionStore`, `ChatCheckpointStore`, `FlowCheckpointStore`, `JobQueue`, `EventSink` adapters — Drizzle/Postgres specific | the ports themselves (those live in `chat-core` and `flow`). No domain model ownership. |
| `@sentropic/harness` (BR25) | to scope | rules/skills/plan/spec templates, conductor CLI, verify hooks (lint/typecheck/migration/test plugins), branch scaffolding, project init with three presets (minimal Node / Svelte app / Postgres durable) | runtime dependency of any other package. Harness is tooling only. |

**Dependency rules**

- `chat-ui` → `chat-core` (HTTP/SSE) → `mesh`.
- `flow` → `chat-core` for chat steps, `mesh` direct for non-chat model calls.
- `events` is transverse: imported by `mesh`, `chat-core`, `flow`, `persistence-*`. No reverse dependency.
- `persistence-*` implements ports defined by `chat-core` and `flow`; never the inverse.
- `harness` has zero runtime dependents.

## 2. Transverse contracts (must exist before any package contract freeze)

Defined in `@sentropic/events` (or a tiny `@sentropic/contracts` core):

```ts
type TenantContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  sessionId?: string;
  runId?: string;
};

type AuthzContext = {
  caller: TenantContext;
  allowedTools: ReadonlySet<string>;
  permissionMode: 'untrusted' | 'on-request' | 'on-failure' | 'never' | 'granular';
};

type CostContext = {
  budgetTokens?: number;
  budgetSpendUsd?: number;
  spentTokens: number;
  spentUsd: number;
};

type IdempotencyKey = string & { __idempotency: true };

type CheckpointVersion = {
  hash: string;
  monotonicSeq: number;
  previousHash?: string;
};

type EventEnvelope<T> = {
  type: string;
  seq: number;
  ts: string;
  tenant: TenantContext;
  payload: T;
  redactedFields?: ReadonlyArray<string>;
  signature?: string;
};
```

Every cross-package call MUST carry `TenantContext`. Every persisted artefact (message, checkpoint, event, job) MUST carry `tenantId` at the storage level.

## 3. Threat model (short, transverse, to expand in dedicated `SPEC_STUDY_THREAT_MODEL.md`)

| Threat | Surface | Mitigation owner |
|---|---|---|
| Tool/prompt injection in tool output | tool result → next model call | `chat-core` taint propagation + per-tool output schema validation |
| Credential leak in events/retries/traces | mesh provider adapter errors, retries, traces | `mesh` redaction tests; `events` redactedFields contract |
| Cross-tenant access via shared checkpoint/queue | persistence layer | `TenantContext` in every port signature; row-level scoping in Postgres adapter |
| Replay attack on rejoignable traces | event store | `events` sequence numbers + optional signature; sinks verify monotonicity |
| Poison pill / non-idempotent retry side effect | flow queue, mesh retry | `IdempotencyKey` mandatory on side-effecting tools; DLQ semantics in `flow` |
| PII retention beyond policy | checkpoints, traces, message store, stream buffer | retention + cascade delete at port contract; classification before extraction |
| Cost runaway via tool-loop / model fallback | mesh fallback chain, chat-core multi-step | `CostContext` budget enforcement at mesh entry and chat-core step boundary; max iterations cap (Codex/Claude pattern) |

## 4. Stream protocol contract (must freeze before chat-ui consumes)

Inspired by Vercel AI SDK `streamText.fullStream`, plus peer-review hardening:

`StreamEvent` union (versioned `v1`):
- `text-delta { delta }`
- `reasoning-delta { delta }` (optional, redaction-aware)
- `tool-call { id, toolName, args }`
- `tool-result { id, output, isError }`
- `step-finish { usage, finishReason, costDelta }`
- `checkpoint { version: CheckpointVersion }`
- `error { code, message, retryable }`
- `abort { reason }`

Every event carries `seq`, `tenant`, `ts`, optional `redactedFields`. Wire format: SSE with one JSON-per-event line; protocol version negotiated via `Sec-Sentropic-Wire-Version` header.

Replay contract: `chat-core` MUST serve `GET /sessions/:id/events?fromSeq=N` to allow `chat-ui` to recover an interrupted stream without re-running the model. `StreamBuffer` port (in `chat-core`) is the source.

## 5. Ports & adapters (canonical list)

Defined in `chat-core` and `flow`. Implemented in `persistence-*`. Never the inverse.

`chat-core` ports:
- `MessageStore` (tenant scoped, retention aware)
- `SessionStore`
- `ChatCheckpointStore<TChatState>` (load / save with `expectedVersion` for OCC / list / delete)
- `StreamBuffer` (append by seq, range read, TTL/purge)
- `EventSink` (re-exported from `@sentropic/events`)
- `ToolRegistry` (resolves authorized tools per `AuthzContext`)

`flow` ports:
- `FlowCheckpointStore<TFlowState>`
- `JobQueue` (enqueue with idempotency, lease, DLQ, heartbeat)
- `WorkflowStore` (definitions, runs)
- `ApprovalGate`
- `EventSink`

Each port must have an `in-memory` reference adapter shipped alongside the contract, so a downstream user can build without Postgres.

## 6. Harness portability rules (`@sentropic/harness`)

- Three presets: `minimal-node`, `svelte-app`, `postgres-durable`. Each preset must compile and run with zero private deps.
- Templates split: `rules/`, `skills/`, `plan/`, `spec/` are generic; the conductor CLI generates and verifies but never imports `chat-core`, `flow`, etc.
- Verify hooks are plugin-based: each preset wires its own lint/typecheck/migration/test runner. Harness ships a thin plugin SPI.
- Examples must use the in-memory reference adapters and a fake provider; no Drizzle, Hono, Svelte or Mistral lock-in inside `harness`.

## 7. Anti-patterns (do not adopt)

- llm-mesh exposing `session_id` or chat message lifecycle. Provider events stay provider-shaped.
- A single shared `CheckpointStore` across chat-core and flow. Two distinct typed ports, possibly sharing a base.
- Persistence package owning domain types. Domain stays in the consumer package.
- `chat-ui` directly using `mesh`. The only client-visible boundary is `chat-core` wire protocol.
- Inline transport (Hono/SSE) leaking into `chat-core` core. Put it under `chat-core/server` sub-entry.
- Cancellation/retry/checkpointing reimplemented in both chat-core and flow. Either common ports or clearly owned per package.

## 8. Open questions (must close before BR14b implementation lands)

1. Should `@sentropic/events` ship before BR14b, or co-publish? Peer review argues "before".
2. `StreamBuffer` TTL policy: per-tenant or per-session? Affects retention contract.
3. `ToolRegistry` central or per-package (chat-core registry vs flow registry)? Lean shared abstract + per-call resolution by `AuthzContext`.
4. Idempotency key generation: client-provided or server-derived (hash of tool name + args + sessionId)? Per side-effect class.
5. Wire protocol versioning: header vs path (`/v1/sessions/...`). Lean header for forward compat.
6. Harness CLI name: `harness`, `harness-cli`, `sentropic` (binary)?
7. Where do "skills" live as a runtime concept (for BR19)? Not in harness (tooling-only). Probably a `@sentropic/skills` adjacent package referenced by chat-core.

## 9. References (sources consulted by peer review A/B/C/D)

Vercel AI SDK: <https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text>, <https://vercel.com/docs/ai-gateway>
LangGraph: <https://langchain-ai.github.io/langgraph/concepts/persistence/>, <https://langchain-ai.github.io/langgraph/how-tos/interrupt-on-tools/>
Temporal: <https://docs.temporal.io/workflows>, <https://docs.temporal.io/activities>, <https://docs.temporal.io/dev-guide/typescript/activity-idempotency>
Anthropic Agent SDK: <https://github.com/anthropics/claude-agent-sdk-python>, <https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works>
Codex CLI: <https://developers.openai.com/codex/agent-approvals-security>, <https://developers.openai.com/codex/concepts/sandboxing>
Claude Code SDK: <https://code.claude.com/docs/en/sub-agents>
OTel GenAI semantic conventions: <https://opentelemetry.io/docs/specs/semconv/gen-ai/>
