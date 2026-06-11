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

- [ ] **Lot 0 — Characterization (RED-first) + row-count gate**
  - [x] Read mandatory rules + spec + cited code.
  - [x] Verify branch: `fix/data-hardening`, worktree `/home/antoinefa/src/sentropic/tmp/data-hardening`.
  - [x] Measure `chat_stream_events` row count via `make db-query QUERY="SELECT count(*) FROM chat_stream_events" ENV=test-data-hardening` → result: 0 rows (fresh test DB) → **plain migration path (D2.d: standard drizzle CREATE INDEX)**.
  - [x] Write RED characterization tests: stranded job consumes maxConcurrentJobs budget; reaper not-yet-created guard; stream purge not-yet-created guard; since_minutes clamp guard.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-data-hardening` + `make lint-api ENV=test-data-hardening`
    - [ ] Scoped RED run: `make test-api-queue SCOPE=tests/queue/queue-reaper.test.ts ENV=test-data-hardening`
    - [x] Commit Lot 0 artifacts (BRANCH.md + new test stubs).

- [ ] **Lot 1 — WI-1 Reaper (schema + reaper module + wire-in)**
  - [ ] `api/src/db/schema.ts`: add `attempts int not null default 0` to `jobQueue`; change `startedAt`/`completedAt` from `text` to `timestamp with time zone`; add index `(status, started_at)`.
  - [ ] `make db-generate ENV=test-data-hardening` → produces `api/drizzle/0032_*.sql`; review SQL.
  - [ ] `api/src/config/env.ts`: add `QUEUE_REAPER_STALE_MINUTES` (default 30) + `QUEUE_MAX_REDELIVERIES` (default 2) to `envSchema`.
  - [ ] `api/src/services/flow/postgres-job-queue.ts`: update `claimPendingJobsByClass` RETURNING clause to include `attempts`; fix `startedAt`/`completedAt` reads/writes (text→timestamp already handled by Drizzle, but raw SQL RETURNING must alias correctly).
  - [ ] Create `api/src/services/queue-reaper.ts`: atomic single-statement requeue sweep + fail-ceiling sweep + `chat_message` fail+finalize path + `runQueueReaper(liveJobIds: string[])` export.
  - [ ] Create `api/src/services/queue-reaper-sweep.ts`: `runQueueReaperSweep(liveJobIds: string[])` wrapper with logger + env reads (mirrors `chat-trace-sweep.ts` pattern).
  - [ ] `api/src/index.ts`: boot call + `setInterval` (every 5 minutes) under `NODE_ENV !== 'test'` guard.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-data-hardening` + `make lint-api ENV=test-data-hardening`
    - [ ] **API tests** (existing + new):
      - [ ] `api/tests/queue/queue.test.ts` — existing queue tests still pass.
      - [ ] `api/tests/queue/queue-reaper.test.ts` — NEW: stranded job requeued (attempts+1) up to ceiling 2 then failed; live in-flight job NOT reaped; chat_message reaped → finalized not requeued; concurrency budget freed after reap.
      - [ ] Scoped run: `make test-api-queue SCOPE=tests/queue/queue-reaper.test.ts ENV=test-data-hardening`
      - [ ] Sub-lot gate: `make test-api-queue ENV=test-data-hardening`
    - [ ] Commit Lot 1 changes.

- [ ] **Lot 2 — WI-2 Stream retention + index + clamp**
  - [ ] `api/src/db/schema.ts`: add `createdAtIdx: index('chat_stream_events_created_at_idx').on(table.createdAt)` to `chatStreamEvents` table indices.
  - [ ] `make db-generate ENV=test-data-hardening` → produces next migration; review SQL (plain CREATE INDEX — see D2.d Lot-0 gate for row count decision).
  - [ ] `api/src/config/env.ts`: add `STREAM_RETENTION_DAYS` (default 7) to `envSchema`.
  - [ ] Create `api/src/services/chat/stream-purge.ts`: `purgeOldStreamEvents(retentionDays: number): Promise<number>` — batched DELETE loop (D2.a pattern, no `.returning()`).
  - [ ] Create `api/src/services/chat/stream-purge-sweep.ts`: `runStreamEventsPurge()` wrapper with logger + env reads.
  - [ ] `api/src/routes/api/streams.ts`: clamp `sinceMinutes` to `STREAM_RETENTION_DAYS * 1440` (D2.c).
  - [ ] `api/src/index.ts`: add boot call + `setInterval` (daily) for `runStreamEventsPurge` under `NODE_ENV !== 'test'` guard.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-data-hardening` + `make lint-api ENV=test-data-hardening`
    - [ ] **API tests** (existing + new):
      - [ ] `api/tests/services/stream-purge.test.ts` — NEW: old rows purged in batches; active (<6h) rows kept; since_minutes clamp enforced.
      - [ ] Scoped run: `make test-api SCOPE=tests/services/stream-purge.test.ts ENV=test-data-hardening`
      - [ ] Sub-lot gate: `make test-api ENV=test-data-hardening`
    - [ ] Commit Lot 2 changes.

- [ ] **Lot 3 — WI-3 task_io_contracts drop**
  - [ ] `api/src/db/schema.ts`: remove `export const taskIoContracts = pgTable('task_io_contracts', ...)` block entirely.
  - [ ] `api/src/db/schema.ts`: remove `export type TaskIoContractRow = typeof taskIoContracts.$inferSelect;` line.
  - [ ] `make db-generate ENV=test-data-hardening` → produces drop migration; review SQL (plain DROP TABLE, no CASCADE, no IF EXISTS).
  - [ ] Grep-prove zero refs: `grep -r 'taskIoContracts\|TaskIoContractRow\|task_io_contracts' api/src/ ui/ packages/ --include='*.ts'` — must return empty.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-data-hardening` + `make lint-api ENV=test-data-hardening`
    - [ ] Sub-lot gate: `make test-api ENV=test-data-hardening`
    - [ ] Commit Lot 3 changes.

- [ ] **Lot 4 — WI-4 flow package comment fix**
  - [ ] `packages/flow/src/job-queue.ts`: rewrite header comment (lines 1-14) to match reality — atomic FOR UPDATE SKIP LOCKED claim + status (pending/processing/completed/failed) + _retry executor-retry metadata + timestamps (started_at/completed_at as timestamp with time zone) + attempts reaper counter + reaper-based stranded recovery; remove lease/heartbeat/DLQ/idempotency claims.
  - [ ] `packages/flow/package.json`: bump patch version (e.g. 0.x.y → 0.x.y+1) per CI enforce-package-bump rule (BR44-EX1).
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-data-hardening`
    - [ ] Commit Lot 4 changes.

- [ ] **Lot N — Final validation gates**
  - [ ] `make typecheck-api ENV=test-data-hardening` — must pass.
  - [ ] `make lint-api ENV=test-data-hardening` — must pass.
  - [ ] `make test-api ENV=test-data-hardening` — all tests pass; record counts.
  - [ ] `make build-api API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1320 ENV=test-data-hardening` — must pass.
  - [ ] Verify migrations apply in order on fresh test DB: `make db-migrate API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1320 ENV=test-data-hardening`.
  - [ ] `make down API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1320 ENV=test-data-hardening` — no stale services.
  - [ ] Delete `spec/SPEC_EVOL_DATA_HARDENING.md` (pre-merge per MASTER complex-branch rule).
  - [ ] Final gate: create/update PR using `BRANCH.md` as body.
  - [ ] CI green → remove `BRANCH.md`, push, merge.

## Environment Mapping
- ENV: `test-data-hardening`
- API_PORT: 9220
- UI_PORT: 5420
- MAILDEV_UI_PORT: 1320
- Slot: BR-44 slot 0 (9000 + 44*5 + 0 = 9220; 5200 + 44*5 + 0 = 5420; 1100 + 44*5 + 0 = 1320)
