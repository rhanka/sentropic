# SPEC_STUDY — Agent Autonomy Increments (N0 → N5)

Study only. No SPEC_VOL: intention validation pending.

Companion of `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`. Maps autonomy levels onto **existing repository assets** so the incremental work is a structured lift-out, not a greenfield rewrite.

## 1. Levels

| Level | Capability | Definition |
|---|---|---|
| N0 | tool loop deterministic | model call → tool call → tool result → next model call, single session, single user |
| N1 | checkpoint + cancel + resume | abort/resume a session mid-flight, replay stream from a sequence number, recover after process crash |
| N2 | workflow multi-step + human approvals | typed DAG (start/normal/conditional/fanout/join/end), gates with human approval |
| N3 | durable retry/resume | idempotent activities, queue with DLQ, lease/heartbeat, backoff, observable failure modes |
| N4 | typed multi-agent handoff | inter-agent routing with explicit input/output schemas, versioned contracts, runtime validation |
| N5 | skill catalog + auto-planning | dynamic skill discovery, plan synthesis, fallback selection, self-evaluation |

## 2. Mapping onto current repository

| Level | Status | Existing assets | Gap |
|---|---|---|---|
| N0 | mostly in place, monolithic | `api/src/services/chat-service.ts` (5671 lines, single class `ChatService`), `tools.ts` (1428 lines, ~30 OpenAI tools), `stream-service.ts` (295 lines SSE), `llm-runtime/mesh-dispatch.ts`, `llm-runtime/mesh-contract-proof.ts` | extract into `@sentropic/chat-core` with explicit ports (`MessageStore`, `ToolRegistry`, `EventSink`). Freeze stream wire protocol. **BR14b scope.** |
| N1 | partial | `chat-trace.ts` + `chat-trace-sweep.ts` (persisted trace events), `chat-session-history.ts`, `ChatResumeFromToolOutputs` continuation type, iteration counter constants | `ChatCheckpointStore` port + monotonic sequence numbers + `StreamBuffer` port with replay endpoint. **BR14b scope.** |
| N2 | in place | `todo-orchestration.ts` (2717 lines), `todo-runtime.ts` (281 lines), `default-workflows.ts`, `gate-service.ts`, DB tables `workflowDefinitions` / `workspaceTypeWorkflows` / `workflow_run_state`, transitions `start/normal/conditional/fanout/join/end`, `agentDefinitionId` + `agentSelection` routing | extract via **façade-first**, not free refactor: keep `todo-orchestration.ts` untouched while building `@sentropic/flow` over it, then swap. **future BR-flow scope.** |
| N3 | in place | `queue-manager.ts` (4516 lines, Postgres queue), sweepers (`chat-trace-sweep`, `admin-approval-sweep`, `challenge-purge`), typed `JobType` executors `"job"` / `"noop"` | formalize `JobQueue` port (lease, heartbeat, DLQ, idempotency key). Add non-Postgres adapter contract. **BR-flow scope.** |
| N4 | routing in place, contracts not | agent definitions in `default-agents.ts`, `default-agents-opportunity.ts`, `default-agents-ai-ideas.ts`. `agentSelection` conditional routing | formalize agent I/O schemas (Zod), versioned. Add runtime validation. **BR-flow scope, low-risk slice.** |
| N5 | absent | nothing | new branch BR19 (skill catalog), out of scope BR14/23. |

## 3. Decision matrix — Temporal vs LangGraph vs status quo per level

| Level | Status quo (Postgres + todo-orchestration) | LangGraph fit | Temporal fit | Recommendation |
|---|---|---|---|---|
| N0/N1 | strong on persistence weak on loop discipline | excellent: tool-loop as node, checkpointer pattern | overkill for <10 min sessions | **keep status quo, formalize through chat-core ports**. LangGraph influence on patterns, not as dependency. |
| N2 | full transition graph already implemented | very good for in-process DAG | excellent for multi-day, multi-tenant | **status quo + façade**. Migration to Temporal only if multi-day SLAs appear. |
| N3 | full Postgres durable queue | weak on durability | strong (built-in) | **status quo formalized**. Temporal as future adapter, not replacement. |
| N4 | routing only, no contracts | natural fit via state schemas | natural fit via Activity I/O | **add Zod schemas to existing routing**. No runtime change required. |
| N5 | nothing | adjacent | adjacent | **defer to BR19**. Likely a skills catalog package distinct from flow. |

## 4. Invariants to preserve during extraction

Before any line of `todo-orchestration.ts` or `queue-manager.ts` moves out:

1. Event ordering: within a run, `executionEvents` order is monotonic per task.
2. Job idempotency: same `(jobId, resumeFrom)` produces same observable side effects and same output. Today implicit; must be made explicit.
3. Terminal-status uniqueness: a run has exactly one terminal status; sweepers do not flip terminal states.
4. Resume-after-tool: `ChatResumeFromToolOutputs` round-trips through `chat-trace` without loss.
5. Cancellation observability: every cancel emits a terminal event; partial output is preserved.
6. Checkpoint monotonicity: `workflow_run_state.version` is strictly increasing per `runId`.
7. Tenant scoping: every read/write through `queue-manager` already filters by workspace; this MUST become a port-level invariant, not a convention.
8. DLQ semantics: poison jobs land in a queryable DLQ with original payload and last error.

## 5. Golden traces (must be captured before any extraction)

To detect behavioral regression during extraction, freeze the following execution traces as fixtures:

- One full chat session with a tool loop of length ≥ 3 (e.g. `documents` + `web_search` + `plan`).
- One `fanout/join` workflow run across ≥ 2 organizations.
- One approval-gated workflow with a `gate-service` pause and resume.
- One job retried at least once via the Postgres queue.
- One resume after simulated worker crash mid-task.
- One cancellation mid-tool-loop with partial-output preservation.

Store under `api/tests/fixtures/golden/` (path to confirm). Each fixture: input + recorded event stream + final state. Replays under the new package boundaries must produce byte-identical event streams (modulo timestamps and IDs).

## 6. Extraction sequence (no rewrite)

```
1. Freeze contracts        →  publish @sentropic/events + @sentropic/contracts (TenantContext, etc.)
2. Capture golden traces   →  fixtures under api/tests/fixtures/golden/
3. BR14b chat-core extract →  port chat-service.ts behind chat-core ports; chat-trace as EventSink impl
4. Freeze wire protocol    →  versioned StreamEvent union; replay endpoint
5. BR14a chat-ui extract   →  consume wire protocol only; no direct mesh access
6. flow façade             →  thin @sentropic/flow over todo-orchestration; in-memory + Postgres adapters
7. flow swap               →  internals of todo-orchestration move into the package; original file becomes import-only
8. Tighten contracts       →  add Zod schemas to agent I/O (N4)
9. Optional Temporal adapter for FlowCheckpointStore (N2/N3 alt)
```

No step rewrites the working monolith. Each step is reversible at the package boundary.

## 7. Anti-patterns observed and flagged for refusal

- Greenfield rewrite framed as "extraction".
- Single `Checkpoint` concept shared by chat-core and flow.
- Persistence package owning state types.
- `llm-mesh` growing chat lifecycle types (session id, message role).
- `chat-ui` reaching past `chat-core` to `mesh` for "performance".
- Skipping golden traces because "the tests cover it" — they don't capture observable event order.

## 8. Open questions

1. Where does `chat-trace` retention live: chat-core or persistence-postgres adapter? Lean: contract in chat-core (`retentionPolicy` on `EventSink`), policy enforced by adapter.
2. Should `gate-service` move with flow (yes if it owns approvals) or stay app-side?
3. Multi-tenant `JobQueue`: namespace-per-workspace (Temporal-style) or column-scoped (current Postgres pattern)? Lean column-scoped + index, with a clear migration path to namespace.
4. Idempotency key surface: at port boundary only, or also at HTTP layer? Lean both, with port-layer authoritative.
