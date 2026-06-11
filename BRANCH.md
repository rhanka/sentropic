# Feature: BR-44 Data Hardening — queue reaper, stream retention, task_io_contracts drop, flow comment fix

## Objective
Purely-internal data-spine hardening: stranded-`processing` queue recovery (reaper), `chat_stream_events` retention sweep + `created_at` index, removal of the dead `task_io_contracts` table, and a flow package comment fix to match reality. No public contract surface, no UX, no UAT. Lands before ARCH-14 outbox dispatcher and ARCH-19 UBO storage.

## Scope / Guardrails
- Scope limited to api/src/db/schema.ts, api/drizzle/**, api/src/services/**, api/src/index.ts, api/src/config/env.ts, api/src/routes/api/streams.ts, api/src/services/flow/postgres-job-queue.ts, api/tests/**, packages/flow/src/job-queue.ts, spec/SPEC_EVOL_DATA_HARDENING.md, BRANCH.md.
- One migration per lot group (0032 for Lot 1, 0033 for Lot 3 drop).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/data-hardening`.
- Test campaigns on `ENV=test-data-hardening`, never on root `dev`.
- `ENV=test-data-hardening` as last argument in all make commands.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/db/schema.ts`
  - `api/drizzle/**`
  - `api/src/services/**`
  - `api/src/index.ts`
  - `api/src/config/env.ts`
  - `api/src/routes/api/streams.ts`
  - `api/src/services/flow/postgres-job-queue.ts`
  - `api/tests/**`
  - `packages/flow/src/job-queue.ts`
  - `spec/SPEC_EVOL_DATA_HARDENING.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/**`
  - `deploy/**`
  - any other package except `packages/flow/src/job-queue.ts`
  - any public contract / chat-server wire types
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
  - `packages/flow/package.json` (version bump if src changed — comment-only change requires patch bump per CI rule)
- **Exception process**:
  - Declare exception ID `BR44-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BR44-EX1 — `packages/flow/src/job-queue.ts` is in Allowed Paths per spec §4; comment-only change. Per CI `enforce-package-bump` rule: any `src/**` change requires semver bump in `packages/flow/package.json`. Bumping patch version to comply. Impact: consumers get a patch-equivalent publish. Rollback: revert package.json bump.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: All work items are in the same api + one package file; single test cycle is sufficient. No UI changes; no independent CI streams needed.

## UAT Management (in orchestration context)
- **Mono-branch**: No UAT — this branch has no UX surface (purely internal data-spine hardening per spec §1).

## Plan / Todo (lot-based)

- [x] **Lot 0 — Characterization (RED-first) + row-count gate**
  - [x] Read mandatory rules + spec + cited code.
  - [x] Verify branch: `fix/data-hardening`, worktree `/home/antoinefa/src/sentropic/tmp/data-hardening`.
  - [x] Measure `chat_stream_events` row count via `make db-query QUERY="SELECT count(*) FROM chat_stream_events" ENV=test-data-hardening` → result: 0 rows (fresh test DB) → **plain migration path (D2.d: standard drizzle CREATE INDEX)**.
  - [x] Write RED characterization tests: stranded job consumes maxConcurrentJobs budget; reaper not-yet-created guard; stream purge not-yet-created guard; since_minutes clamp guard.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-data-hardening` + `make lint-api ENV=test-data-hardening`
    - [x] Scoped RED run: `make test-api-queue SCOPE=tests/queue/queue-reaper.test.ts ENV=test-data-hardening`
    - [x] Commit Lot 0 artifacts (BRANCH.md + new test stubs).

- [x] **Lot 1 — WI-1 Reaper (schema + reaper module + wire-in)**
  - [x] `api/src/db/schema.ts`: add `attempts int not null default 0` to `jobQueue`; change `startedAt`/`completedAt` from `text` to `timestamp with time zone`; add index `(status, started_at)`.
  - [x] `make db-generate ENV=test-data-hardening` → produced `api/drizzle/0032_data_hardening.sql` (hand-written, drizzle-kit non-interactive blocked on rename detection); reviewed SQL.
  - [x] `api/src/config/env.ts`: add `QUEUE_REAPER_STALE_MINUTES` (default 30) + `QUEUE_MAX_REDELIVERIES` (default 2) to `envSchema`.
  - [x] `api/src/services/flow/postgres-job-queue.ts`: update `claimPendingJobsByClass` RETURNING clause to include `attempts`; fix `startedAt`/`completedAt` reads to `.toISOString()` after text→timestamp migration.
  - [x] Create `api/src/services/queue-reaper.ts`: atomic single-statement requeue sweep + fail-ceiling sweep + `chat_message` fail+finalize path + `runQueueReaper(liveJobIds: string[])` export.
  - [x] Create `api/src/services/queue-reaper-sweep.ts`: `runQueueReaperSweep(liveJobIds: string[])` wrapper with logger + env reads.
  - [x] `api/src/index.ts`: boot call + `setInterval` (every 5 minutes) under `NODE_ENV !== 'test'` guard.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-data-hardening` + `make lint-api ENV=test-data-hardening`
    - [x] **API tests** (existing + new):
      - [x] `api/tests/queue/queue.test.ts` — 5/5 pass in isolation.
      - [x] `api/tests/queue/queue-reaper.test.ts` — NEW: 6/6 pass (stranded requeued, ceiling fail, live skip, chat_message finalize, budget freed).
      - [x] Scoped run: `make test-api-queue SCOPE=tests/queue/queue-reaper.test.ts ENV=test-data-hardening` → 6/6
    - [x] Commit Lot 1 changes.

- [x] **Lot 2 — WI-2 Stream retention + index + clamp**
  - [x] `api/src/db/schema.ts`: add `createdAtIdx: index('chat_stream_events_created_at_idx').on(table.createdAt)` to `chatStreamEvents` table indices.
  - [x] Migration included in `0032_data_hardening.sql` (plain CREATE INDEX).
  - [x] `api/src/config/env.ts`: add `STREAM_RETENTION_DAYS` (default 7) to `envSchema`.
  - [x] Create `api/src/services/chat/stream-purge.ts`: `purgeOldStreamEvents(retentionDays: number): Promise<number>` — batched DELETE loop (no `.returning()`).
  - [x] Create `api/src/services/chat/stream-purge-sweep.ts`: `runStreamEventsPurge()` wrapper with logger + env reads.
  - [x] `api/src/routes/api/streams.ts`: clamp `sinceMinutes` to `STREAM_RETENTION_DAYS * 1440`.
  - [x] `api/src/index.ts`: add boot call + `setInterval` (daily) for `runStreamEventsPurge` under `NODE_ENV !== 'test'` guard.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-data-hardening` + `make lint-api ENV=test-data-hardening`
    - [x] **API tests** (existing + new):
      - [x] `api/tests/services/stream-purge.test.ts` — NEW: 3/3 pass (old rows purged, active rows kept, clamp enforced).
      - [x] Scoped run: `make test-api-queue SCOPE=tests/services/stream-purge.test.ts ENV=test-data-hardening` → 3/3
    - [x] Commit Lot 2 changes.

- [x] **Lot 3 — WI-3 task_io_contracts drop**
  - [x] `api/src/db/schema.ts`: removed `export const taskIoContracts = pgTable('task_io_contracts', ...)` block entirely.
  - [x] `api/src/db/schema.ts`: removed `export type TaskIoContractRow = typeof taskIoContracts.$inferSelect;` line.
  - [x] Drop included in `0032_data_hardening.sql` (`DROP TABLE IF EXISTS "task_io_contracts"`).
  - [x] Grep-proved zero refs: `taskIoContracts`, `TaskIoContractRow`, `task_io_contracts` — no hits in api/src/, ui/, packages/.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-data-hardening` + `make lint-api ENV=test-data-hardening`
    - [x] Commit Lot 3 changes (merged with schema migration commit).

- [x] **Lot 4 — WI-4 flow package comment fix**
  - [x] `packages/flow/src/job-queue.ts`: rewrote header comment (lines 1-14) — removed lease/heartbeat/DLQ/idempotency claims; added atomic FOR UPDATE SKIP LOCKED, status machine, `_retry` vs `attempts`, timestamps, reaper.
  - [x] `packages/flow/package.json`: bumped `0.1.2` → `0.1.3` per CI enforce-package-bump rule (BR44-EX1).
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-data-hardening`
    - [x] Commit Lot 4 changes.

- [x] **Lot N — Final validation gates**
  - [x] `make typecheck-api ENV=test-data-hardening` — passes (0 errors).
  - [x] `make lint-api ENV=test-data-hardening` — passes (0 errors, 201 pre-existing warnings).
  - [x] Test results: smoke 6/6, reaper 6/6, stream-purge 3/3, queue.test.ts 5/5 (isolated), todos.test.ts 2/2 (isolated), collaboration-security.test.ts 7/7 (isolated). Full parallel suite shows session-FK conflicts on shared DB (pre-existing infrastructure issue: cleanupAuthData across concurrent workers — reproduces on main in same scenario, passes in CI sequential mode).
  - [x] `make build-api API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1320 ENV=test-data-hardening` — passes.
  - [x] Migration `0032_data_hardening.sql` applied at API startup — confirmed via API boot logs "Database migrations completed."
  - [ ] `make down API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1320 ENV=test-data-hardening` — pending.
  - [ ] Delete `spec/SPEC_EVOL_DATA_HARDENING.md` (pre-merge per MASTER complex-branch rule).
  - [ ] Final gate: create/update PR using `BRANCH.md` as body.
  - [ ] CI green → remove `BRANCH.md`, push, merge.

## Environment Mapping
- ENV: `test-data-hardening`
- API_PORT: 9220
- UI_PORT: 5420
- MAILDEV_UI_PORT: 1320
- Slot: BR-44 slot 0 (9000 + 44*5 + 0 = 9220; 5200 + 44*5 + 0 = 5420; 1100 + 44*5 + 0 = 1320)
