# SPEC_EVOL — ARCH-14: Event Spine, Audit, Observability

> Wave-1 architecture study (ARCH-14, SPEC_EVOL_ARCHITECTURE.md:719). Grounded in a code-reality map BEFORE drafting; design via double consensus **Codex 5.5-xhigh + Fable 5 (both GO-WITH-CHANGES, 2026-06-11)** — all convergent must-fixes folded. NO code; NO `@sentropic/contracts` / `@sentropic/comments` mutation (the trace/lineage need is met with INTERNAL outbox columns, de-arming the ARCH-12/D11 gate). BR-44 (queue reaper, chat_stream_events retention+index) is LANDED — its durability pattern is the template for the outbox dispatcher.

## 0. Frame & ratified constraints (grounding-corrected)
- **DD10 (data:452) ratifies the UBO §3.2 OBJECT envelope** (`id`, `objectType`, binding-defined scope map, `payloadSchemaVersion`, `deletedAt`, CAS `version`, `IdempotencyKey`, `origin`, lineage) — **NOT** the `@sentropic/contracts` `EventEnvelope`. The contracts `EventEnvelope<T> = {type, seq, ts, tenant: TenantContext, payload, redactedFields?, signature?}` (packages/contracts/src/index.ts:40-48) is the acknowledged **baseline** (data:116); it has **NO `origin`/`lineage`/`traceId` field**, and `TenantContext` (index.ts:1-7) has only optional `sessionId`/`runId`. DD10 explicitly REJECTED a fixed `tenant: TenantContext` scope (option B) for UBO object events. This study must not conflate the two envelopes.
- **Durability layering (ratified, arch:320-326)**: OUTBOX = durable source of truth (at-least-once, consumer idempotency, per-aggregate ordering, explicit retention/compaction); EVENT BUS = wake-up-only (today's NOTIFY: fire-and-forget, non-transactional, 8KB-capped — the port does not change that); any consumer needing guaranteed delivery reads the OUTBOX, never the bus; StreamBuffer = chat replay log (stays separate).
- **Control-namespace rule (data:168-176)**: outbox + audit live in `control` schema, OWN migration stream, **NO cross-namespace FK** (soft `aggregate_id`), CHECK discipline, DD9 `(tenant_id, workspace_id)` isolation + pre-declared ARCH-11 re-key. Cross-schema co-WRITES (product mutation + `control.event_outbox` insert) in one PG txn are allowed (the rule forbids constraints, not co-located writes).
- **Postgres-first (arch:688)**; **hardening prerequisite CLEARED** (BR-44).

## 1. Code-reality baseline
- **~10 NOTIFY channels through one LISTEN→SSE bridge** (streams.ts:703-784), in **three behavioral classes** (this taxonomy drives the whole reconciliation):
  - **Snapshot-on-wake** (`job_events`, `organization_events`, `folder_events`, `initiative_events`, `lock_events`): NOTIFY → a DB re-read (`emit*Snapshot`, streams.ts:425/449/463/477/492). Safe under at-least-once/duplicate/reorder (state re-fetched).
  - **Payload-carrying** (`workspace_events`, `workspace_membership_events`, `comment_events`): the NOTIFY `payload.data` is pushed VERBATIM to SSE (streams.ts:736-767; comment sink pg-notify-comment-event-sink.ts:108). Not a wake-up — the payload IS the event.
  - **Ephemeral / already-durable** (`presence_events` = in-memory `presenceByObject` Map, lock-presence.ts:79-96, NO txn/durable state; `stream_events` = already backed by the durable `chat_stream_events` replay log).
- **`execution_events`** (schema.ts:1055): append-only, `(run_id, sequence)` unique; written via the `EventDbExecutor` pattern in todo-orchestration (`appendExecutionEvent` :474-503, with `db.transaction` at :947/1051/1555/1633) — but flow-runtime.ts:149-195 writes 3 NON-atomic inserts (`executionRuns`/`executionEvents` seq hardcoded `1`/`workflowRunState`) with NO txn.
- **`job_queue` + BR-44 reaper**: at-least-once (persist-before-NOTIFY) + 3-sweep recovery; advisory-lock seq pattern exists in postgres-stream-buffer.ts:168.
- **No outbox/projection/entity_resolutions tables, no OTel** today (logger-only).

## 2. Resolutions (consensus-corrected)

### Q1 — Outbox → ONE generic `control.event_outbox`, complete ordering/recovery DDL
- Single generic transactional-outbox table (F1: generic, not per-aggregate — generalizes the proven `execution_events` log; partition ONLY measured hot aggregates later):
  - Columns: `id`, `aggregate_type` (CHECK), `aggregate_id` (soft id ref), `seq bigint`, `envelope jsonb` (the event payload/envelope — NOT contract-bound, so it can carry either the contracts `EventEnvelope` shape OR a DD10-style UBO object envelope for ARCH-19), **internal metadata columns `trace_id`/`lineage jsonb`/`origin`** (control-internal — full trace correlation with ZERO `@sentropic/contracts` mutation → ARCH-12 gate de-armed), `tenant_id`, `workspace_id` (DD9), `status` (`pending|processing|dispatched|failed`, CHECK), `claimed_at`, `attempts`, `last_error`, `created_at`, `dispatched_at`.
  - **`UNIQUE(aggregate_type, aggregate_id, seq)`** for per-aggregate ordering.
  - **seq allocation under concurrency**: advisory-lock-per-aggregate (the stream-sequence pattern, postgres-stream-buffer.ts:168) OR retry-on-unique-violation — NOT unlocked `MAX(seq)+1` (todo-orchestration.ts:485 races on hot aggregates). Name the hot-aggregate serialization cost.
  - Index supporting `pending` ordered dispatch; **per-aggregate failure blocking** (a stuck aggregate's later seqs wait).

### Q2 — Producer ownership → transactional outbox WHERE a txn exists; named refactors + phase-1 exceptions where it doesn't
Co-write the envelope to `event_outbox` in the SAME txn as the mutation via an `OutboxWriter` port. Reality per write-site:
- **Clean (txn exists)**: todo-orchestration (`db.transaction`), lock-service (`db.transaction` :143). → transactional outbox now.
- **Route-local (named refactor)**: `workspace_events`/`workspace_membership_events` emission lives in ROUTES (workspaces.ts:42-64,140-141,172,211,229; chat-service.ts:1659), not the service layer. Move emission into `workspace-service` (which has `db.transaction`, workspace-service.ts:146) — a named refactor, not a drop-in.
- **No txn (prerequisite)**: flow-runtime.ts:149-195 has 3 non-atomic inserts and no txn handle → introducing a transaction is prerequisite work (good hygiene anyway — a crash mid-sequence already orphans the run today). Budget it.
- **Published-port gate (phase-1 exception)**: `comments` is deliberately post-persistence (PgCommentStore persistence-only; sink emits AFTER mutation; `CommentEventSink.emit` is sync-void, no txn param — events.ts:33-35). Transactional co-write would need an executor param on the `CommentStore`/sink ports = a **published `@sentropic/comments` surface change → D11/ARCH-12 gate**. Therefore **comments STAYS write-then-emit (outbox-after-commit, at-least-once-minus-atomicity) in phase-1**; full transactional comments deferred to the ARCH-12 gate.
- **queue**: persist-before-NOTIFY already gives at-least-once for jobs; co-write outbox where the mutation txn allows.

### Q3 — EventBusPort → wake-up-only, `publish(channel, payload)`, default wraps NOTIFY, swappable
- `EventBusPort` is wake-up-only; the **outbox is the durable source** (a dropped bus message only delays a snapshot-on-wake consumer, which re-reads). Default binding = pg NOTIFY/LISTEN (arch:688); swappable (NATS/Kafka) without touching producers.
- **Signature = `publish(channel, payload)`** (NOT `publish(channel, key)`): the payload-carrying channels (workspace/membership/comment) push data verbatim, so the bus must carry the payload in phase-1.
- **Outbox dispatcher** (new): claims `pending` rows in `(aggregate, seq)` order (claim columns + advisory lock for multi-replica), emits via EventBusPort, marks `dispatched`; crash-recovery/at-least-once/redelivery-ceiling **mirror the BR-44 reaper**. **Dispatch latency**: producers emit an in-txn dispatcher-wake NOTIFY so the dispatcher fires immediately (no polling delay) — required to keep the awaited-comment-emission UX within the <2s UI-wait rule; state the latency budget.
- **Duplicate tolerance**: outbox redelivery ⇒ duplicate SSE for the 3 payload-carrying channels; the UI treats them as refetch hints (tolerable) — but this MUST be verified+stated, not assumed.

### Q4 — Trace/observability → INTERNAL outbox columns now; full OTel deferred
- `trace_id`/`lineage`/`origin` as `control.event_outbox` COLUMNS (internal, non-published) — NOT `EventEnvelope` fields, NOT a `tenant.runId` overload. Full trace correlation, **no contracts mutation, no ARCH-12 gate**.
- Structured-log the dispatcher choke-point (like the comment sink, pg-notify-comment-event-sink.ts:110). Full OpenTelemetry spans/exporter + cross-service trace propagation = NAMED FOLLOW-UP (observability sub-lot), not first-lot.

### Q5 — Reconciliation (no big-bang) + a REAL audit store
- **chat_stream_events + presence_events EXCLUDED** from outbox-driven emission: stream is already durable (chat_stream_events replay log; outboxing token deltas double-persists the hot path, contradicting the layering); presence is ephemeral in-memory (durably logging heartbeats = write-amplification). → an explicit **ephemeral/direct-publish lane** on the EventBus for non-domain signals (presence, stream wake-ups). "10 channels" → **~8 outbox-driven**.
- **Snapshot-on-wake channels** (job/org/folder/initiative/lock): become outbox-driven wake-ups, wire format preserved, consumers unchanged (safe — they re-read).
- **Payload-carrying channels** (workspace/membership/comment): outbox-driven, payload preserved via `publish(channel,payload)` + stated duplicate-tolerance; comments per the phase-1 write-then-emit exception above.
- **execution_events**: parallel + parity-check then fold (F3) — co-write outbox alongside, verify, then make execution_events a projection. NOT first-lot. (flow-runtime txn introduction is the prerequisite.)
- **Audit store (resolve the prune contradiction)**: `event_outbox` PRUNES dispatched rows → it is NOT the audit log. The audit store is a **separate dispatcher-fed append-only `control.event_audit` projection** (retention/GDPR erasure owned by ARCH-15, data:396). Q1's outbox is the dispatch queue; the audit projection is the durable history. (Or, if no audit need is confirmed, drop the audit claim — but arch:200 names it, so define it.)

### Q6 — Projection consumers → the outbox/audit is the seam (built in ARCH-09/06)
track (@sentropic/track), dossiers (ARCH-09), knowledge/graphify entity_resolutions (ARCH-06) become outbox/audit consumers via EventBus wake-up + outbox replay, scoped by the binding-defined scope map (deny-by-default). Seam only; consumers designed in ARCH-09/06.

## 3. Forks resolved + gates
- **F1** generic outbox ✔ · **F2** keep-wire-format-first, but channel-taxonomy-aware (8 outbox + ephemeral lane), `publish(channel,payload)` ✔ · **F3** execution_events parallel+parity+fold (flow-runtime txn prerequisite) ✔.
- **ARCH-12 / D11 gates (process, not owner decisions)**: (a) any lift of trace/lineage onto the published `EventEnvelope` — AVOIDED by internal outbox columns; (b) transactional comments needs a `@sentropic/comments` port change — DEFERRED (comments stays write-then-emit phase-1). Neither ships here.
- **Dual-envelope convergence (ARCH-19)**: object CRUD events carry a DD10 binding-defined scope map that the contracts `EventEnvelope<T>`'s fixed `TenantContext` can't express losslessly → the **non-contract-bound `envelope jsonb` outbox column carries either shape**; the convergence is named, not forced.
- **OWNER-IRREVERSIBLE: none** (confirmed by both reviewers) — transport is a swappable port, the table is internal `control.*`, retention is ARCH-15's; once the DD10 misattribution + envelope claim are corrected (done above), the claim stands.

## 4. Dependencies & non-goals
- **Depends on**: BR-44 (landed); ARCH-11 tenant semantics (pre-declared re-key); the contracts `EventEnvelope` baseline. **Unblocks**: ARCH-09 (track/dossiers), ARCH-06 (knowledge), ARCH-07 (background-run events), ARCH-19 (object events), ARCH-21b (`/knowledge` watch). **Implementation lot** = BR-60 outbox-v0 (track).
- **Non-goals**: no consumer impls; no full OTel; no contracts/comments mutation; no chat_stream_events change; no external event infra.

## 5. Acceptance
Q1-Q6 resolved, code-grounded + consensus-backed: complete `control.event_outbox` DDL (unique aggregate seq, advisory-lock seq allocation, claim/attempts/last_error, pending-ordered index, per-aggregate failure blocking, internal trace columns); `OutboxWriter`/`EventBusPort(publish channel,payload)`/outbox-dispatcher (BR-44-reaper-mirrored, in-txn wake, <2s budget); 3-class channel taxonomy (8 outbox-driven + ephemeral lane; presence + stream excluded); producer reality (clean / route-refactor / flow-runtime-txn-prerequisite / comments-phase-1-write-then-emit); execution_events parallel+fold; a SEPARATE `control.event_audit` projection (ARCH-15 retention); ARCH-12 gates respected (no mutation shipped); dual-envelope convergence named. Becomes the ARCH-14 output; converted to BR-60 outbox-v0 branch plan later.
