# SPEC_STUDY — Architecture Boundaries (sentropic packages)

Study only. No SPEC_VOL: intention to be validated separately.

Output of BR23 multi-source peer review (Vercel AI SDK, LangGraph, Temporal, Anthropic Agent SDK, Codex CLI, Claude Code SDK, and independent peer review).

## 1. Package cartography (post-peer-review)

Seven packages under `@sentropic/*`. The original six-package proposal was revised to add `@sentropic/events` after the peer review flagged that observability arriving last would fossilize an ad-hoc event taxonomy in `chat-core`.

| Package | Status | Owns | Doesn't own |
|---|---|---|---|
| `@sentropic/llm-mesh` | published 0.1.0 | provider adapters, model catalog, credentials, low-level provider streaming (provider-level token/delta/tool-call deltas as **provider events**, not session events), retry/fallback policy at provider call level | chat sessions, message lifecycle, persistence, workflow, telemetry sinks. Must NOT expose chat lifecycle types. |
| `@sentropic/events` (added) | new | `EventEnvelope`, `EventType` taxonomy aligned with OTel GenAI semantic conventions, sequence numbers, redaction primitives, signing hooks | sinks (Postgres/Langfuse/Datadog), business meaning of events |
| `@sentropic/chat-core` (BR14b) | in scoping | one chat session orchestration: tool loop, reasoning loop, continuation, cancel, retry, checkpoints, message lifecycle. Owns `CheckpointStore<ChatState>` instance (lenient OCC strategy — see §12). Owns `StreamBuffer` port. Owns `LiveDocumentStore` port (canvas, §10.3). Owns wire protocol contract (versioned). | providers (→ mesh), UI (→ chat-ui), multi-step workflow (→ flow), persistence backend (→ adapter), transport implementation (Hono/SSE lives in `chat-core/server` sub-entry, not in mesh nor in adapters) |
| `@sentropic/chat-ui` (BR14a) | in scoping | Svelte components, hooks consuming chat-core wire protocol, stream reassembly, optimistic UI, tool result rendering, reconnect/replay client logic | server logic, mesh access, persistence |
| `@sentropic/flow` (future) | to scope | multi-step DAG (start/normal/conditional/fanout/join/end), durable execution, retries with idempotency keys, human approvals via signals/interrupts, multi-agent handoff with typed I/O contracts. Owns `CheckpointStore<FlowState>` instance (strict OCC strategy — see §12). Owns `JobQueue` port (bridge to background tasks, §10.4). | provider access (→ mesh), single-session chat orchestration (→ chat-core), UI |
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
- `CheckpointStore<ChatState>` (single shared generic — see §12 — instantiated in lenient strategy)
- `StreamBuffer` (append by seq, range read, TTL/purge)
- `LiveDocumentStore` (canvas bidirectional edit, §10.3; CRDT- or OT-backed; `create`/`apply(patch)`/`read`/`subscribe`/`close`)
- `EventSink` (re-exported from `@sentropic/events`)
- `ToolRegistry` (resolves authorized tools per `AuthzContext`)
- `JobQueue` (consumed for async tools, §10.4; minimal in-memory adapter ships with chat-core for CLI use)

`flow` ports:
- `CheckpointStore<FlowState>` (same shared generic, strict strategy)
- `JobQueue` (production impl with lease, DLQ, heartbeat — extended from chat-core minimal interface)
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

1. ~~Should `@sentropic/events` ship before BR14b, or co-publish?~~ → **resolved §11**: co-ship in BR14b with `@sentropic/contracts`, provided wire is frozen before chat-core implementation lands.
2. `StreamBuffer` TTL policy: per-tenant or per-session? Affects retention contract.
3. `ToolRegistry` central or per-package (chat-core registry vs flow registry)? Lean shared abstract + per-call resolution by `AuthzContext`.
4. Idempotency key generation: client-provided or server-derived (hash of tool name + args + sessionId)? Per side-effect class.
5. Wire protocol versioning: header vs path (`/v1/sessions/...`). Lean header for forward compat.
6. Harness CLI name: `harness`, `harness-cli`, `sentropic` (binary)?
7. ~~Where do "skills" live as a runtime concept (for BR19)?~~ → **resolved**: separate package `@sentropic/skills`, see `SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md`.
8. ~~Two typed CheckpointStores vs one generic?~~ → **resolved §12**: single generic `CheckpointStore<T>` with strategy adapters (lenient for chat, strict OCC for flow).
9. `LiveDocumentStore` CRDT choice: Y.js, Automerge, or a thinner Loro? Affects bundle size and op-log shape.
10. Realtime audio wire: binary SSE frames vs WebRTC vs WebSocket? Each has different infrastructure cost.

## 10. Use case coverage

Five concrete consumption patterns must be covered. Each maps to specific packages and extension points.

### 10.1 Third-party CLI (build a custom CLI à la Claude Code / Codex)

Packages used:
- `@sentropic/llm-mesh` (provider access) — mandatory.
- `@sentropic/contracts` (`TenantContext` etc.) — mandatory.
- `@sentropic/events` (event taxonomy) — mandatory if streaming.
- `@sentropic/chat-core` (tool loop, continuation) — recommended for chat-like CLI.
- `@sentropic/harness` (rules/skills templates, conductor CLI, verify hooks, scaffolding) — recommended.
- `@sentropic/skills` (skill registry) — once BR19 ships.
- A terminal renderer set: either shipped inside `@sentropic/harness` (`harness.renderers.terminal`) or a tiny adjacent `@sentropic/chat-cli-renderers` package — choice deferred until BR25 prototype.
- Persistence adapter: `persistence-git` or `persistence-fs` for local CLI storage; **not** `persistence-postgres`.

Packages NOT used: `chat-ui` (Svelte specific), `persistence-postgres` (server-only).

### 10.2 Visual tool result (terminal, Google Maps, chart, image, iframe)

Concern crosses three layers:
- **Tool definition** (in `@sentropic/skills` or per-skill metadata): each tool declares `outputRenderHint: 'terminal' | 'map' | 'chart' | 'image' | 'iframe' | string` plus an `outputSchema` (Zod/JSONSchema) for structured outputs.
- **Wire protocol** (`@sentropic/events` → `tool-result` event): carries `renderHint` + `output` payload conforming to schema.
- **Renderer registry** (in `@sentropic/chat-ui` and `@sentropic/chat-cli-renderers`): map `(renderHint) → Component`. Defaults ship: `terminal` (preformatted text), `map` (Leaflet wrapper), `chart` (Vega-Lite), `image`, `iframe` (sandboxed). App registers custom: `registerRenderer(hint, Component)`.
- **Fallback**: unknown `renderHint` → render raw JSON.

The model never sees `renderHint`; it is metadata for the consumer.

### 10.3 Canvas bidirectional editing (live diff round-trip)

Pattern requires a `LiveDocument` abstraction beyond messages:

- A tool returns `LiveDocumentRef { id, initialContent, mimeType }` instead of inline output.
- `chat-core` owns `LiveDocumentStore` port: `create`, `apply(patch)`, `read`, `subscribe(callback) → unsubscribe`, `close`.
- Wire protocol adds events: `livedoc-opened`, `livedoc-patch { docId, from: 'user' | 'assistant', patch }`, `livedoc-closed`.
- User edits in canvas → UI emits `livedoc-patch` upward → chat-core relays to AI (which can `read` current state or `subscribe` to deltas).
- AI proposes patch → emitted as `livedoc-patch` downward → UI applies via CRDT.
- Recommended CRDT: Y.js or Automerge (decision in §8 Q9).
- Persistence: `LiveDocumentStore` adapter (Postgres for app durability, in-memory for CLI, Git-backed snapshot for project memory).
- Reference patterns: Vercel AI Artifacts, Claude Artifacts, ChatGPT Canvas.

### 10.4 Background tasks (long-running tool, conversation continues)

- Tool definition declares `kind: 'sync' | 'async'`, optional `progressEvents: boolean`.
- For `async` tools, `chat-core` does **not** block its loop:
  - Dispatches to `JobQueue` (port owned by flow; minimal in-memory adapter ships with chat-core for simple cases).
  - Returns `tool-result` immediately with `output: { jobRef }`.
  - Registers a callback on the job: when `job-complete` fires, a synthetic tool-result message is re-injected into the session, which may trigger a follow-up assistant turn (`requestContinuation: true` on the event).
- Stream events extension: `job-progress { jobRef, pct, message }`, `job-complete { jobRef, output | error }`. Emitted in the same SSE stream as chat events, so UI can show inline progress badges.
- Bridge contract: `chat-core` only depends on the `JobQueue` port shape (`enqueue`, `subscribe`, `cancel`); the production durable impl lives in `flow`.

### 10.5 Voice — dictation + interactive realtime

Two distinct flows:

**Dictation (STT only)**:
- `chat-ui` captures microphone → uploads audio blob → `chat-core` endpoint `/v1/transcribe`.
- `chat-core` invokes `mesh.transcribe(model, audio)` (Whisper, Gemini audio, etc.).
- Returns transcript → UI inserts into composer → normal chat send.
- ContentPart extension in `chat-core`: `TranscriptPart { text, confidence?, words? }`.

**Interactive realtime (bidirectional audio)**:
- `chat-ui` opens a WebRTC peer connection or WebSocket binary channel.
- `chat-core` opens a realtime session via `mesh.realtime(model, session)` (e.g. `gpt-4o-realtime-preview`, `gemini-live-2.5`).
- Mesh exposes paired streams:
  - `audioIn$: AsyncIterable<Uint8Array>` (mic → model)
  - `audioOut$: AsyncIterable<Uint8Array>` (model → speaker)
  - `transcriptIn$ / transcriptOut$` (text aliases)
  - Tool calls emitted in the same event channel.
- Wire protocol extension: support binary frames in addition to JSON SSE, OR base64-encoded audio in JSON. Decision deferred §8 Q10.
- ContentPart extension: `AudioPart { mimeType, bytes }`.

Both flows respect retention/PII rules from the threat model (§3) — audio is high-PII.

## 11. Delivery cadence (safe-but-fast)

Velocity principle: avoid mini-branches per package. Ship a coherent set in one branch when the libs are interdependent.

A branch may ship one or more packages atomically provided:
- they form a single conceptual unit (e.g. contracts + events + chat-core all reflect the same wire boundary)
- the PR stays reviewable (target ≤ 2000 changed lines net of generated/lockfile content, hard cap ~ 3000)
- each package is independently buildable (`make build-pkg-<name>`)
- publication is gated per package by `version-already-published` skip (current `publish-llm-mesh` pattern, replicated for every package)

Branch order (revised, minimal mini-branch count):

| Branch | Ships | Reason for bundling |
|---|---|---|
| BR14b | `@sentropic/contracts` + `@sentropic/events` + `@sentropic/chat-core` | wire boundary frozen together; events ahead of chat-core implementation but inside the same PR |
| BR14a | `@sentropic/chat-ui` | consumes chat-core wire only |
| BR-flow (TBD number, post BR14b) | `@sentropic/flow` + `@sentropic/persistence-postgres` (or extracted with flow if narrow) | extraction of `todo-orchestration` + `queue-manager` |
| BR25 | `@sentropic/harness` (+ `@sentropic/chat-cli-renderers` if we keep it separate) | tooling-only; will import `graphify-node` for graph extraction features |
| BR19 | `@sentropic/skills` + reference skills set | after BR14b lands |
| Optional satellite | additional `persistence-*` adapters (git, fs, redis, hybrid) | each adapter is small; can be batched 2-3 per follow-up branch |

Rules:
- Never co-ship a runtime package with `@sentropic/harness`. Harness stays tooling-only.
- A bundle may split mid-review if reviewers flag scope creep; the split is a new follow-up branch, not a destruction of the current one.
- `@sentropic/events` does not need a separate branch as Peer D suggested; the safeguard is that its API is frozen on the first commit of BR14b, before chat-core implementation begins.

## 12. CheckpointStore — single generic port (revised post Peer E)

Earlier draft proposed two typed ports (`ChatCheckpointStore`, `FlowCheckpointStore`). Peer E (research across Gemini CLI, Codex JSONL, Claude memory, LangGraph, Temporal, current `chat-service.ts` checkpoint impl) inverts the argument with force.

**Decision: single generic `CheckpointStore<T>` with strategy adapters.**

Rationale (sourced from Peer E):
- The interface shape (load / save / list / delete / tag / fork / watch) is identical between chat and flow. Variance lives in **OCC enforcement strategy**, not in shape.
- `ChatCheckpointAdapter` runs strategy `lenient`: `expectedVersion` is informational, mismatch is logged but accepted (chat UX tolerates stale-write — restore-to-latest is fine).
- `FlowCheckpointAdapter` runs strategy `strict`: `expectedVersion` mismatch returns `VersionConflict`; consumer must reload + retry.
- A single adapter binary (e.g. `persistence-postgres`) implements both modes via a `strategy` constructor parameter.
- Matches LangGraph (`Checkpointer[State]`) and Temporal (`WorkflowClient.workflowStubs<T>`) patterns. Less surface for downstream.

Interface (final):

```ts
interface CheckpointMeta {
  key: string;
  version: number;
  tags?: ReadonlyArray<string>;
  createdAt: string;
  updatedAt: string;
}

interface CheckpointStore<T> {
  load(key: string): Promise<{ state: T; version: number } | null>;
  save(
    key: string,
    state: T,
    expectedVersion?: number
  ): Promise<{ version: number; success: boolean; reason?: 'VersionMismatch' }>;
  list(prefix?: string, limit?: number): Promise<CheckpointMeta[]>;
  delete(key: string): Promise<void>;
  tag(key: string, label: string): Promise<void>;
  fork(sourceKey: string, targetKey: string): Promise<void>;
  watch?(key: string, callback: (state: T, version: number) => void): () => void;
}
```

Adapters shipped (each implements `CheckpointStore<T>` with declared strategy):

| Adapter | Best for | OCC mode | Constraints |
|---|---|---|---|
| `persistence-postgres` | API production (chat + flow durable) | strict configurable, lenient configurable | ACID, OCC native, JSONB blob ≤ 50 MB |
| `persistence-git` | CLI sessions, project memory, **Gemini CLI parity** | lenient only (merge conflict UX) | git hash-object + update-ref; slow on high-frequency saves; optional remote push |
| `persistence-fs` | CLI offline, dev/test | lenient | atomic temp+rename writes; no concurrency; not for production flow |
| `persistence-redis` | chat session cache | lenient with TTL | not durable across reboot; great for ephemeral session state and `watch` via pub/sub |
| `persistence-hybrid-fs-git` | CLI with cloud backup (Gemini-like) | lenient | local FS + scheduled git push to GitHub/Gist; eventual consistency |

Existing seed for chat-core Postgres adapter: `api/src/services/chat-service.ts:1873-2080` (`createCheckpoint` / `listCheckpoints` / `restoreCheckpoint`), table `chat_contexts(snapshotAfter JSONB, modifications JSONB, version=1)`. **Reclassify in N1 mapping**: status was "partial"; now "snapshot in place, missing OCC + replay endpoint + non-Postgres adapter". BR14b lifts this code into `@sentropic/chat-core` + `@sentropic/persistence-postgres`.

Resolved open questions: §8 Q1 (events co-ship), §8 Q7 (skills package), §8 Q8 (single CheckpointStore).

Remaining adjacent: `LiveDocumentStore` may consume `CheckpointStore` internally for snapshots, or stay a sibling port. Decision in BR14b prototype.

## 13. Harness — graphify-node integration note

`@sentropic/harness` (BR25) will import `graphify-node` (user-maintained Node port of graphify) to expose project-graph features as a built-in conductor command (`harness graph`). Details:
- Dependency: `graphify-node` declared as peerDependency to keep harness footprint small.
- Surface: `harness graph extract`, `harness graph query`, `harness graph publish` (HTML+JSON+audit artifacts).
- Integration boundary: harness wraps graphify-node behind a thin command; no fork.
- This integration does not change the rule that harness has zero runtime dependents from other `@sentropic/*` runtime packages.

See companion `SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md` for the orthogonal `@sentropic/skills` (BR19) package.

## 9. References (sources consulted by peer review A/B/C/D/E/F)

Vercel AI SDK: <https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text>, <https://vercel.com/docs/ai-gateway>
LangGraph: <https://langchain-ai.github.io/langgraph/concepts/persistence/>, <https://langchain-ai.github.io/langgraph/how-tos/interrupt-on-tools/>
Temporal: <https://docs.temporal.io/workflows>, <https://docs.temporal.io/activities>, <https://docs.temporal.io/dev-guide/typescript/activity-idempotency>
Anthropic Agent SDK: <https://github.com/anthropics/claude-agent-sdk-python>, <https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works>
Codex CLI: <https://developers.openai.com/codex/agent-approvals-security>, <https://developers.openai.com/codex/concepts/sandboxing>
Claude Code SDK: <https://code.claude.com/docs/en/sub-agents>
OTel GenAI semantic conventions: <https://opentelemetry.io/docs/specs/semconv/gen-ai/>
