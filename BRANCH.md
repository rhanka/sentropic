# Feature: BR-60 outbox-v0 — event-spine V0 slice

## Objective
Implement the V0 SLICE of the ARCH-14 event spine: `control` schema + its own migration stream + `control.event_outbox` + OutboxWriter port + EventBusPort + outbox dispatcher (BR-44-reaper-mirrored) + ONE proven producer (`job_queue` / `job_events` channel) + full test suite.

## Scope / Guardrails
- Scope limited to `api/src/services/outbox/**`, `api/src/db/control-schema.ts`, `api/drizzle.control.config.ts`, `api/drizzle/control/**`, `api/src/db/run-migrations.ts`, `api/src/index.ts`, `api/src/services/queue-manager.ts` (ONE producer wire-in), `api/package.json` (`db:generate-control` script), `api/tests/outbox/**`, `spec/SPEC_EVOL_OUTBOX_V0.md`, `BRANCH.md`.
- One migration max per stream (one public, one control).
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` reserved for user dev/UAT (`ENV=dev`) — stable.
- Branch development in isolated worktree `tmp/outbox-v0`.
- Automated test campaigns on dedicated environment (`ENV=test-outbox-v0`), never on root `dev`.
- ENV=test-outbox-v0 is LAST argument in every make command.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/db/control-schema.ts` (new)
  - `api/drizzle.control.config.ts` (new)
  - `api/drizzle/control/**` (new)
  - `api/src/db/run-migrations.ts` (control-stream wire-in only)
  - `api/src/services/outbox/**` (new)
  - `api/src/index.ts` (dispatcher wire-in only)
  - `api/src/services/queue-manager.ts` (ONE producer outbox co-write only)
  - `api/package.json` (`db:generate-control` script only)
  - `api/tests/outbox/**` (new)
  - `spec/SPEC_EVOL_OUTBOX_V0.md` (deleted pre-merge)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**` (NO @sentropic/contracts/comments/chat mutation)
  - `ui/**`
  - `deploy/**`
  - any tenant-model change
  - any other producer besides job_events (queue-manager notifyJobEvent path)
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
  - `api/src/db/schema.ts` (no change expected)
- **Exception process**:
  - Declare exception ID `BR60-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: Single orthogonal infra task; no concurrent sub-branches needed.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch — no UAT checkpoints needed.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline: write BRANCH.md, confirm no control schema, pick producer, characterization tests**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/subagents.md, rules/testing.md
  - [x] Read spec/SPEC_EVOL_OUTBOX_V0.md + spec/SPEC_EVOL_EVENT_SPINE.md
  - [x] Read plan/BRANCH_TEMPLATE.md
  - [x] Verify branch is feat/outbox-v0 in worktree
  - [x] Map drizzle-config + run-migrations mechanism
  - [x] Confirm no `control` schema exists (`grep -r "control" api/drizzle/`)
  - [x] Pick ONE producer: `job_events` via `QueueManager.notifyJobEvent` (cleanest channel — `notifyJobEvent` is called from within jobs that use `db.transaction`; the `addJob` path + `processJob` completion path both need co-writing in same txn)
  - [x] Write BRANCH.md from template
  - [x] Control migration mechanism: add `db:generate-control` script to `api/package.json` (Allowed path) that calls `drizzle-kit generate --config=drizzle.control.config.ts` — NO Makefile change needed (Makefile only calls `npm run db:generate`; the control migration is applied programmatically in `run-migrations.ts`)
  - [ ] Commit BRANCH.md
  - Lot gate: no gate (baseline only)

- [ ] **Lot 1 — `control` schema + migration stream**
  - [ ] Create `api/drizzle.control.config.ts` (schemaFilter=['control'], out='./drizzle/control', dialect='postgresql')
  - [ ] Create `api/src/db/control-schema.ts` with `control.event_outbox` full DDL per spec
  - [ ] Add `db:generate-control` script to `api/package.json`
  - [ ] Write handcrafted SQL migration `api/drizzle/control/0000_control_schema_and_event_outbox.sql` (CREATE SCHEMA control + CREATE TABLE control.event_outbox with all DDL per spec §1 Q1)
  - [ ] Write `api/drizzle/control/meta/_journal.json` (drizzle meta for control stream)
  - [ ] Wire `api/src/db/run-migrations.ts` to apply control stream AFTER public (CREATE SCHEMA IF NOT EXISTS control + migrate from ./drizzle/control)
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
    - [ ] `make lint-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`

- [ ] **Lot 2 — OutboxWriter**
  - [ ] Create `api/src/services/outbox/outbox-writer.ts`: `append(tx, params)` with `pg_advisory_xact_lock(hashtext(aggregateType||aggregateId))` + `MAX(seq)+1` + INSERT + `NOTIFY outbox_pending`
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
    - [ ] `make lint-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`

- [ ] **Lot 3 — EventBusPort**
  - [ ] Create `api/src/services/outbox/event-bus.ts`: `EventBusPort` interface + `publish(channel, payload)` + `PgEventBus` default binding (wraps `pool.connect()` + `NOTIFY`)
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
    - [ ] `make lint-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`

- [ ] **Lot 4 — Outbox dispatcher + sweep**
  - [ ] Create `api/src/services/outbox/outbox-dispatcher.ts`: LISTEN `outbox_pending` + periodic fallback; `pg_try_advisory_lock`; claim pending in `(aggregate_type, aggregate_id, seq)` order; `attempts++`; stale-`processing` recovery; redelivery ceiling → `failed`; per-aggregate blocking; emit via `EventBusPort`; mark `dispatched`
  - [ ] Create `api/src/services/outbox/outbox-dispatcher-sweep.ts`: periodic sweep wrapper (mirrors `queue-reaper-sweep.ts` pattern)
  - [ ] Wire `api/src/index.ts`: import + start dispatcher under `NODE_ENV !== 'test'`
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
    - [ ] `make lint-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`

- [ ] **Lot 5 — Wire ONE producer end-to-end**
  - [ ] Producer chosen: `job_events` channel; wire in `QueueManager.addJob` path — co-write outbox inside the `addJob` transaction (or wrap addJob in a transaction that co-writes outbox)
  - [ ] Verify: existing SSE consumer in `streams.ts` remains UNCHANGED (snapshot-on-wake pattern safe)
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
    - [ ] `make lint-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`

- [ ] **Lot 6 — Tests**
  - [ ] Create `api/tests/outbox/outbox-round-trip.test.ts`: append → dispatch → dispatched status
  - [ ] Create `api/tests/outbox/outbox-ordering.test.ts`: per-aggregate seq monotonic, UNIQUE enforced
  - [ ] Create `api/tests/outbox/outbox-advisory-lock.test.ts`: concurrent appends yield no dup seq
  - [ ] Create `api/tests/outbox/outbox-dispatcher-recovery.test.ts`: stale `processing` re-claimed by sweep
  - [ ] Create `api/tests/outbox/outbox-ceiling.test.ts`: redelivery ceiling → status `failed`
  - [ ] Create `api/tests/outbox/producer-job-events.test.ts`: addJob → outbox row → dispatcher → NOTIFY observed
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
    - [ ] `make lint-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
    - [ ] API tests:
      - [ ] `make test-api SCOPE=tests/outbox/outbox-round-trip.test.ts API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
      - [ ] `make test-api SCOPE=tests/outbox/outbox-ordering.test.ts API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
      - [ ] `make test-api SCOPE=tests/outbox/outbox-advisory-lock.test.ts API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
      - [ ] `make test-api SCOPE=tests/outbox/outbox-dispatcher-recovery.test.ts API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
      - [ ] `make test-api SCOPE=tests/outbox/outbox-ceiling.test.ts API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
      - [ ] `make test-api SCOPE=tests/outbox/producer-job-events.test.ts API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`

- [ ] **Lot N — Final gates**
  - [ ] `make typecheck-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
  - [ ] `make lint-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
  - [ ] `make test-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
  - [ ] `make build-api API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
  - [ ] Verify public + control migrations apply on fresh DB
  - [ ] `make down API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-outbox-v0`
  - [ ] grep-proof: `grep -r "packages/" api/src/services/outbox/` returns nothing
  - [ ] grep-proof: no `@sentropic/contracts` or `@sentropic/comments` touched
  - [ ] No `packages/**` or `ui/**` touched
