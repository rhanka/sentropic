# SPEC_EVOL — Comments Persistence + App Activation (BR-42d) — SCOPING v2

Status: SCOPING v2 — revised after double adversarial review (Opus 4.8 + Codex-5.5-xhigh), all 9 must-fixes folded (see `## Review log v2`). Read-only analysis, grounded in VERIFIED live code (file:line cited, no "probably"). This spec activates `@sentropic/comments@0.1.0` (shipped by BR-42c) by REAL app consumption per `rules/architecture.md` ("a package is only accepted once an app root imports it through workspace wiring"). After this → detailed `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
Owner: `feat/comments-persistence` (BR-42d, `persistence-comments-observability`).
Baseline: forked OFF `feat/comments-package` so `packages/comments@0.1.0` IS present in this worktree (verified: `packages/comments/src/{store,types,events,in-memory,guards,index}.ts`, `package.json` version `0.1.0`).
Sources (mandatory read order honoured): `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/architecture.md`, `spec/SPEC_EVOL_COMMENTS.md` (BR-42c), `packages/comments/src/**`.
Live grounding (re-verified for BR-42d v2): `api/src/routes/api/comments.ts` (REST CRUD/close/reopen/delete/assign), `api/src/db/schema.ts:645-673` (`comments` table — `toolCallId` at `:661`, NO `runId`/`tenant_id` column), `api/src/routes/api/streams.ts:167-170,744-756,773` (`comment_events` NOTIFY → `comment_update` SSE), `api/src/services/context-comments.ts:6-21` (live `CommentThreadSummary` field set), `api/src/services/tool-service.ts:1205-1284,1286-1417,1452-1465,1560-1604` (thread-summary build + AI resolve actions + `closed`/`reassigned` emit + auto-field comments), `api/src/services/queue-manager.ts:579-592,1430-1468` (auto-generation field comments), `api/src/routes/api/import-export.ts` (bulk snapshot read/write), `api/src/services/chat-service.ts:4400-4407,4422-4429` (AI tool callers), `packages/contracts/src/index.ts:1-7` (`TenantContext`).

---

## 0. Scope frame (what BR-42d IS / IS NOT)

BR-42d makes the comment subsystem run THROUGH the package:
- **(a)** adds a Postgres adapter of `CommentStore` over the EXISTING live `comments` table (REUSE, no parallel table);
- **(b)** migrates `api/src/routes/api/comments.ts` to consume `CommentStore` via that adapter, with **ZERO legacy fallback** (delete the inline Drizzle handlers — MASTER "No legacy fallback");
- **(c)** routes the package's `CommentEventSink` to the live `comment_events` NOTIFY stream (so the package emits, the api bridges to PG NOTIFY / `streams.ts` SSE);
- **(d)** adds minimal, provider-neutral observability (structured logs + an emitted-event audit counter).

**IN scope**: PG adapter implementing `CommentStore`; a NOTIFY-bridging `CommentEventSink`; rewrite of the 6 REST handlers in `comments.ts` onto the port; re-route of the AI resolution read path (`tool-service.listCommentThreadsForContexts`) and the AI resolve-actions cascade (`tool-service.resolveCommentActions`) through the port; workspace + BUILD wiring (`@sentropic/comments` becomes an `api` workspace dependency, built into dist for runtime); characterization tests proving 0-regression; observability.
**OUT of scope (deferred / app-local-kept)**:
- The AI **resolution prompt** + `generateCommentResolutionProposal` (host AI logic, stays in `context-comments.ts`) — only its INPUT (thread summaries) re-routes through the port.
- The NOTIFY/SSE **transport** itself (`streams.ts` LISTEN/`sseCommentEvent`) — unchanged; only the EMIT side is bridged from the sink.
- **Auth / RBAC / assignee-membership gating** (`requireWorkspace*Role`, `requireWorkspaceAdmin`, `ensureWorkspaceMember`, `ensureContextExists`) — host policy, stays in `api` (BR-42c §G / Decision G).
- **Bulk import/export** (`import-export.ts`) — a snapshot path, NOT the per-row CRUD/realtime surface; kept app-local (see §3 D-IE). Not a `CommentStore` consumer.
- **AI read-path mapping (threadId / limit / global-ordering)** — handled HOST-SIDE by the mapper feeding the port, NOT by widening `TargetQuery` (must-fix #1, §1bis).
- **`usecase` context-type** — dead in the live surface (BR-42c §B; `comments.ts:13` `// TODO Lot 10: remove 'usecase'`); not introduced by the port.
- Presence/unread/live-cursors, redaction (do not exist for comments — BR-42c §E), UI changes, new UX.
- **No package src change is anticipated** (the AI-summary gap is closed by a HOST-SIDE mapper, must-fix #2) → see Decision DEC-1 (version bump DROPPED unless a real package edit surfaces).

---

## 1. Live → port mapping (VERIFIED, with gaps)

Every row cites live `file:line`. Port method = `packages/comments/src/store.ts`. "Gap" = work BR-42d must do.

| # | Live behavior (file:line) | Package port method / surface | Gap for BR-42d |
|---|---|---|---|
| L1 | `GET /` list by `(workspaceId, contextType, contextId[, sectionKey][, status])`, `orderBy asc(createdAt)`, then a SECOND query joins `users` for `created_by_user`/`assigned_to_user` labels (`comments.ts:74-137`) | `listByTarget(tenant, TargetQuery)` (kind+id+sectionKey+status; createdAt ASC + id tiebreaker) | Port returns rows only — **NO user-label join** (`CommentAuthor.displayLabel` is host-supplied). Host keeps the `users` join in the route AFTER calling `listByTarget`. Adapter adds an `id` ASC tiebreaker (strict refinement of `asc(createdAt)`). |
| L2 | `POST /` mint thread or validate `thread_id` in same `(ws,ctxType,ctxId)` else `404 'Thread not found'`; default `assignedTo = body.assigned_to ?? existingThreadAssignee ?? userId`; on POST-with-`assigned_to`, cascade `assignedTo` across the whole thread BUT emit ONLY `created` (`comments.ts:148-207`, cascade `:198-203`, single emit `:205`) | `add(tenant, NewComment)` (mints when no `threadId`; throws `ThreadNotFoundError`) | Port `add` does NOT default the assignee to userId nor cascade-on-create — host computes `assignedTo` (calls `ensureWorkspaceMember` first) and passes it explicitly. **must-fix #4**: the live POST emits EXACTLY ONE `created` even when it cascades the assignee — the migration MUST NOT emit an extra `reassigned`. Either (a) host route does `add()` then a SILENT `db.update`-equivalent assignee cascade (no second emit), or (b) the adapter `add()` accepts the initial `assignedTo` and writes the whole thread atomically, single `created`. Wire test asserts exactly one `created`. `ThreadNotFoundError` → host maps to `404`. |
| L3 | `PATCH /:id` (`comments.ts:214-256`): builds ONE `updates` object (`:235`) holding BOTH `content` (`:236`) and `assignedTo` (`:242`, where `assigned_to:null` → `row.createdBy`, NOT unassign, `:238`). When `updates.assignedTo` is truthy the ENTIRE `updates` object (INCLUDING `content` if present) is cascaded across the whole thread (`:246-250`); otherwise per-row (`:251-252`). Emits `updated` keyed by `comment_id` (`:254`) | `edit(tenant, id, {body})` (per-row) + `assign(tenant, threadId, id\|null)` (cascade) | **must-fix #3 (v1 was WRONG)**: v1 claimed clean content-vs-assignment separation. Live truth: assignment makes the WHOLE update (content too) cascade thread-wide, and `assigned_to:null` resolves to `row.createdBy`. Lot 0 PINS these exact behaviors; the host route reproduces them precisely when composing `edit()`/`assign()` (e.g. content+assignee in one PATCH must cascade content across the thread, matching live), and the `assigned_to:null → createdBy` default is computed host-side before calling `assign()`. **Event nuance**: live assignment emits `updated` (`comment_id`); package `assign()` would emit `reassigned` — REST path forces wire `action:'updated'` for byte-identical SSE (§4, DEC-3 / must-fix #5). |
| L4 | `POST /:id/close` cascade `status='closed'` across thread; emit `closed` keyed by `comment_id` (`comments.ts:258-285`, emit `:283`) | `setState(tenant, threadId, 'resolved')` → emits `resolved` | Port `setState` takes a `threadId`; route has only `:id` → host resolves `row.threadId` first (one `get`/lookup), then `setState`. Event `resolved` → bridge maps to live `action:'closed'`, REST-origin key = `comment_id` (must-fix #5). |
| L5 | `POST /:id/reopen` cascade `status='open'`; emit `reopened` keyed by `comment_id` (`comments.ts:287-314`, emit `:312`) | `setState(tenant, threadId, 'open')` → emits `reopened` | Same `:id`→`threadId` resolution. Event maps 1:1 to `reopened`, REST-origin key = `comment_id`. |
| L6 | `DELETE /:id` PER-ROW HARD delete; emit `deleted` keyed by `comment_id` (`comments.ts:316-339`, emit `:337`) | `delete(tenant, id)` (per-row hard delete) → emits `deleted` | 1:1. Host keeps the creator-or-admin gate before calling. REST-origin key = `comment_id`. |
| L7 | AI read: `tool-service.listCommentThreadsForContexts` groups rows into `CommentThreadSummary[]` for N contexts, joins users (`tool-service.ts:1205-1284`) | `listThreadSummaries(tenant, TargetQuery)` (single target) | **GAP-A (real)**: live queries MULTIPLE contexts in one call (`or(...contextConditions)`, `:1209-1212`); port `listThreadSummaries` is single-target → host loops per context (no port widening, DEC-2). **GAP-B (real)**: live summary (`context-comments.ts:6-21`) carries `createdBy/createdAt/updatedAt` + `assignedTo` + `status:'open'\|'closed'`; package `CommentThreadSummary` (`types.ts:109-129`) uses `assignee` + `status:'open'\|'resolved'` and OMITS `createdBy/createdAt/updatedAt`. **RESOLUTION (must-fix #2): HOST-SIDE MAPPER**, no package edit — see §1bis. |
| L8 | AI resolve: `tool-service.resolveCommentActions` per-thread cascade close/reassign + insert trace-note comment, emits `closed`/`reassigned`/`created` keyed by `thread_id` (`tool-service.ts:1286-1417`; `closed` emit `:1364`, `reassigned` emit `:1381`) | `setState` (close) + `assign` (reassign) + `add` (trace note) | Re-route the 3 mutations through the port; KEEP the AI-specific gating (`hasWorkspaceRole`, `ensureWorkspaceMember`, allowed-context check) app-local. Trace-note `add` carries `toolCallId` → `provenance.toolCallId` (port supports it, `types.ts:56-60`). **AI-origin events key `thread_id`** (not `comment_id`) — must-fix #5. |
| L9 | Auto-field comments on generation: `tool-service.ts:1560-1604` + `queue-manager.ts:1430-1468` insert `status:'open'`, fresh `threadId=createId()`, `toolCallId` set, emit `created` | `add(tenant, NewComment{provenance.toolCallId})` | Re-route both insert sites to `add()`. `queue-manager` runs OUTSIDE the request — needs the same store instance + sink wiring (DEC-4 lifecycle). Origin = `auto`. |
| L10 | Event sink: `notifyCommentEvent` in THREE places (`comments.ts:16-28`, `tool-service.ts:1452-1465`, `queue-manager.ts:579-592`) → `NOTIFY comment_events, {workspace_id, context_type, context_id, data:{action, comment_id\|thread_id}}` (`streams.ts:744-756` consumes); ALL THREE `await` the NOTIFY (`comments.ts:205` `await notifyCommentEvent`, `tool-service.ts:1461` `await client.query`, `queue-manager.ts:588` `await client.query`) | `CommentEventSink.emit(CommentEvent)` (`events.ts:33-35`, signature `emit(event): void` — SYNC) | **GAP-C**: build ONE ORIGIN-AWARE `PgNotifyCommentEventSink` (§4) and DELETE all three inline copies (0-legacy). **must-fix #6**: today's NOTIFY is AWAITED, but `CommentEventSink.emit` is SYNC `void` — v1 §4 wrongly said fire-and-forget. The host route/store path MUST await the sink's NOTIFY flush (sink exposes an awaitable `flush()`/returns a promise the route awaits) to match live back-pressure. **must-fix #5**: origin discriminator (`rest`\|`ai`\|`auto`) selects `comment_id` (REST) vs `thread_id` (AI/auto) byte-identically. |
| L11 | Provenance: `toolCallId` column ONLY (`schema.ts:661`); NO `run_id` column | `Comment.provenance` = `{toolCallId?, runId?}` (`types.ts:56-60`) | **must-fix #7**: port carries `runId` but there is NO column → adapter explicitly DROPS `provenance.runId`, persists `provenance.toolCallId` ↔ `comments.toolCallId` only. Keeps ZERO migration. No other port field lacks a column (verified §2). |
| L12 | Tenancy: live `comments` has ONLY `workspaceId` (`schema.ts:648`), NO `tenant_id` column (grep-verified) | every port signature carries `TenantContext{tenantId, workspaceId, userId}` (`contracts/src/index.ts:1-7`) | **GAP-D (design)**: adapter maps `tenant.workspaceId` → `comments.workspace_id` and IGNORES `tenant.tenantId` (or asserts `tenantId === workspaceId`, matching the live convention `catalog.ts:32 tenantId: input.workspaceId`). **NO `tenant_id` column added** → ZERO migrations (see §2). |

---

## 1bis. AI read-path & summary mapping (HOST-SIDE — must-fix #1 + #2)

Two live-vs-port mismatches in the AI read path are resolved entirely HOST-SIDE; the package port is NOT widened.

**#1 — Port query incompleteness (do NOT widen `TargetQuery`).** The AI read carries `threadId`, `limit` (default 200), and a GLOBAL ordering/slice across all threads of all contexts (`chat-service.ts:4401-4407` passes `threadId`/`limit:200`; `tool-service.ts:1215` filters `threadId`, `:1233` orders `asc(createdAt)`, `:1281` `.slice(0, opts.limit ?? 200)` over the flattened thread list). The package `TargetQuery` (`types.ts:98-103` = `kind/id/sectionKey/status`) intentionally has none of these. **RESOLUTION**: the HOST mapper handles `threadId`/`limit`/global-ordering — it loops `listThreadSummaries` per context, then applies the `threadId` filter, the cross-context ordering, and the `limit` slice in `api` code. The port stays minimal. NO `TargetQuery` field added.

**#2 — AI summary ≠ package summary (HOST-SIDE mapper, no package edit).** Live `CommentThreadSummary` (`context-comments.ts:6-21`): `threadId, contextType, contextId, sectionKey, status:'open'|'closed', assignedTo, createdBy, createdAt, updatedAt, messageCount, rootMessage, rootMessageAt, lastMessage, lastMessageAt`. Package `CommentThreadSummary` (`types.ts:109-129`): uses `assignee` (not `assignedTo`), `status:'open'|'resolved'` (not `closed`), and OMITS `createdBy/createdAt/updatedAt`. **RESOLUTION**: a HOST-SIDE mapper in `api` converts the package summary → the live shape:
- `status: 'resolved' → 'closed'` (and `'open' → 'open'`);
- `assignee → assignedTo`;
- `createdBy/createdAt/updatedAt` DERIVED host-side from the thread rows (the host already has them via `listThread`/`listByTarget`, mirroring the live group-by at `tool-service.ts:1242-1268` — root `createdBy`/`createdAt`, latest `updatedAt`);
- the `users` join stays app-local (`tool-service.ts:1272-1278`).
This means **NO edit to the package `CommentThreadSummary`** → likely NO `packages/comments/src/**` change at all → the DEC-1 version bump is DROPPED unless another real package edit appears during implementation. The grouping math itself (root=earliest, last=latest, count, closed-if-any, first-non-null assignee) is reproduced by `listThreadSummaries` and/or the host mapper to match `tool-service.ts:1244-1269` exactly.

---

## 2. `PgCommentStore` adapter design (Drizzle over the existing `comments` table)

REUSE `comments` (`schema.ts:646-671`). No parallel table. The six `comments` indexes (workspace, (contextType,contextId), threadId, assignedTo, status, toolCallId — `schema.ts:665-670`) already cover every port query → **NO new index, NO new column required → ZERO migration expected** (confirm during Lot 2; the live table already has every field the port persists: `id, workspaceId, contextType, contextId, sectionKey, createdBy, assignedTo, status, threadId, content, toolCallId, createdAt, updatedAt`). The ONLY port field without a column is `provenance.runId` — explicitly DROPPED by the adapter (must-fix #7), NOT a migration trigger. If ANY OTHER column proves missing, it is at most ONE additive nullable column in ONE migration file (`rules/data.md` single-migration rule) — none anticipated.

**Target ↔ live round-trip** (BR-42c §2, `types.ts` `targetFromLive`/`targetToLive`): adapter persists `target.recordType → context_type`, `target.id → context_id`, `target.sectionKey → section_key (null when absent)`. Reading back uses `targetFromLive({contextType, contextId, sectionKey})`. The live `contextType` values (`organization|folder|initiative|matrix|executive_summary`) round-trip via `kind:'record'+recordType`. The package never enumerates host record kinds.

Per-method Drizzle mapping (all `WHERE workspaceId = tenant.workspaceId`):

| Port method | Drizzle |
|---|---|
| `add` | if `input.threadId`: `select … where (workspaceId, contextType, contextId, threadId) limit 1`; absent → `throw ThreadNotFoundError`. Mint `id=createId()`, `threadId ??= createId()`, `status:'open'`, `createdAt=updatedAt=now`. `insert(comments).values({…, toolCallId: provenance?.toolCallId ?? null})` (DROP `provenance.runId`, must-fix #7). Emit `created`. (mirrors `comments.ts:181-196`) |
| `get` | `select … where (id, workspaceId) limit 1` → `targetFromLive` map or `null`. |
| `edit` | `update(comments).set({content: patch.body, updatedAt:now}).where(id, workspaceId)` — PER-ROW (mirrors `comments.ts:251-252`). Re-select for return; emit `updated`. Missing row → `CommentNotFoundError`. NOTE: the REST PATCH's content+assignment THREAD cascade (must-fix #3) is composed host-side, not in bare `edit()`. |
| `delete` | `delete(comments).where(id, workspaceId)` — PER-ROW HARD (mirrors `comments.ts:336`). Emit `deleted`. |
| `listByTarget` | `select … where (workspaceId, contextType, contextId[, sectionKey][, status]) orderBy asc(createdAt), asc(id)` (adds id tiebreaker — `schema.ts:662` `createdAt` non-unique; BR-42c §G). |
| `listThread` | `select … where (workspaceId, threadId) orderBy asc(createdAt), asc(id)`. |
| `listThreadSummaries` | `listByTarget`-shaped select, then group-by `threadId` EXACTLY as `tool-service.ts:1244-1269` (root=earliest, last=latest, count, status closed-if-any→`resolved`, first non-null assignee). Host mapper then converts to live shape (§1bis #2). |
| `setState` | `update(comments).set({status: state==='resolved'?'closed':'open', updatedAt:now}).where(workspaceId, threadId)` — THREAD CASCADE (mirrors `comments.ts:278-281,307-310`). Empty thread → `ThreadNotFoundError`. Re-select thread; emit `resolved`/`reopened`. |
| `assign` | `update(comments).set({assignedTo: assigneeId, updatedAt:now}).where(workspaceId, threadId)` — THREAD CASCADE (mirrors `comments.ts:198-203,246-250`). `assigneeId=null` → unassign at the port level (`set null` is allowed by FK `schema.ts:657`); the REST `assigned_to:null → createdBy` default (must-fix #3) is computed HOST-SIDE before calling `assign()`. Emit `reassigned`. |

**Ordering** = `createdAt ASC, id ASC` (deterministic; strict refinement of live `asc(createdAt)`).
**Hard delete** = per-row, no thread cascade on delete (BR-42c §G; live `comments.ts:336`).
**Thread cascade** for `setState`/`assign` (BR-42c §H).
**Event sink** = injected `CommentEventSink`; the PG adapter calls `sink.emit(...)` after each successful mutation (same as `InMemoryCommentStore`), and the api wires that sink to `PgNotifyCommentEventSink` (§4). Adapter itself NEVER imports `pg`'s NOTIFY — emission is via the sink; persistence is via the injected Drizzle `db`. This keeps the adapter testable against a transaction and the transport swappable.

**Id generator**: inject `createId` (`api/src/utils/id.ts` = `randomUUID()`) so adapter ids match the live format.

---

## 3. Migration plan (0-legacy) — what gets DELETED vs re-routed vs kept app-local

| Tag | Live code (file:line) | Action |
|---|---|---|
| M-REST | `comments.ts:16-28` (`escapeNotifyPayload`+`notifyCommentEvent`), `:148-207` POST, `:214-256` PATCH, `:258-285` close, `:287-314` reopen, `:316-339` delete, `:74-137` list query | **DELETE inline Drizzle**; rewrite each handler to: keep auth middleware + `ensureContextExists` + `ensureWorkspaceMember` gates → call the injected `CommentStore` method (composing `add`/`edit`/`assign`/`setState`/`delete` to reproduce the live cascade semantics, incl. must-fix #3/#4) → keep the `users` label join in the list route. No dual path. The inline REST `notifyCommentEvent` copy is deleted in the SAME lot the REST handlers route through the sink (must-fix #9 ordering). |
| M-AI-READ | `tool-service.ts:1205-1284` `listCommentThreadsForContexts` | Re-route the grouping to `store.listThreadSummaries` (per-context loop, host applies threadId/limit/ordering — must-fix #1; host mapper to live summary shape — must-fix #2). KEEP the `users` join (`tool-service.ts:1272-1278`) app-local. |
| M-AI-WRITE | `tool-service.ts:1286-1417` `resolveCommentActions` | Re-route close→`setState`, reassign→`assign`, trace-note→`add`; DELETE the inline `db.update`/`db.insert`; KEEP `hasWorkspaceRole`/`ensureWorkspaceMember`/allowed-context gating. AI-origin events key `thread_id` (must-fix #5). |
| M-AUTO | `tool-service.ts:1560-1604` + `queue-manager.ts:1430-1468` auto-field comment inserts | Re-route both to `store.add({provenance.toolCallId})`; DELETE inline `db.insert(comments)`. Origin = `auto`. |
| M-SINK | `comments.ts:16-28`, `tool-service.ts:1452-1465`, `queue-manager.ts:579-592` (`notifyCommentEvent` ×3, all AWAITED) | **DELETE all three**; replace with one ORIGIN-AWARE `PgNotifyCommentEventSink` (§4). Deletion happens per-caller in the SAME lot that caller routes through the sink (must-fix #9), so no emit gap. 0-legacy: no inline NOTIFY for comments remains at the end. |
| D-IE | `import-export.ts` (9 reads + 1 bulk `tx.insert`, lines 152-769,1525) | **KEEP app-local — NOT migrated.** Rationale: bulk snapshot export/import is not the per-row CRUD/realtime port surface; it does `max(updatedAt)`, multi-context bulk selects, and a single transactional bulk insert. Forcing it through the port would be entropy (loop-of-`add` per row breaks the snapshot transaction + re-emits N wire events on import). Flag as a deliberate boundary; revisit only if a later branch needs import to emit live events. |
| D-PROMPT | `context-comments.ts` (whole) | **KEEP app-local.** AI prompt + `generateCommentResolutionProposal` is host logic; only its summary INPUT comes from the port now (via the host mapper, §1bis). |
| D-TRANSPORT | `streams.ts:167-170,744-773` | **UNCHANGED.** Consumes the same NOTIFY payload the sink emits. |

**Stays app-local (host policy, BR-42c §G)**: `ensureContextExists` (`comments.ts:30-56`), `ensureWorkspaceMember` (`comments.ts:58-65`), `requireWorkspace*Role`, `requireWorkspaceAdmin`, creator-or-admin gates, the `users` label joins, AI prompts, NOTIFY/SSE transport, bulk import/export, the live-summary mapper (§1bis).

### Characterization-test strategy (0-regression proof — characterization-FIRST, like BR-42f)
Lock behavior BEFORE the rewrite, then refactor until green (no behavior change):
1. **REST characterization** — extend `api/tests/api/comments.test.ts` (existing, `app`-driven, real DB) to pin: list filtering + user-label shape, thread mint/reply/`404 Thread not found`, per-row edit, **content+assignment cascading the WHOLE update thread-wide (must-fix #3)**, `assigned_to:null → createdBy` (NOT unassign, must-fix #3), **POST-with-assignee emits EXACTLY ONE `created` (must-fix #4)**, close/reopen cascade, per-row hard delete (replies survive), assignee-not-member `400`, creator/admin gates `403`. Capture EXACT JSON response shapes (`id, thread_id`, `items[].*`, `success`). These pass on the OLD code first.
2. **AI characterization** — extend `api/tests/ai/comment-assistant.test.ts` + `e2e/tests/07_comment_assistant.spec.ts`: thread-summary grouping (root/last/count/status/assignee) and `resolveCommentActions` (close/reassign/note + trace-note provenance). Pin the live `CommentThreadSummary` field set (incl. `createdBy/createdAt/updatedAt/assignedTo`, `status open|closed`) so the host mapper (§1bis) is provably byte-identical.
3. **Wire characterization** — a test asserting each mutation produces the SAME `NOTIFY comment_events` payload (`{workspace_id, context_type, context_id, data:{action, comment_id|thread_id}}`) as today, **incl. ALL origin-specific key differences (must-fix #5)**: REST close/reopen/delete/update use `comment_id`; AI close/reassign use `thread_id`; and the REST-assignment `updated`-vs-`reassigned` action nuance (DEC-3). Also assert exactly one `created` for POST-with-assignee (must-fix #4). Drive via the SSE `comment_update` frame (`streams.ts:167`) or a NOTIFY spy.
4. Run the full `comments` + `comment-assistant` suites GREEN on old code, perform the migration commit-by-commit, re-run GREEN after each — any diff is a regression, not "pre-existing" (MASTER).
5. Package-level: `make test-comments` (in-memory adapter) stays green; the new PG adapter gets its own adapter-parity tests reusing the in-memory spec scenarios against a real test DB (Lot 2).

---

## 3bis. Package surface — NO additive change anticipated (must-fix #2)

v1 proposed extending the package `CommentThreadSummary` (GAP-B) and possibly adding `listThreadSummariesForTargets` (GAP-A). Both are DROPPED:
- **GAP-A (multi-context summary)**: HOST loops `listThreadSummaries` per context + applies threadId/limit/ordering host-side (must-fix #1). NO port method added.
- **GAP-B (extended summary fields)**: HOST-SIDE mapper converts the package summary → the live shape and derives `createdBy/createdAt/updatedAt` from the thread rows (must-fix #2). NO package type edit.

⇒ **No `packages/comments/src/**` edit is anticipated** → no version bump (DEC-1 dropped). If implementation uncovers a genuine package src need, re-introduce the additive-optional change + a `0.1.0→0.2.0` bump THEN (and only then).

---

## 4. Event sink → live NOTIFY (`PgNotifyCommentEventSink`, ORIGIN-AWARE)

One app-local class implementing `CommentEventSink` (`events.ts:33-35`). On `emit(event)`:
- map `event.type` → live `data.action` per BR-42c §4 table (`created→created`, `updated→updated`, `resolved→closed`, `reopened→reopened`, `deleted→deleted`, `reassigned→reassigned`);
- build `{workspace_id: event.tenant.workspaceId, context_type: targetToLive(event.target).contextType, context_id: event.target.id, data: {action, <key>}}` (matches `streams.ts:747-755` consumer);
- **must-fix #5 — ORIGIN discriminator** selects the `data` key BYTE-IDENTICALLY to live:
  - origin `rest` → `comment_id: event.commentId` (matches `comments.ts:205,254,283,312,337`);
  - origin `ai` → `thread_id: event.threadId` (matches `tool-service.ts:1364,1381`);
  - origin `auto` → `comment_id: event.commentId` (auto-field inserts emit `created` with the new comment id, mirroring `tool-service.ts:1560-1604` / `queue-manager.ts:1430-1468` live payloads).
  Origin is carried on the event (e.g. `event.data.origin`) or via per-caller sink wrappers (`restSink`/`aiSink`/`autoSink` over one base) — the implementation chooses, but the wire bytes MUST match the live per-origin keying. DEC-3 is WIDENED to cover ALL REST-vs-AI key differences, not just updated-vs-reassigned.
- `NOTIFY comment_events, '<escaped json>'` via `pool.connect()` (reuse `escapeNotifyPayload`, `comments.ts:16`).

**must-fix #6 — NOTIFY is AWAITED today.** All three live sites `await` the NOTIFY round-trip (`comments.ts:205`, `tool-service.ts:1461`, `queue-manager.ts:588`). But `CommentEventSink.emit` is SYNC (`events.ts:34` `emit(event): void`). v1 §4 WRONGLY described fire-and-forget. **Design**: the sink performs the NOTIFY and EXPOSES an awaitable (e.g. `emit()` enqueues + returns nothing, plus an async `flush(): Promise<void>` the host route awaits before responding; OR a thin host wrapper that `await`s the underlying `pool.query`). The migrated REST route / AI path / queue path AWAIT that flush so back-pressure & error timing match live (NOTIFY completes before the HTTP response / before the next action). Errors are logged; the live code lets NOTIFY errors reject the awaited call, so the migrated path preserves that (do not silently swallow — match live behavior). The sink is the ONLY comment NOTIFY emitter after M-SINK.

**DEC-3 (REST assignment parity, WIDENED)**: live REST PATCH-assignment emits `action:'updated'` keyed by `comment_id` (`comments.ts:254`) but the port `assign()` emits `reassigned`. To preserve byte-identical SSE for the REST path, the REST route emits `updated` explicitly (route owns its wire action); the AI path keeps `reassigned` keyed by `thread_id` (`tool-service.ts:1381`). Documented so the parity test (§3 step 3) is unambiguous.

---

## 5. Observability (minimal, provider-neutral)

BR-42d adds (keep small):
- **Structured logs** on each store mutation via the existing api logger: `{event:'comment.<type>', origin, workspaceId, threadId, commentId, contextType}` — one line per emitted `CommentEvent`, wired in the sink (single choke-point, no per-handler sprinkling).
- **Counter metric** (provider-neutral, in-process): comments emitted by `type` (created/updated/resolved/reopened/deleted/reassigned). Reuse whatever metric primitive the api already exposes; if none, a tiny in-memory counter logged periodically — NO new metrics backend (provider-neutral per memory `no-unvalidated-naming`).
- **Event audit**: the sink is the natural audit point; log includes `userId` from `tenant.userId`.
- **DEFERRED**: distributed tracing, external metrics backend (Prometheus/OTel exporter), dashboards, per-tenant rate stats. Note as future, do not build.

Naming: no durable provider names (no `scw-*`/vendor); plain `comment.*` log events + neutral counter names, pending user validation if any make target/env var is introduced.

---

## 6. Decisions (batched: conductor-resolvable vs user-blocking)

**Conductor-resolvable (no user needed)**:
- **DEC-1 — Version bump DROPPED (must-fix #2).** v1 bumped `0.1.0 → 0.2.0` for the extended summary fields. Those fields are now mapped HOST-SIDE (§1bis), so NO package src edit is anticipated → NO bump. Conductor resolves: keep `@sentropic/comments@0.1.0`; re-introduce a bump ONLY if Lot 2/5 surfaces a genuine package src edit (then additive-only, `enforce-package-bump` CI already covers `comments`, `.github/workflows/ci.yml:512-521`).
- **DEC-2 — Adapter lives in `api/` (app-local), NOT in the package.** PREFERRED & conductor-resolved. Rationale: keeps `@sentropic/comments` transport-agnostic + zero-runtime-dep (BR-42c §7: only dep is `@sentropic/contracts`). Putting Drizzle/`pg` in the package would force `drizzle-orm`/`pg` as peer/optional deps and widen the published surface — exactly what BR-42c's isolation rationale forbids. MIRRORS the established pattern (chat-server kept its PG adapters in `api`; memory `chat-ui attachments packaging` = adapters host-local). The package stays in-memory-only; `PgCommentStore` is `api/src/services/comments/pg-comment-store.ts` (new), implementing the imported `CommentStore` interface. GAP-A handled host-side by looping; GAP-B handled by the host mapper (§1bis) — NO package edit.
- **DEC-3 — REST assignment emits `updated` (route-owned wire action), WIDENED to all REST-vs-AI key differences.** Conductor-resolved (§4): preserves byte-identical SSE per origin (REST `comment_id`, AI `thread_id`); AI path keeps `reassigned`. All live actions (BR-42c §C; must-fix #5).
- **DEC-4 — Store/sink lifecycle: single shared instance.** `PgCommentStore` + origin-aware `PgNotifyCommentEventSink` instantiated once (api bootstrap), injected into the REST router, `tool-service`, and `queue-manager` (the out-of-request auto-comment path). Conductor-resolved: construct at app init with the shared `db`+`pool`.
- **DEC-5 — import/export stays app-local (D-IE), not a port consumer.** Conductor-resolved (§3 rationale).
- **DEC-6 — `provenance.runId` dropped by the adapter (must-fix #7).** No `run_id` column exists (`schema.ts:661` = `toolCallId` only); the adapter persists `toolCallId` and ignores `runId`. Conductor-resolved: documented data-loss-by-design for a field the live surface never stored; keeps ZERO migration.

**User-blocking (escalate)**:
- **UB-1 — EX-scope grant for forbidden paths (EXPANDED, must-fix #8).** Activation requires editing DEFAULT-FORBIDDEN files beyond `api/src/**`:
  - `api/package.json` — add `"@sentropic/comments": "file:../packages/comments"` (mirrors `:53-56` auth-hono/chat-server/flow/llm-mesh);
  - root `package-lock.json` — already links `packages/comments` (`:3038,:14952`), but re-`npm i` will touch it on dep add;
  - `api/package-lock.json` — currently has ZERO `comments` references (grep count 0) → MUST be regenerated to link the new dep;
  - `api/Dockerfile` — `COPY packages/comments/package.json` (mirror `:54-57`) AND `RUN npm --workspace @sentropic/comments run build` (mirror `:64-66`, because `comments` `main:./dist/index.js` needs a tsc dist at runtime — its `build` script is `tsc -p tsconfig.json`, `package.json`);
  - `Makefile` BUILD wiring — `comments` is absent from `API_VERSION` glob (`:34` lists only `llm-mesh`/`chat-server` package globs) AND from the dev/CI build prerequisites: `prepare-node-workspace` (`:1535`) runs `build-llm-mesh build-flow build-auth-hono` and `up-api-test-ci` (`:1584`) runs the same — neither builds `comments`. Add `build-comments` (target already exists `:1024`, depends on `build-contracts` `:1007`) to BOTH prerequisite lists, and add `packages/comments/{src,package.json,tsconfig.json}` to the `API_VERSION` glob so image cache invalidates on package change.
  RESOLUTION: grant **`BR42d-EX1` EXPANDED** = {`api/package.json`, root `package-lock.json`, `api/package-lock.json`, `api/Dockerfile`, `Makefile` build-wiring (`API_VERSION` + `prepare-node-workspace` + `up-api-test-ci`)}. Conductor-resolved as MECHANICAL (each line MIRRORS an existing `@sentropic/llm-mesh`/`chat-server`/`flow`/`auth-hono` entry at the cited lines; rollback = remove the added entries). `Makefile`/`docker-compose` are MASTER default-forbidden, hence the explicit EX. **User confirms the EX grant** (this build wiring IS the activation — the whole point of BR-42d).
- **UB-2 — Confirm ZERO-migration expectation.** §2 asserts no schema change is needed (every persisted port field already exists as a column; `runId` is dropped not migrated). User/conductor confirm acceptance that BR-42d ships with NO `api/drizzle/*.sql` (if Lot 2 finds a missing column, escalate the single additive migration). Low risk; flagged because "persistence" branches usually imply a migration and its absence should be an explicit, accepted finding.

---

## 7. EX-scope summary

- **Allowed (in-scope, no EX)**: `api/src/routes/api/comments.ts`, `api/src/services/comments/**` (new adapter+sink+host-summary-mapper), `api/src/services/tool-service.ts` (comment regions), `api/src/services/queue-manager.ts` (auto-comment region), `api/src/services/context-comments.ts` (input wiring only), `api/tests/api/comments.test.ts`, `api/tests/ai/comment-assistant.test.ts`, `e2e/tests/07_comment_assistant.spec.ts`. (NO `packages/comments/**` edit anticipated — must-fix #2 / DEC-1.)
- **Forbidden → needs `BR42d-EX1` (EXPANDED, must-fix #8)**: `api/package.json`, root `package-lock.json`, `api/package-lock.json`, `api/Dockerfile`, `Makefile` (build-wiring: `API_VERSION` glob `:34` + `prepare-node-workspace` `:1535` + `up-api-test-ci` `:1584`). All MECHANICAL mirrors of existing package entries; rollback = remove added entries.
- **Conditional → `BR42d-EX2` only if triggered**: `api/drizzle/*.sql` + migration make target (only if Lot 2 finds a missing column — NOT anticipated); `packages/comments/src/**` + version bump (only if a real package edit surfaces — NOT anticipated, must-fix #2).
- **Untouched**: `docker-compose*.yml`, `streams.ts`, `import-export.ts`, the `comments` test/typecheck/publish Makefile lanes already shipped by BR-42c (`:1024,:1045`, etc.).

---

## 8. Scope/paths + lots outline (characterization-first; REORDERED per must-fix #9)

v1's lot order deleted the 3 `notifyCommentEvent` copies (Lot 2) BEFORE the callers routed through the sink → an event gap. NEW order routes-then-deletes per-caller in the SAME lot, and activates BUILD wiring FIRST so the package is importable:

- **Lot 0 — Characterization lock.** Extend `comments.test.ts` + `comment-assistant.test.ts` + wire-payload test to pin ALL live behavior INCLUDING must-fix #3 (content+assignment whole-update thread cascade; `assigned_to:null → createdBy`), #4 (POST-with-assignee = exactly one `created`), #5 (REST `comment_id` vs AI `thread_id` keys), #6 (NOTIFY awaited). GREEN on current code. (no src change)
- **Lot 1 — Workspace + BUILD activation FIRST (`BR42d-EX1`).** Add `@sentropic/comments` to `api/package.json`; regenerate `api/package-lock.json` (+ root lock); `api/Dockerfile` COPY + build `comments`; `Makefile` `build-comments` into `prepare-node-workspace` + `up-api-test-ci` + `API_VERSION` glob. The api can now import `CommentStore`/`PgCommentStore`. Satisfies `rules/architecture.md` activation (real consumption + build wiring). Verify `make build`/stack boots with the package built.
- **Lot 2 — `PgCommentStore` adapter** (`api/src/services/comments/pg-comment-store.ts`) implementing `CommentStore` over `comments`; adapter-parity tests vs the in-memory scenarios on a real test DB. Confirm ZERO migration (UB-2). `provenance.runId` dropped (must-fix #7).
- **Lot 3 — `PgNotifyCommentEventSink`** (origin-aware, §4) — built and unit/wire-tested, but NOT YET the sole emitter (the 3 live copies still stand; no deletion this lot, so no gap). Origin keying (must-fix #5) + awaitable flush (must-fix #6) proven by the wire test.
- **Lot 4 — REST migration** (M-REST): rewrite the 6 handlers onto the store (composing cascade semantics incl. must-fix #3/#4); route REST events through the sink (origin `rest`) AND DELETE the REST `notifyCommentEvent` copy (`comments.ts:16-28`) in THIS SAME lot. Keep gates + user join. Characterization suite stays green.
- **Lot 5 — AI re-route** (M-AI-READ, M-AI-WRITE, M-AUTO): `tool-service` + `queue-manager` comment mutations through the port + sink (origin `ai`/`auto`); host summary mapper (§1bis #1/#2); DELETE the 2 remaining `notifyCommentEvent` copies (`tool-service.ts:1452-1465`, `queue-manager.ts:579-592`) in THIS SAME lot. Keep AI gating + prompt app-local. After this lot, the sink is the SOLE emitter (0-legacy).
- **Lot 6 — Observability** (§5): structured logs + counter in the sink choke-point (origin in the log line).
- **Lot 7 — Validate**: full `make test-api` green + `make validate-comments` (in-memory) green; package bump ONLY if a real package edit happened (per must-fix #2: NONE anticipated → no bump). BR-42d marked activated.

Commits atomic (<150 lines, MASTER), characterization green after each migration lot. No UAT change to data; smoke on `ENV=dev` with user data at the end (architecture.md activation smoke), NEVER run automated suites on `ENV=dev` (MASTER).

---

## Review log v2

Double adversarial review of scoping v1 (HEAD `76a83172`) by Opus 4.8 + Codex-5.5-xhigh; the two converged on NINE must-fixes, all conductor-resolved and encoded above. Verified anchors in parentheses.

1. **Port query incompleteness** — AI read carries `threadId`/`limit:200`/global-order (`chat-service.ts:4401-4407`, `tool-service.ts:1215,1233,1281`); `TargetQuery` (`types.ts:98-103`) lacks them. RESOLUTION: HOST mapper handles threadId/limit/ordering; port NOT widened (§1bis #1).
2. **AI summary ≠ package summary** — live (`context-comments.ts:6-21`) = `contextId/assignedTo/createdBy/createdAt/updatedAt` + `status open|closed`; package (`types.ts:109-129`) = `assignee` + `status open|resolved`, omits `createdBy/createdAt/updatedAt`. RESOLUTION: HOST-SIDE mapper (§1bis #2) — NO package edit → DEC-1 bump DROPPED.
3. **REST PATCH semantics (v1 wrong)** — `comments.ts:235-254`: when `assigned_to` present the WHOLE `updates` (incl `content`) cascades thread-wide (`:246-250`); `assigned_to:null → row.createdBy` (`:238`), NOT unassign. RESOLUTION: Lot 0 pins exact behaviors; host composition reproduces them (§1 L3, §2 `assign`/`edit`).
4. **POST-with-assignee emits ONLY `created`** — `comments.ts:198-205` cascades assignee then single `created` emit. RESOLUTION: migrated POST emits exactly one `created` (silent assignee cascade or atomic `add` w/ initial assignee); wire test asserts one event (§1 L2, §3 step 1/3).
5. **Origin-specific wire keys** — REST close/reopen/delete/update → `comment_id` (`comments.ts:205,254,283,312,337`); AI close/reassign → `thread_id` (`tool-service.ts:1364,1381`). RESOLUTION: ORIGIN-aware single sink (`rest|ai|auto`) picks the key byte-identically; DEC-3 WIDENED (§4).
6. **NOTIFY awaited today** — `comments.ts:205`, `tool-service.ts:1461`, `queue-manager.ts:588` all `await`; but `CommentEventSink.emit` is SYNC `void` (`events.ts:34`). v1 §4 wrongly said fire-and-forget. RESOLUTION: sink exposes an awaitable the host route awaits (§4 must-fix #6).
7. **`provenance.runId` has no column** — `types.ts:56-60` has `runId`; `schema.ts:661` only `toolCallId`. RESOLUTION: adapter DROPS `runId`, persists `toolCallId` only → ZERO migration (DEC-6, §2). No other port field lacks a column (verified).
8. **EX-scope bigger than v1 UB-1** — root `package.json` globs `packages/*` (`:7`) and root lock already links comments (`:3038,:14952`), BUT activation ALSO needs `api/package.json` dep, `api/package-lock.json` (currently 0 refs), `api/Dockerfile` COPY+build (`:54-57,:64-66` omit comments), and `Makefile` build-wiring (`API_VERSION:34`, `prepare-node-workspace:1535`, `up-api-test-ci:1584` build only llm-mesh/flow/auth-hono). RESOLUTION: `BR42d-EX1` EXPANDED (mechanical mirrors; rollback = remove). Updated §6 UB-1 + §7.
9. **Lot reorder (ordering hazard)** — v1 deleted the 3 notify copies before callers routed through the sink → emit gap. RESOLUTION new order: Lot0 characterization (incl #3/#4/#5/#6) → Lot1 workspace+BUILD activation FIRST → Lot2 PgCommentStore (+parity, ZERO migration) → Lot3 origin-aware sink (not yet sole emitter) → Lot4 REST migration + delete REST notify SAME lot → Lot5 AI re-route + delete the 2 notify copies SAME lot → Lot6 observability → Lot7 validate (+ bump ONLY if a real package edit — none anticipated).

**Removed v1 statements now contradicted**: (a) `assigned_to:null → unassign` (truth: → `row.createdBy`); (b) `void`/fire-and-forget `notifyCommentEvent` (truth: awaited); (c) DEC-1 version bump `0.1.0→0.2.0` (dropped — no package edit); (d) v1 UB-1 minimal scope `{api/package.json, root package.json, lockfile}` (expanded to incl. `api/package-lock.json`, `api/Dockerfile`, `Makefile` build-wiring); (e) §3bis package additive surfaces (GAP-A method + GAP-B fields — both now host-side); (f) v1 clean PATCH content-vs-assignment separation (truth: whole-update thread cascade on assignment).

---

## Appendix — verified facts ledger (file:line)
- Live `comments` table columns/indexes: `api/src/db/schema.ts:646-671`; `toolCallId` `:661` (NO `run_id`); NO `tenant_id` column (grep-verified).
- `TenantContext{tenantId,workspaceId,userId,sessionId?,runId?}`: `packages/contracts/src/index.ts:1-7`.
- REST handlers: `comments.ts` POST 148-207 (assignee cascade 198-203, single `created` emit 205), PATCH 214-256 (whole-`updates` build 235, `null→createdBy` 238, thread cascade 246-250, per-row 251-252, `updated` emit 254), close 258-285 (emit 283), reopen 287-314 (emit 312), delete 316-339 (emit 337), list 74-137; `notifyCommentEvent` 16-28; gates `ensureContextExists` 30-56, `ensureWorkspaceMember` 58-65.
- NOTIFY/SSE: `streams.ts:167-170` (`sseCommentEvent`), `744-756` (consume payload), `773` (LISTEN).
- AI read/write: `tool-service.ts:1205-1284` (summaries; threadId filter 1215, order 1233, group 1244-1269, limit slice 1281), `1286-1417` (resolve; `closed` emit 1364, `reassigned` emit 1381), `1452-1465` (notify copy, awaited 1461), `1560-1604` (auto-field).
- Auto-comment (queue): `queue-manager.ts:579-592` (notify copy, awaited 588), `1430-1468` (insert).
- AI callers: `chat-service.ts:4400-4407` (suggest list w/ threadId+limit:200), `4422-4429` (resolve).
- Bulk path (kept app-local): `import-export.ts` reads 152-769, insert 1525.
- Package surface: `store.ts` (port), `types.ts:56-60` (`CommentProvenance{toolCallId?,runId?}`), `types.ts:98-103` (`TargetQuery`), `types.ts:109-129` (summary uses `assignee` + `status open|resolved`, omits createdBy/createdAt/updatedAt), `events.ts:10-35` (event + SYNC `emit(event):void` sink), `in-memory.ts` (reference), `package.json` version `0.1.0`, `build` script `tsc -p tsconfig.json`, `main ./dist/index.js`, sole dep `@sentropic/contracts`.
- Build wiring: root `package.json:7` (`packages/*`); root `package-lock.json:3038,14952` (links comments); `api/package.json:53-56` (auth-hono/chat-server/flow/llm-mesh deps, NO comments); `api/package-lock.json` (0 comments refs); `api/Dockerfile:54-57` (COPY package.jsons, no comments), `:64-66` (build auth-hono/llm-mesh/flow, no comments); `Makefile:34` (`API_VERSION` glob, no comments), `:1007` (`build-contracts`), `:1024` (`build-comments: build-contracts`), `:1535` (`prepare-node-workspace: build-llm-mesh build-flow build-auth-hono`), `:1584` (`up-api-test-ci: build-llm-mesh build-flow build-auth-hono`).
- Make/CI lane already present (BR-42c): `Makefile` comments test/typecheck (`:1024,:1045`); CI `validate-comments` `.github/workflows/ci.yml:512-521`, `enforce-package-bump` covers `comments`.
- Tenancy convention `tenantId := workspaceId`: `api/src/services/skills/catalog.ts:32`.
- `createId = randomUUID()`: `api/src/utils/id.ts`.
