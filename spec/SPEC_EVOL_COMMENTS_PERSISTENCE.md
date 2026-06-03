# SPEC_EVOL — Comments Persistence + App Activation (BR-42d) — SCOPING v1

Status: SCOPING v1 — read-only analysis, grounded in VERIFIED live code (file:line cited, no "probably"). This spec activates `@sentropic/comments@0.1.0` (shipped by BR-42c) by REAL app consumption per `rules/architecture.md` ("a package is only accepted once an app root imports it through workspace wiring"). After this → detailed `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
Owner: `feat/comments-persistence` (BR-42d, `persistence-comments-observability`).
Baseline: forked OFF `feat/comments-package` so `packages/comments@0.1.0` IS present in this worktree (verified: `packages/comments/src/{store,types,events,in-memory,guards,index}.ts`, `package.json` version `0.1.0`).
Sources (mandatory read order honoured): `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/architecture.md`, `spec/SPEC_EVOL_COMMENTS.md` (BR-42c), `packages/comments/src/**`.
Live grounding (re-verified for BR-42d): `api/src/routes/api/comments.ts` (REST CRUD/close/reopen/delete/assign), `api/src/db/schema.ts:645-673` (`comments` table), `api/src/routes/api/streams.ts:167-170,744-756,773` (`comment_events` NOTIFY → `comment_update` SSE), `api/src/services/context-comments.ts` (AI resolution assistant + live `CommentThreadSummary`), `api/src/services/tool-service.ts:1195-1417,1452-1465,1560-1604` (thread-summary build + AI resolve actions + `reassigned` emit + auto-field comments), `api/src/services/queue-manager.ts:579-592,1430-1468` (auto-generation field comments), `api/src/routes/api/import-export.ts` (bulk snapshot read/write — 9 reads + 1 insert), `api/src/services/chat-service.ts:4409,4423` (AI tool callers), `packages/contracts/src/index.ts:1-7` (`TenantContext`).

---

## 0. Scope frame (what BR-42d IS / IS NOT)

BR-42d makes the comment subsystem run THROUGH the package:
- **(a)** adds a Postgres adapter of `CommentStore` over the EXISTING live `comments` table (REUSE, no parallel table);
- **(b)** migrates `api/src/routes/api/comments.ts` to consume `CommentStore` via that adapter, with **ZERO legacy fallback** (delete the inline Drizzle handlers — MASTER "No legacy fallback");
- **(c)** routes the package's `CommentEventSink` to the live `comment_events` NOTIFY stream (so the package emits, the api bridges to PG NOTIFY / `streams.ts` SSE);
- **(d)** adds minimal, provider-neutral observability (structured logs + an emitted-event audit counter).

**IN scope**: PG adapter implementing `CommentStore`; a NOTIFY-bridging `CommentEventSink`; rewrite of the 6 REST handlers in `comments.ts` onto the port; re-route of the AI resolution read path (`tool-service.listCommentThreadsForContexts`) and the AI resolve-actions cascade (`tool-service.resolveCommentActions`) through the port; workspace wiring (`@sentropic/comments` becomes an `api` workspace dependency); characterization tests proving 0-regression; observability.
**OUT of scope (deferred / app-local-kept)**:
- The AI **resolution prompt** + `generateCommentResolutionProposal` (host AI logic, stays in `context-comments.ts`) — only its INPUT (thread summaries) re-routes through the port.
- The NOTIFY/SSE **transport** itself (`streams.ts` LISTEN/`sseCommentEvent`) — unchanged; only the EMIT side is bridged from the sink.
- **Auth / RBAC / assignee-membership gating** (`requireWorkspace*Role`, `requireWorkspaceAdmin`, `ensureWorkspaceMember`, `ensureContextExists`) — host policy, stays in `api` (BR-42c §G / Decision G).
- **Bulk import/export** (`import-export.ts`) — a snapshot path, NOT the per-row CRUD/realtime surface; kept app-local (see §3 D-IE). Not a `CommentStore` consumer.
- **`usecase` context-type** — dead in the live surface (BR-42c §B; `comments.ts:13` `// TODO Lot 10: remove 'usecase'`); not introduced by the port.
- Presence/unread/live-cursors, redaction (do not exist for comments — BR-42c §E), UI changes, new UX.
- No package API change EXCEPT additive surfaces flagged in §3bis (multi-context summary + extended summary fields) — see Decision DEC-2.

---

## 1. Live → port mapping (VERIFIED, with gaps)

Every row cites live `file:line`. Port method = `packages/comments/src/store.ts`. "Gap" = work BR-42d must do.

| # | Live behavior (file:line) | Package port method / surface | Gap for BR-42d |
|---|---|---|---|
| L1 | `GET /` list by `(workspaceId, contextType, contextId[, sectionKey][, status])`, `orderBy asc(createdAt)`, then a SECOND query joins `users` for `created_by_user`/`assigned_to_user` labels (`comments.ts:74-137`) | `listByTarget(tenant, TargetQuery)` (kind+id+sectionKey+status; createdAt ASC + id tiebreaker) | Port returns rows only — **NO user-label join** (`CommentAuthor.displayLabel` is host-supplied). Host keeps the `users` join in the route AFTER calling `listByTarget`. Adapter adds an `id` ASC tiebreaker (strict refinement of `asc(createdAt)`). |
| L2 | `POST /` mint thread or validate `thread_id` in same `(ws,ctxType,ctxId)` else `404 'Thread not found'`; default `assignedTo = body.assigned_to ?? existingThreadAssignee ?? userId`; on reply-with-assigned, cascade `assignedTo` across thread (`comments.ts:148-207`) | `add(tenant, NewComment)` (mints when no `threadId`; throws `ThreadNotFoundError`) + `assign()` for the cascade | Port `add` does NOT default the assignee to userId nor cascade-on-create — host computes `assignedTo` (calls `ensureWorkspaceMember` first) and passes it explicitly; the "assigned reply cascades thread" step maps to a follow-up `assign(threadId, assignedTo)` call. `ThreadNotFoundError` → host maps to `404`. |
| L3 | `PATCH /:id` content edit is PER-ROW (`comments.ts:252`); assignment cascades thread (`comments.ts:246-250`); emits `updated` (`comments.ts:254`) | `edit(tenant, id, {body})` (per-row) + `assign(tenant, threadId, id\|null)` (cascade) | Live PATCH multiplexes content-edit AND assignment in one endpoint. Host route splits: `edit()` for `content`, `assign()` for `assigned_to`. **Event nuance**: live assignment emits `updated`; package `assign()` emits `reassigned` (BR-42c §4 / Decision C). The host bridge MUST surface `reassigned`→ wire `action:'updated'` on the REST PATCH path for byte-identical SSE parity (see §4, DEC-3). |
| L4 | `POST /:id/close` cascade `status='closed'` across thread; emit `closed` (`comments.ts:258-285`) | `setState(tenant, threadId, 'resolved')` → emits `resolved` | Port `setState` takes a `threadId`; route has only `:id` → host resolves `row.threadId` first (one `get`/lookup), then `setState`. Event `resolved` → bridge maps to live `action:'closed'`. |
| L5 | `POST /:id/reopen` cascade `status='open'`; emit `reopened` (`comments.ts:287-314`) | `setState(tenant, threadId, 'open')` → emits `reopened` | Same `:id`→`threadId` resolution. Event maps 1:1 to `reopened`. |
| L6 | `DELETE /:id` PER-ROW HARD delete; emit `deleted` (`comments.ts:316-339`) | `delete(tenant, id)` (per-row hard delete) → emits `deleted` | 1:1. Host keeps the creator-or-admin gate before calling. |
| L7 | AI read: `tool-service.listCommentThreadsForContexts` groups rows into `CommentThreadSummary[]` for N contexts, joins users (`tool-service.ts:1195-1284`) | `listThreadSummaries(tenant, TargetQuery)` (single target) | **GAP-A (real)**: live queries MULTIPLE contexts in one call (`or(...contextConditions)`, `tool-service.ts:1209-1212`); port `listThreadSummaries` is single-target. Either loop the port per context in the host, OR add `listThreadSummariesForTargets(tenant, TargetQuery[])` to the port (DEC-2). **GAP-B (real)**: live summary carries `createdBy`, `createdAt`, `updatedAt`, `assignedTo` (NOT in the package `CommentThreadSummary` — BR-42c §3bis omits them). Port summary must be EXTENDED or host re-derives these from `listThread` (DEC-2). |
| L8 | AI resolve: `tool-service.resolveCommentActions` per-thread cascade close/reassign + insert trace-note comment, emits `closed`/`reassigned`/`created` (`tool-service.ts:1286-1417`) | `setState` (close) + `assign` (reassign) + `add` (trace note) | Re-route the 3 mutations through the port; KEEP the AI-specific gating (`hasWorkspaceRole`, `ensureWorkspaceMember`, allowed-context check) app-local. Trace-note `add` carries `toolCallId` → `provenance.toolCallId` (port supports it, `types.ts:56-60`). |
| L9 | Auto-field comments on generation: `tool-service.ts:1560-1604` + `queue-manager.ts:1430-1468` insert `status:'open'`, fresh `threadId=createId()`, `toolCallId` set, emit `created` | `add(tenant, NewComment{provenance.toolCallId})` | Re-route both insert sites to `add()`. `queue-manager` runs OUTSIDE the request — needs the same store instance + sink wiring (DEC-4 lifecycle). |
| L10 | Event sink: `notifyCommentEvent` in THREE places (`comments.ts:20-28`, `tool-service.ts:1452-1465`, `queue-manager.ts:579-592`) → `NOTIFY comment_events, {workspace_id, context_type, context_id, data:{action, comment_id\|thread_id}}` (`streams.ts:744-756` consumes) | `CommentEventSink.emit(CommentEvent)` (`events.ts:33-35`) | **GAP-C**: build ONE `PgNotifyCommentEventSink` that maps `CommentEvent` → the live NOTIFY payload shape and DELETE all three inline `notifyCommentEvent` copies (0-legacy). Payload shape is fixed by the SSE consumer (`streams.ts:747-755` reads `context_type`/`context_id`/`data`). |
| L11 | Provenance `toolCallId` column (`schema.ts:661`) | `Comment.provenance.toolCallId` (`types.ts:56-60,75`) | 1:1; adapter persists `provenance.toolCallId` ↔ `comments.toolCallId`. |
| L12 | Tenancy: live `comments` has ONLY `workspaceId` (`schema.ts:648`), NO `tenant_id` column (grep-verified) | every port signature carries `TenantContext{tenantId, workspaceId, userId}` (`contracts/src/index.ts:1-7`) | **GAP-D (design)**: adapter maps `tenant.workspaceId` → `comments.workspace_id` and IGNORES `tenant.tenantId` (or asserts `tenantId === workspaceId`, matching the live convention `catalog.ts:32 tenantId: input.workspaceId`). **NO `tenant_id` column added** → likely ZERO migrations (see §2). |

---

## 2. `PgCommentStore` adapter design (Drizzle over the existing `comments` table)

REUSE `comments` (`schema.ts:646-671`). No parallel table. The five `comments` indexes (workspace, (contextType,contextId), threadId, assignedTo, status, toolCallId) already cover every port query → **NO new index, NO new column required → ZERO migration expected** (confirm during Lot 1; the live table already has every field the port persists: `id, workspaceId, contextType, contextId, sectionKey, createdBy, assignedTo, status, threadId, content, toolCallId, createdAt, updatedAt`). If ANY column proves missing, it is at most ONE additive nullable column in ONE migration file (`rules/schema-migrations.md:42` single-migration rule) — none anticipated.

**Target ↔ live round-trip** (BR-42c §2, `types.ts:140-171` `targetFromLive`/`targetToLive`): adapter persists `target.recordType → context_type`, `target.id → context_id`, `target.sectionKey → section_key (null when absent)`. Reading back uses `targetFromLive({contextType, contextId, sectionKey})`. The live `contextType` values (`organization|folder|initiative|matrix|executive_summary`) round-trip via `kind:'record'+recordType`. The package never enumerates host record kinds.

Per-method Drizzle mapping (all `WHERE workspaceId = tenant.workspaceId`):

| Port method | Drizzle |
|---|---|
| `add` | if `input.threadId`: `select … where (workspaceId, contextType, contextId, threadId) limit 1`; absent → `throw ThreadNotFoundError`. Mint `id=createId()`, `threadId ??= createId()`, `status:'open'`, `createdAt=updatedAt=now`. `insert(comments).values({…, toolCallId: provenance?.toolCallId ?? null})`. Emit `created`. (mirrors `comments.ts:155-206`) |
| `get` | `select … where (id, workspaceId) limit 1` → `targetFromLive` map or `null`. |
| `edit` | `update(comments).set({content: patch.body, updatedAt:now}).where(id, workspaceId)` — PER-ROW (mirrors `comments.ts:252`). Re-select for return; emit `updated`. Missing row → `CommentNotFoundError`. |
| `delete` | `delete(comments).where(id, workspaceId)` — PER-ROW HARD (mirrors `comments.ts:336`). Emit `deleted`. |
| `listByTarget` | `select … where (workspaceId, contextType, contextId[, sectionKey][, status]) orderBy asc(createdAt), asc(id)` (adds id tiebreaker — `schema.ts:662` `createdAt` non-unique; BR-42c §G). |
| `listThread` | `select … where (workspaceId, threadId) orderBy asc(createdAt), asc(id)`. |
| `listThreadSummaries` | `listByTarget`-shaped select, then group-by `threadId` EXACTLY as `tool-service.ts:1235-1283` (root=earliest, last=latest, count, status closed-if-any→`resolved`, first non-null assignee). |
| `setState` | `update(comments).set({status: state==='resolved'?'closed':'open', updatedAt:now}).where(workspaceId, threadId)` — THREAD CASCADE (mirrors `comments.ts:279-281,308-310`). Empty thread → `ThreadNotFoundError`. Re-select thread; emit `resolved`/`reopened`. |
| `assign` | `update(comments).set({assignedTo: assigneeId, updatedAt:now}).where(workspaceId, threadId)` — THREAD CASCADE (mirrors `comments.ts:200-202,248-250`). `assigneeId=null` → unassign (`set null` is allowed by FK `schema.ts:657`). Emit `reassigned`. |

**Ordering** = `createdAt ASC, id ASC` (deterministic; strict refinement of live `asc(createdAt)`).
**Hard delete** = per-row, no thread cascade on delete (BR-42c §G; live `comments.ts:336`).
**Thread cascade** for `setState`/`assign` (BR-42c §H).
**Event sink** = injected `CommentEventSink`; the PG adapter calls `sink.emit(...)` after each successful mutation (same as `InMemoryCommentStore`), and the api wires that sink to `PgNotifyCommentEventSink` (§4). Adapter itself NEVER imports `pg`'s NOTIFY — emission is via the sink; persistence is via the injected Drizzle `db`. This keeps the adapter testable against a transaction and the transport swappable.

**Id generator**: inject `createId` (`api/src/utils/id.ts` = `randomUUID()`) so adapter ids match the live format.

---

## 3. Migration plan (0-legacy) — what gets DELETED vs re-routed vs kept app-local

| Tag | Live code (file:line) | Action |
|---|---|---|
| M-REST | `comments.ts:16-28` (`escapeNotifyPayload`+`notifyCommentEvent`), `:148-207` POST, `:214-256` PATCH, `:258-285` close, `:287-314` reopen, `:316-339` delete, `:88-100` list query | **DELETE inline Drizzle**; rewrite each handler to: keep auth middleware + `ensureContextExists` + `ensureWorkspaceMember` gates → call the injected `CommentStore` method → keep the `users` label join in the list route. No dual path. |
| M-AI-READ | `tool-service.ts:1195-1284` `listCommentThreadsForContexts` | Re-route the grouping to `store.listThreadSummaries` (per-context loop or new multi-target method, DEC-2). KEEP the `users` join (`tool-service.ts:1272-1278`) app-local. |
| M-AI-WRITE | `tool-service.ts:1286-1417` `resolveCommentActions` | Re-route close→`setState`, reassign→`assign`, trace-note→`add`; DELETE the inline `db.update`/`db.insert`; KEEP `hasWorkspaceRole`/`ensureWorkspaceMember`/allowed-context gating. |
| M-AUTO | `tool-service.ts:1560-1604` + `queue-manager.ts:1430-1468` auto-field comment inserts | Re-route both to `store.add({provenance.toolCallId})`; DELETE inline `db.insert(comments)`. |
| M-SINK | `comments.ts:20-28`, `tool-service.ts:1452-1465`, `queue-manager.ts:579-592` (`notifyCommentEvent` ×3) | **DELETE all three**; replace with one `PgNotifyCommentEventSink` (§4). 0-legacy: no inline NOTIFY for comments remains. |
| D-IE | `import-export.ts` (9 reads + 1 bulk `tx.insert`, lines 152-769,1525) | **KEEP app-local — NOT migrated.** Rationale: bulk snapshot export/import is not the per-row CRUD/realtime port surface; it does `max(updatedAt)`, multi-context bulk selects, and a single transactional bulk insert. Forcing it through the port would be entropy (loop-of-`add` per row breaks the snapshot transaction + re-emits N wire events on import). Flag as a deliberate boundary; revisit only if a later branch needs import to emit live events. |
| D-PROMPT | `context-comments.ts` (whole) | **KEEP app-local.** AI prompt + `generateCommentResolutionProposal` is host logic; only its summary INPUT comes from the port now. |
| D-TRANSPORT | `streams.ts:167-170,744-773` | **UNCHANGED.** Consumes the same NOTIFY payload the sink emits. |

**Stays app-local (host policy, BR-42c §G)**: `ensureContextExists` (`comments.ts:30-56`), `ensureWorkspaceMember` (`comments.ts:58-65`), `requireWorkspace*Role`, `requireWorkspaceAdmin`, creator-or-admin gates, the `users` label joins, AI prompts, NOTIFY/SSE transport, bulk import/export.

### Characterization-test strategy (0-regression proof — characterization-FIRST, like BR-42f)
Lock behavior BEFORE the rewrite, then refactor until green (no behavior change):
1. **REST characterization** — extend `api/tests/api/comments.test.ts` (existing, `app`-driven, real DB) to pin: list filtering + user-label shape, thread mint/reply/`404 Thread not found`, per-row edit, assignment cascade across thread, close/reopen cascade, per-row hard delete (replies survive), assignee-not-member `400`, creator/admin gates `403`. Capture EXACT JSON response shapes (`id, thread_id`, `items[].*`, `success`). These pass on the OLD code first.
2. **AI characterization** — extend `api/tests/ai/comment-assistant.test.ts` + `e2e/tests/07_comment_assistant.spec.ts`: thread-summary grouping (root/last/count/status/assignee) and `resolveCommentActions` (close/reassign/note + trace-note provenance). Pin the live `CommentThreadSummary` field set (incl. `createdBy/createdAt/updatedAt/assignedTo`).
3. **Wire characterization** — a test asserting each mutation produces the SAME `NOTIFY comment_events` payload (`{workspace_id, context_type, context_id, data:{action, comment_id|thread_id}}`) as today, incl. the `updated`-vs-`reassigned` REST-assignment nuance (DEC-3). Drive via the SSE `comment_update` frame (`streams.ts:167`) or a NOTIFY spy.
4. Run the full `comments` + `comment-assistant` suites GREEN on old code, perform the migration commit-by-commit, re-run GREEN after each — any diff is a regression, not "pre-existing" (MASTER).
5. Package-level: `make test-comments` (in-memory adapter) stays green; the new PG adapter gets its own adapter-parity tests reusing the in-memory spec scenarios against a real test DB (Lot 2).

---

## 3bis. Package surface deltas (additive; drives DEC-2)

Two real gaps from §1 L7 force a package decision:
- **GAP-A (multi-context summary)**: live AI reads N contexts in one query. Options: (a) host loops `listThreadSummaries` per context (no package change, N queries); (b) add `listThreadSummariesForTargets(tenant, TargetQuery[])` to the port (one query, additive). Prefer (a) for v0.2.0 (no surface widening); revisit (b) if N is large.
- **GAP-B (extended summary fields)**: live `CommentThreadSummary` (`context-comments.ts:6-21`) carries `createdBy, createdAt, updatedAt, assignedTo` that the package type omits (`types.ts:109-129`). Options: (a) extend the package `CommentThreadSummary` with these 4 fields (additive, optional) → host drop-in; (b) host re-derives them from `listThread`. Prefer (a) — additive optional fields, version bump `0.1.0→0.2.0`, no breaking change. This keeps the AI assistant a true drop-in (BR-42c Decision D9 intent).

Either choice is a **package edit** → version bump (DEC-1).

---

## 4. Event sink → live NOTIFY (`PgNotifyCommentEventSink`)

One app-local class implementing `CommentEventSink` (`events.ts:33-35`). On `emit(event)`:
- map `event.type` → live `data.action` per BR-42c §4 table (`created→created`, `updated→updated`, `resolved→closed`, `reopened→reopened`, `deleted→deleted`, `reassigned→reassigned`);
- build `{workspace_id: event.tenant.workspaceId, context_type: targetToLive(event.target).contextType, context_id: event.target.id, data: {action, comment_id: event.commentId, thread_id: event.threadId}}` (matches `streams.ts:747-755` consumer + the live `comment_id`/`thread_id` keying);
- `NOTIFY comment_events, '<escaped json>'` via `pool.connect()` (reuse `escapeNotifyPayload`, `comments.ts:16`).

**DEC-3 (REST assignment parity)**: live REST PATCH-assignment emits `action:'updated'` (`comments.ts:254`) but the port `assign()` emits `reassigned`. To preserve byte-identical SSE for the REST path, the REST route either (i) calls `assign()` then the sink remaps `reassigned→updated` for REST-origin events, or (ii) the route emits `updated` explicitly. Recommend (ii): the route owns the wire action for its endpoint (the AI path keeps `reassigned` via `tool-service`). Documented so the parity test (§3 step 3) is unambiguous. The sink is the ONLY comment NOTIFY emitter after M-SINK.

The sink is `emit()`-sync (interface is sync) but NOTIFY is async — sink enqueues/fires-and-forgets a `pool` NOTIFY (same fire-pattern as today's `void notifyCommentEvent(...)` calls). Errors logged, never thrown into the store mutation (today's `notifyCommentEvent` also runs after the mutation).

---

## 5. Observability (minimal, provider-neutral)

BR-42d adds (keep small):
- **Structured logs** on each store mutation via the existing api logger: `{event:'comment.<type>', workspaceId, threadId, commentId, contextType}` — one line per emitted `CommentEvent`, wired in the sink (single choke-point, no per-handler sprinkling).
- **Counter metric** (provider-neutral, in-process): comments emitted by `type` (created/updated/resolved/reopened/deleted/reassigned). Reuse whatever metric primitive the api already exposes; if none, a tiny in-memory counter logged periodically — NO new metrics backend (provider-neutral per memory `no-unvalidated-naming`).
- **Event audit**: the sink is the natural audit point; log includes `userId` from `tenant.userId`.
- **DEFERRED**: distributed tracing, external metrics backend (Prometheus/OTel exporter), dashboards, per-tenant rate stats. Note as future, do not build.

Naming: no durable provider names (no `scw-*`/vendor); plain `comment.*` log events + neutral counter names, pending user validation if any make target/env var is introduced.

---

## 6. Decisions (batched: conductor-resolvable vs user-blocking)

**Conductor-resolvable (no user needed)**:
- **DEC-1 — Version bump `0.1.0 → 0.2.0`.** The PG adapter is app-local (DEC-2) so the package itself only changes if §3bis is adopted; the extended `CommentThreadSummary` fields (GAP-B) ARE a package edit → minor bump `0.2.0`. Conductor resolves: bump to `0.2.0`, additive-only (`enforce-package-bump` CI already covers `comments`, verified `.github/workflows/ci.yml:512-521`).
- **DEC-2 — Adapter lives in `api/` (app-local), NOT in the package.** PREFERRED & conductor-resolved. Rationale: keeps `@sentropic/comments` transport-agnostic + zero-runtime-dep (BR-42c §7: only dep is `@sentropic/contracts`). Putting Drizzle/`pg` in the package would force `drizzle-orm`/`pg` as peer/optional deps and widen the published surface — exactly what BR-42c's isolation rationale forbids. This MIRRORS the established pattern (chat-server kept its PG adapters in `api`; memory `chat-ui attachments packaging` = adapters host-local). The package stays in-memory-only; `PgCommentStore` is `api/src/services/comments/pg-comment-store.ts` (new), implementing the imported `CommentStore` interface. GAP-A handled host-side by looping; GAP-B handled by the additive package field (the only package edit).
- **DEC-3 — REST assignment emits `updated` (route-owned wire action).** Conductor-resolved (§4): preserves byte-identical SSE on the REST path; AI path keeps `reassigned`. Both are live actions (BR-42c §C).
- **DEC-4 — Store/sink lifecycle: single shared instance.** `PgCommentStore` + `PgNotifyCommentEventSink` instantiated once (api bootstrap), injected into the REST router, `tool-service`, and `queue-manager` (the out-of-request auto-comment path). Conductor-resolved: construct at app init with the shared `db`+`pool`.
- **DEC-5 — import/export stays app-local (D-IE), not a port consumer.** Conductor-resolved (§3 rationale).

**User-blocking (escalate)**:
- **UB-1 — EX-scope grant for forbidden paths.** BR-42d MUST edit `api/src/**` (allowed), but ALSO: (i) likely `api/package.json` (add `@sentropic/comments` workspace dep) and root `package.json`/lockfile (workspace wiring) — needed for activation; (ii) IF a migration is required (not anticipated, §2), `api/drizzle/*.sql` + `make db-generate`; (iii) possibly a `make`/CI line if a new test target is added. `api/` source is in-scope, but workspace-wiring files and any `Makefile`/`docker-compose` touch are DEFAULT-FORBIDDEN (MASTER) → require a `BR42d-EXn` exception with rationale/impact/rollback. **User confirms the EX grant** (the activation REQUIRES the `api↔package` workspace wiring, which is the whole point of BR-42d, so this is expected — but it crosses the forbidden-path line and needs sign-off). Recommend: grant `BR42d-EX1` (workspace wiring: `api/package.json` + root `package.json` + lockfile, additive dep only, rollback = remove dep).
- **UB-2 — Confirm ZERO-migration expectation.** §2 asserts no schema change is needed (every port field already exists as a column). User/conductor should confirm acceptance that BR-42d ships with NO `api/drizzle/*.sql` (if Lot 1 finds a missing column, escalate the single additive migration). Low risk; flagged because "persistence" branches usually imply a migration and its absence should be an explicit, accepted finding.

---

## 7. EX-scope summary

- **Allowed (in-scope, no EX)**: `api/src/routes/api/comments.ts`, `api/src/services/comments/**` (new adapter+sink), `api/src/services/tool-service.ts` (comment regions), `api/src/services/queue-manager.ts` (auto-comment region), `api/src/services/context-comments.ts` (input wiring only), `api/tests/api/comments.test.ts`, `api/tests/ai/comment-assistant.test.ts`, `e2e/tests/07_comment_assistant.spec.ts`, `packages/comments/src/types.ts` + `package.json` (additive summary fields + version bump).
- **Forbidden → needs `BR42d-EX1`**: `api/package.json`, root `package.json`, `package-lock.json` (workspace wiring — the activation itself). 
- **Conditional → `BR42d-EX2` only if triggered**: `api/drizzle/*.sql` + migration make target (only if Lot 1 finds a missing column — NOT anticipated).
- **Untouched**: `Makefile` comments lane (already shipped by BR-42c §7 / `BR42c-EX1`), `docker-compose*.yml`, `streams.ts`, `import-export.ts`.

---

## 8. Scope/paths + lots outline (characterization-first, like BR-42f)

- **Lot 0 — Characterization lock.** Extend `comments.test.ts` + `comment-assistant.test.ts` + wire-payload test to pin ALL live behavior (§3 strategy). GREEN on current code. (no src change)
- **Lot 1 — `PgCommentStore` adapter** (`api/src/services/comments/pg-comment-store.ts`) implementing `CommentStore` over `comments`; adapter-parity tests vs the in-memory scenarios on a real test DB. Confirm ZERO migration (UB-2).
- **Lot 2 — `PgNotifyCommentEventSink`** (§4) + DELETE the three inline `notifyCommentEvent` copies (M-SINK). Wire-parity test green.
- **Lot 3 — Workspace activation** (`BR42d-EX1`): add `@sentropic/comments` to `api/package.json` + root workspace; the api imports `CommentStore`/`PgCommentStore`. This satisfies `rules/architecture.md` activation.
- **Lot 4 — REST migration** (M-REST): rewrite the 6 handlers onto the store; DELETE inline Drizzle; keep gates + user join. Characterization suite stays green.
- **Lot 5 — AI re-route** (M-AI-READ, M-AI-WRITE, M-AUTO): `tool-service` + `queue-manager` comment mutations through the port; package summary fields adopted (§3bis / DEC-2 GAP-B). Keep AI gating + prompt app-local.
- **Lot 6 — Observability** (§5): structured logs + counter in the sink choke-point.
- **Lot 7 — Package bump** (`0.2.0`, DEC-1) + `make validate-comments` + full `make test-api` green; BR-42d marked activated.

Commits atomic (<150 lines, MASTER), characterization green after each migration lot. No UAT change to data; smoke on `ENV=dev` with user data at the end (architecture.md activation smoke), NEVER test on `ENV=dev` automated suites (MASTER).

---

## Appendix — verified facts ledger (file:line)
- Live `comments` table columns/indexes: `api/src/db/schema.ts:646-671`; NO `tenant_id` column (grep-verified).
- `TenantContext{tenantId,workspaceId,userId,sessionId?,runId?}`: `packages/contracts/src/index.ts:1-7`.
- REST handlers: `comments.ts` POST 148-207, PATCH 214-256, close 258-285, reopen 287-314, delete 316-339, list 74-137; `notifyCommentEvent` 16-28; gates `ensureContextExists` 30-56, `ensureWorkspaceMember` 58-65.
- NOTIFY/SSE: `streams.ts:167-170` (`sseCommentEvent`), `744-756` (consume payload), `773` (LISTEN).
- AI read/write: `tool-service.ts:1195-1284` (summaries), `1286-1417` (resolve), `1452-1465` (notify copy), `1560-1604` (auto-field).
- Auto-comment (queue): `queue-manager.ts:579-592` (notify copy), `1430-1468` (insert).
- AI callers: `chat-service.ts:4409` (proposal), `4423` (resolve).
- Bulk path (kept app-local): `import-export.ts` reads 152-769, insert 1525.
- Package surface: `store.ts:26-71` (port), `types.ts:109-129` (summary, omits createdBy/createdAt/updatedAt/assignedTo), `events.ts:10-35` (event+sink), `in-memory.ts` (reference), `package.json` version `0.1.0`.
- Make/CI lane already present (BR-42c): `Makefile:1023-1066,1339-1341,1220-1255`; CI `validate-comments` `.github/workflows/ci.yml:512-521`, `enforce-package-bump` covers `comments`.
- Tenancy convention `tenantId := workspaceId`: `api/src/services/skills/catalog.ts:32`.
- `createId = randomUUID()`: `api/src/utils/id.ts`.
