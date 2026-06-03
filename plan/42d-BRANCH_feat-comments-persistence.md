# Feature: Comments Persistence + App Activation (BR-42d)

## Objective
Activate `@sentropic/comments@0.1.0` by REAL app consumption (`rules/architecture.md`): an app-local emit-free `PgCommentStore` adapter over the existing live `comments` table, host-controlled wire emission through an origin-aware `PgNotifyCommentEventSink` carrying an explicit `{action, key}`, a 0-legacy migration of the live comments subsystem (REST + AI + auto paths) onto the port, plus minimal observability — with NO package src edit anticipated and therefore NO version bump.

## Scope / Guardrails
- Scope limited to the comments runtime surface: `api/src/routes/api/comments.ts`, new `api/src/services/comments/**`, the comment regions of `api/src/services/tool-service.ts` and `api/src/services/queue-manager.ts`, input wiring in `api/src/services/context-comments.ts`, and the matching tests.
- ZERO migration expected (every persisted port field already maps to a live column; `provenance.runId` is dropped, not migrated). One additive nullable column in one `api/drizzle/*.sql` file MAX, only if Lot 2 finds a missing column (BR42d-EX2, NOT anticipated).
- No `packages/comments/src/**` edit anticipated → no version bump (spec DEC-1). A real package edit, if it surfaces, triggers an additive-only change + bump under BR42d-EX2.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-comments-persistence`.
- Slot-2 ports: `API_PORT=9212`, `UI_PORT=5412`, `MAILDEV_UI_PORT=1312`. `ENV=feat-comments-persistence` for dev, `ENV=test-feat-comments-persistence` for API tests, `ENV=e2e-feat-comments-persistence` for E2E.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/routes/api/comments.ts`
  - `api/src/services/comments/**` (new: `pg-comment-store.ts`, `pg-notify-comment-event-sink.ts`, host summary mapper)
  - `api/src/services/tool-service.ts` (comment regions only)
  - `api/src/services/queue-manager.ts` (auto-comment region only)
  - `api/src/services/context-comments.ts` (summary INPUT wiring only)
  - `api/tests/api/comments.test.ts`
  - `api/tests/api/comments-wire.test.ts` (new — Lot 0 wire-payload characterization)
  - `api/tests/api/pg-comment-store.test.ts` (new — Lot 2 adapter-parity)
  - `api/tests/ai/comment-assistant.test.ts`
  - `e2e/tests/07_comment_assistant.spec.ts`
  - `plan/42d-BRANCH_feat-comments-persistence.md` (this file)
  - NOTE: ALL new specs MUST live under `api/tests/**`, NEVER under `api/src/**` — `api/tsconfig.json:16` sets `"include": ["src"]`, so a test placed under `src` would pollute `make typecheck-api`.
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `api/src/routes/api/streams.ts` (NOTIFY/SSE transport — unchanged)
  - `api/src/routes/api/import-export.ts` (bulk snapshot — kept app-local)
  - `ui/**`
  - `.cursor/rules/**`
  - other `plan/**` and `PLAN.md`
- **Conditional Paths (allowed only via explicit exception)**:
  - `api/package.json`, root `package-lock.json`, `api/package-lock.json`, `api/Dockerfile`, `Makefile` (build-wiring) — granted under BR42d-EX1.
  - `api/drizzle/*.sql` (max 1 file) + migration make target — BR42d-EX2 (only if triggered by Lot 2).
  - `packages/comments/src/**` + version bump — BR42d-EX2 (only if a real package edit surfaces).
- **Exception process**:
  - `BR42d-EX1` (GRANTED) and `BR42d-EX2` (CONDITIONAL) declared below in `## Feedback Loop`.

## Feedback Loop
- BR42d-EX1 (`acknowledge`, GRANTED — spec UB-1, EXPANDED): touch DEFAULT-FORBIDDEN build-wiring files = `api/package.json` + root `package-lock.json` + `api/package-lock.json` + `api/Dockerfile` + `Makefile`.
  - Reason: activation of `@sentropic/comments` requires workspace + BUILD wiring — `api/package.json` dep (`file:../packages/comments`), regenerated locks (`api/package-lock.json` has 0 comments refs today), `api/Dockerfile` COPY + `RUN npm --workspace @sentropic/comments run build` (package `main:./dist/index.js` needs a tsc dist at runtime), and `Makefile` build wiring: add `build-comments` to `prepare-node-workspace` + `up-api-test-ci`, and `packages/comments/{src,package.json,tsconfig.json}` to the `API_VERSION` glob.
  - Impact: MECHANICAL — each line mirrors an existing `@sentropic/llm-mesh`/`chat-server`/`flow`/`auth-hono` entry. No edits to unrelated targets. This build wiring IS the activation (the point of BR-42d).
  - Rollback: remove the added dep/COPY/build/glob/prerequisite entries; revert the locks.
- BR42d-EX2 (`deferred` — CONDITIONAL, only if triggered): touch `api/drizzle/*.sql` + a migration make target AND/OR `packages/comments/src/**` + a `0.1.0→0.2.0` bump.
  - Reason: zero migration is expected (spec §2/UB-2) and no package edit is expected (spec §3bis/DEC-1); this EX activates ONLY if Lot 2 finds a missing column or a genuine package src need surfaces during implementation.
  - Impact: at most ONE additive nullable column in ONE migration file (`rules/data.md` single-migration rule), and/or one additive-optional package field (`enforce-package-bump` CI already covers `comments`).
  - Rollback: drop the migration file + target; revert the package field + bump.
- Activation note (`acknowledge`): BR-42d is the activation half of the BR-42c→BR-42d sequenced two-branch plan. This branch forked OFF `feat/comments-package`, so the `packages/comments@0.1.0` commits are included here; BR-42c merges TOGETHER with BR-42d.
- Accuracy note (`acknowledge`, Codex review): zero-migration holds for ALL persisted port fields (every one maps to a live `comments` column), and `author.kind`/`author.displayLabel` are HOST-ONLY (derived via the app-local `users` label join, NOT persisted) — confirms BR42d-EX2 stays un-triggered. No action; recorded for implementer accuracy.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in this file; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Candidate AI surface: `api/tests/ai/comment-assistant.test.ts` + `e2e/tests/07_comment_assistant.spec.ts` (AI resolve-actions). Document any accepted signature here.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal activation deliverable on a single branch; characterization-first migration needs a single coherent test cycle, no independent sub-CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on the integrated branch only. No `ui/**` change in BR-42d → no UI UAT lot; the realtime/SSE surface is behavior-preserving (characterization-proven).
- Activation smoke (architecture.md): a manual BR-42d activation smoke on `ENV=dev` with the user's real data at the END (create/edit/assign/close/reopen/delete a comment + AI resolve, observe live SSE), NEVER an automated suite on `ENV=dev`.
- Execution flow: develop + run automated tests in `tmp/feat-comments-persistence` (`ENV=test-*`/`ENV=e2e-*`); push branch; run the activation smoke from root (`ENV=dev`); switch back.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Characterization lock** (no src change; GREEN on current code)
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/architecture.md`, `spec/SPEC_EVOL_COMMENTS_PERSISTENCE.md`, `plan/BRANCH_TEMPLATE.md`.
  - [ ] Confirm worktree/branch (`git -C tmp/feat-comments-persistence branch --show-current` == `feat/comments-persistence`).
  - [ ] Extend `api/tests/api/comments.test.ts` to PIN live REST behavior: list filtering + user-label join shape (`created_by_user`/`assigned_to_user`); thread mint/reply + `404 'Thread not found'`; per-row content edit; **combined-PATCH cascading the WHOLE `updates` (content + assignment) thread-wide when `assigned_to` present**; **`assigned_to:null → row.createdBy` (NOT unassign)**; **POST-with-assignee emits EXACTLY ONE `created`**; close/reopen thread cascade; per-row hard delete (replies survive); assignee-not-member `400`; creator/admin gates `403`. Capture EXACT JSON shapes (`id`, `thread_id`, `items[].*`, `success`).
  - [ ] PIN the live POST default-assignee chain `assigned_to ?? existingThreadAssignee ?? userId` (`comments.ts:176`): (a) a ROOT comment posted with NO `assigned_to` defaults its assignee to the creator (`user.userId`); (b) a REPLY posted with NO `assigned_to` defaults to the EXISTING thread assignee (`existingThreadAssignee`, read from the parent thread row).
  - [ ] Extend `api/tests/ai/comment-assistant.test.ts` to PIN the live `CommentThreadSummary` field set (`createdBy/createdAt/updatedAt/assignedTo`, `status open|closed`) + grouping (root=earliest, last=latest, count, closed-if-any, first non-null assignee) and `resolveCommentActions` (close/reassign/trace-note + `toolCallId` provenance).
  - [ ] Add a wire-payload characterization test in a NEW spec `api/tests/api/comments-wire.test.ts` (under `api/tests/**`, NOT `api/src/**`), driven via the SSE `comment_update` frame or a NOTIFY spy, pinning the FULL per-(origin,event) wire-key matrix byte-for-byte:
    - REST created/updated/closed/reopened/deleted → `comment_id` (`comments.ts:205,254,283,312,337`).
    - AI close → `closed`/`thread_id` (`tool-service.ts:1364`); AI reassign → `reassigned`/`thread_id` (`tool-service.ts:1381`); AI trace-note created → `created`/`comment_id` (`tool-service.ts:1411`).
    - auto created → `created`/`comment_id` (`tool-service.ts:1602` + `queue-manager.ts:1466`).
    - exactly ONE `created` for POST-with-assignee; exactly ONE `updated` for PATCH-with-assignment.
    - awaited-NOTIFY semantics (the response/next action waits on the NOTIFY flush).
  - [ ] Lot gate: `make test-api-comments SCOPE=tests/api/comments.test.ts ENV=test-feat-comments-persistence` GREEN on current code; AI scope GREEN; wire test GREEN.

- [ ] **Lot 1 — Workspace + BUILD activation FIRST** (BR42d-EX1)
  - [ ] `api/package.json`: add `"@sentropic/comments": "file:../packages/comments"` (mirror auth-hono/chat-server/flow/llm-mesh).
  - [ ] Regenerate `api/package-lock.json` (link the new dep) with `make lock-api`, then root `package-lock.json` with `make lock-root` (`make lock-*` is NOT a target; the real targets are `make lock-api` (Makefile:420) and `make lock-root` (Makefile:425)).
  - [ ] `api/Dockerfile`: `COPY packages/contracts/package.json` AND `COPY packages/comments/package.json` (mirror the existing `COPY packages/<pkg>/package.json` block, Dockerfile:54-58). Then add the per-package build RUN steps in DEPENDENCY ORDER: `RUN npm --workspace @sentropic/contracts run build` BEFORE `RUN npm --workspace @sentropic/comments run build` (`@sentropic/comments` depends on `@sentropic/contracts` — `packages/comments/package.json:35`, and `build-comments: build-contracts`, Makefile:1024; contracts is NOT currently copied/built in the Dockerfile so BOTH the contracts COPY and the contracts build RUN must be added, placed before the comments build, mirroring the existing `RUN npm --workspace ... run build` block at Dockerfile:64-66).
  - [ ] `Makefile`: add `build-comments` to `prepare-node-workspace` + `up-api-test-ci`; add `packages/comments/{src,package.json,tsconfig.json}` to the `API_VERSION` glob.
  - [ ] Lot gate:
    - [ ] `make build-api ENV=test-feat-comments-persistence` — api image builds with `comments` built into dist.
    - [ ] Prove the api imports the package (smoke import of `CommentStore` from `@sentropic/comments` in api code/typecheck).
    - [ ] `make typecheck-api ENV=test-feat-comments-persistence` + `make lint-api ENV=test-feat-comments-persistence`.

- [ ] **Lot 2 — `PgCommentStore` adapter** (`api/src/services/comments/pg-comment-store.ts`)
  - [ ] Implement `CommentStore` over the existing `comments` table, PERSISTENCE-ONLY (does NOT auto-emit; primitives for host composition are emit-free): `add` (mint id/threadId, `ThreadNotFoundError` on bad reply), `get`, `edit` (per-row content), `delete` (per-row hard), `listByTarget`/`listThread` (`createdAt ASC, id ASC`), `listThreadSummaries` (group-by per `tool-service.ts:1244-1269`), `setState`/`assign` (thread cascade).
  - [ ] Map `tenant.workspaceId → comments.workspace_id`, ignore `tenant.tenantId` (live convention `tenantId := workspaceId`); inject `createId` (`api/src/utils/id.ts`).
  - [ ] DROP `provenance.runId` (no column); persist `provenance.toolCallId ↔ comments.toolCallId` only.
  - [ ] CONFIRM ZERO migration (every port field has a column); if a column is missing, escalate BR42d-EX2 (single additive migration). NOT anticipated.
  - [ ] Adapter-parity tests: reuse the in-memory adapter scenarios against a real test DB in a NEW spec `api/tests/api/pg-comment-store.test.ts` (MUST live under `api/tests/**`, NEVER under `api/src/**` per `api/tsconfig.json:16` `"include": ["src"]`) — CRUD, threading, thread cascade, ordering tiebreaker, tenant-scoping, `runId`-drop.
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api ENV=test-feat-comments-persistence`.
    - [ ] **API tests**: adapter-parity spec GREEN; Lot 0 characterization stays GREEN (`make test-api-comments SCOPE=tests/api/comments.test.ts ENV=test-feat-comments-persistence`).

- [ ] **Lot 3 — `PgNotifyCommentEventSink`** (`api/src/services/comments/pg-notify-comment-event-sink.ts`, origin-aware)
  - [x] Implement `CommentEventSink` consuming the EXPLICIT `{action, key}` descriptor (key ∈ `{comment_id, thread_id}`); build `{workspace_id, context_type, context_id, data:{action, ...key}}` (matches `streams.ts:747-755`); `NOTIFY comment_events` via `pool.connect()` reusing `escapeNotifyPayload`.
  - [x] Expose an AWAITABLE flush so the host path can await the NOTIFY round-trip (match live awaited back-pressure; errors not silently swallowed). Built but NOT yet the sole emitter (the 3 live `notifyCommentEvent` copies still stand — NO deletion this lot, so no emit gap).
  - [ ] Wire-test the sink against the Lot 0 matrix (incl. AI trace-note `created`=`comment_id`, auto `created`=`comment_id`) + awaitable flush.
  - [ ] Lot gate: `make typecheck-api` + `make lint-api ENV=test-feat-comments-persistence`; sink wire-test GREEN; Lot 0 characterization stays GREEN.

- [ ] **Lot 4 — REST migration** (M-REST, `api/src/routes/api/comments.ts`)
  - [ ] Rewrite the 6 handlers onto the store's EMIT-FREE persistence: POST = `add` + host-local SILENT thread-assignee cascade (no second event); PATCH = host-local REST PATCH helper performing the whole-`updates` thread cascade (content + `assigned_to:null→createdBy`) exactly as `comments.ts:235-254`; close/reopen = `setState`; delete = `delete`; list = `listByTarget` + keep the app-local `users` label join.
  - [ ] Emit EXACTLY ONE route-owned event per handler via the sink with the explicit `{action, key}` (origin `rest`, all keys `comment_id`), AWAITING the flush.
  - [ ] DELETE the REST `notifyCommentEvent` + `escapeNotifyPayload` copy (`comments.ts:16-28`) IN THIS SAME lot (no dual path). KEEP `ensureContextExists`/`ensureWorkspaceMember`/role gates app-local.
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api ENV=test-feat-comments-persistence`.
    - [ ] **API tests**: `api/tests/api/comments.test.ts` characterization stays GREEN unchanged (`make test-api-comments SCOPE=tests/api/comments.test.ts ENV=test-feat-comments-persistence`); wire-payload test stays GREEN.

- [ ] **Lot 5 — AI re-route** (M-AI-READ / M-AI-WRITE / M-AUTO)
  - [ ] `api/src/services/tool-service.ts` read path: re-route `listCommentThreadsForContexts` grouping to `store.listThreadSummaries` (per-context loop; host applies threadId/limit/global-ordering; host summary mapper `assignee→assignedTo`, `resolved→closed`, derive `createdBy/createdAt/updatedAt` from thread rows); KEEP the `users` join app-local.
  - [ ] `api/src/services/tool-service.ts` write path: re-route `resolveCommentActions` close→`setState`, reassign→`assign`, trace-note→`add` (all EMIT-FREE); emit explicit `{action, key}` via the sink: close→`{closed, thread_id}`, reassign→`{reassigned, thread_id}`, trace-note→`{created, comment_id}`; KEEP AI gating (`hasWorkspaceRole`/`ensureWorkspaceMember`/allowed-context) app-local.
  - [ ] `api/src/services/queue-manager.ts` + tool-service auto path (M-AUTO): re-route both auto-field inserts to `store.add({provenance.toolCallId})`; emit `{created, comment_id}` (origin `auto`) via the SAME shared store+sink instance (out-of-request lifecycle, spec DEC-4).
  - [ ] `api/src/services/context-comments.ts`: wire the summary INPUT to come from the port via the host mapper (prompt + `generateCommentResolutionProposal` stay app-local).
  - [ ] DELETE the 2 remaining `notifyCommentEvent` copies (`tool-service.ts:1452-1465`, `queue-manager.ts:579-592`) IN THIS SAME lot. After this lot the sink is the SOLE comment NOTIFY emitter (0-legacy).
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api ENV=test-feat-comments-persistence`.
    - [ ] **API tests**: `api/tests/ai/comment-assistant.test.ts` characterization stays GREEN (`make test-api-ai SCOPE=tests/ai/comment-assistant.test.ts ENV=test-feat-comments-persistence`); wire test stays GREEN.
    - [ ] AI flaky run (non-blocking under acceptance rule): document status/signature in this file.

- [ ] **Lot 6 — Observability** (§5, in the sink choke-point)
  - [ ] Structured log per emitted `CommentEvent` via the api logger: `{event:'comment.<type>', origin, workspaceId, threadId, commentId, contextType, userId}` (single choke-point in the sink, no per-handler sprinkling).
  - [ ] Provider-neutral in-process counter of emitted comment events by `type` (reuse any existing metric primitive; else a tiny in-memory counter). NO new metrics backend; NO durable provider names.
  - [ ] Lot gate: `make typecheck-api` + `make lint-api ENV=test-feat-comments-persistence`; characterization + wire tests stay GREEN.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint: `make typecheck-api` + `make lint-api ENV=test-feat-comments-persistence`.
  - [ ] Retest API: `make test-api ENV=test-feat-comments-persistence` (full suite GREEN, incl. `comments.test.ts` + `comment-assistant.test.ts` + the new wire-payload + pg-comment-store parity tests).
  - [ ] Package validation (`validate-comments` is a CI job, ci.yml:512, NOT a Makefile target — run the real package gates instead): `make typecheck-comments`, `make test-comments` (in-memory adapter), `make build-comments`, `make pack-comments` all GREEN (targets at Makefile:1045/1340/1024/1065).
  - [ ] Retest E2E: prepare build `make build-api build-ui-image API_PORT=9212 UI_PORT=5412 MAILDEV_UI_PORT=1312 ENV=e2e-feat-comments-persistence`, then `make clean test-e2e E2E_SPEC=tests/07_comment_assistant.spec.ts API_PORT=9212 UI_PORT=5412 MAILDEV_UI_PORT=1312 ENV=e2e-feat-comments-persistence`.
  - [ ] AI flaky: document pass/fail signatures + record explicit user sign-off if any accepted.
  - [ ] Package bump: ONLY if a real `packages/comments/src/**` edit happened (per spec DEC-1, NONE anticipated → no bump; `enforce-package-bump` CI covers `comments`).
  - [ ] Confirm `BR42d-EX2` stayed un-triggered (ZERO migration, no package edit) OR record its resolution.
  - [ ] BR-42d activation smoke on `ENV=dev` with user data (manual, at the END — NEVER automated suites on `ENV=dev`).
  - [ ] Final gate step 1: create/update PR using this file as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR (BR-42c + BR-42d merge together) and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT smoke + CI are both OK, commit removal of this file, push, and merge.

## Deferred to BR-XX
- Bulk import/export event emission (`api/src/routes/api/import-export.ts`) — kept app-local; revisit only if a later branch needs import to emit live events (spec D-IE / DEC-5).
- Any `@sentropic/comments` package surface widening (multi-context summary method, extended summary fields) — handled host-side now; re-introduce additive-only + bump only if a real need surfaces (spec §3bis / DEC-1).
- Distributed tracing, external metrics backend (Prometheus/OTel), dashboards, per-tenant rate stats (spec §5 DEFERRED).
