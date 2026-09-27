# Feature: Schedule the reservation reaper

## Objective
- [x] Schedule crash recovery for expired gateway holds in the API and standalone host.
- [x] Prove concurrent schedulers cannot duplicate settlement or budget charges.

## Scope / Guardrails
- [x] Worktree: `tmp/llm-reaper-schedule`; branch: `feat/llm-reaper-schedule`.
- [x] `harness check branch` passed; `origin/main` is an ancestor; initial working tree clean.
- [x] Make-only, Docker-first; no migrations, package edits, push, PR, merge or publication.
- [x] All make commands end with `ENV=test-llm-reaper-schedule`.
- [x] Ports: `API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582`.
- [x] Selective staging; commits under 150 lines through `make commit`; no attribution.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `api/src/index.ts`
  - `api/src/services/llm-metering/reservation-reaper.ts`
  - `apps/llm-gateway/src/lifecycle.ts`
  - `apps/llm-gateway/src/config.ts`
  - `apps/llm-gateway/src/app.ts`
  - `api/tests/unit/reservation-reaper-schedule.test.ts`
  - `apps/llm-gateway/tests/lifecycle-reaper.test.ts`
  - `api/tests/api/llm-budget-ledger.test.ts`
  - `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md`
  - `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*`
  - `packages/**`
  - `api/drizzle/**`
  - `.github/workflows/**`
  - All paths not explicitly allowed above.
- [x] **Conditional Paths (allowed only with explicit exception)**: none approved beyond the conductor's list.
- [x] **Exception process**: record scope blockers before editing any additional path.

## Feedback Loop
- [x] BRRS-B1 | resolved | Owner: conductor | Approved minimal `apps/llm-gateway/src/app.ts` extension: expose a reaper bound to the same injected ledger database and consume it in lifecycle. Rollback: remove handle and lifecycle wiring together.
- [x] BRRS-A1 | attention | Owner: implementation | Use existing product partition configuration as scheduling eligibility; preserve cutover ownership and never activate `/gw` from the scheduler.
- [x] BRRS-A2 | attention | Owner: implementation | Released never-dispatched holds create no cost row under the existing contract; assert zero rows for released requests and exactly one row for reconciled requests.
- [x] BRRS-A3 | attention | Owner: implementation | Preserve the API's default signal termination; synchronous exit cleanup fences the scheduler. The host uses its existing bounded SIGTERM drain and awaits an active sweep there.
- [ ] BRRS-B2 | blocked | Owner: conductor | Host tests: 76 passed, 1 failed at `apps/llm-gateway/tests/autonomy.test.ts:103`; its explicit product-adapter allowlist rejects the newly authorized reservation-reaper import. Required scope extension: this test file only, adding `llm-metering/reservation-reaper` to `allowed` and `reservation-reaper` to the adapter value-import checks. This retains and extends the no-product-globals boundary assertion; no runtime change. Acceptance: all 77 host tests pass. Rollback: revert both test-list additions. File remains untouched pending approval.
- [x] Blocked handoff checks: `make scope-check API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule` passed C2; `make down API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule` passed. No runtime tests run; implementation stopped at the explicit scope boundary.

## AI Flaky tests
- [x] No AI-dependent tests or flaky acceptance planned.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single implementation agent; no integration or cherry-pick needed.

## UAT Management (in orchestration context)
- [x] No UI, Chrome or VSCode surface changes; automated lifecycle and accounting checks cover this task.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read required rules, template, harness method, repository context and relevant implementation.
  - [x] Verify branch mechanically and inspect activation, lifecycle and ledger boundaries.
  - [x] Record real Postgres test file in approved scope.
  - [x] Discover host target: `make test-llm-gateway-process`.
- [x] **Lot 1 — API scheduler**
  - [x] Add counts-only sweep wrapper and boot/periodic scheduling with enable, interval and limit configuration.
  - [x] Add `api/tests/unit/reservation-reaper-schedule.test.ts` for defaults, disable, failures and overlap prevention.
- [x] **Lot 2 — Host scheduler**
  - [x] Resolve BRRS-B1 before implementation.
  - [x] Configure and bind boot/periodic sweeps to the host ledger with shutdown cancellation and no overlap.
  - [x] Add `apps/llm-gateway/tests/lifecycle-reaper.test.ts` for configuration, boot, periodic execution and SIGTERM.
- [x] **Lot 3 — Accounting proof and documentation**
  - [x] Extend `api/tests/api/llm-budget-ledger.test.ts` with two concurrent reapers; assert terminal states, exact budget deltas and ledger cardinality, preserving a live reserve across two budget buckets.
  - [x] Update spec section 12.8 after focused scheduler (12), host lifecycle (5), and real Postgres ledger (37) tests pass.
- [ ] **Lot 4 — Final validation**
  - [x] Run targeted API and host tests: 12 scheduler tests, 5 lifecycle tests, 37 ledger tests passed.
  - [x] Run `make typecheck-api lint-api`; host typecheck and lint also passed.
  - [x] Run full API suites: 1,019 unit tests passed, 2 skipped; 974 endpoint tests passed.
  - [ ] Pass full host suite: 76 passed, 1 failed (BRRS-B2); all 5 new host lifecycle tests passed.
  - [x] Run `make scope-check` before each commit; update this plan in each commit.
  - [x] Run `make down`; `make ps` confirms no remaining services; record commands and counts for handoff.

## Validation Evidence
- [x] PASS: `make typecheck-api lint-api REGISTRY=local API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule`.
- [ ] FAIL (BRRS-B2 only): `make up-api-test typecheck-llm-gateway-process lint-llm-gateway-process test-llm-gateway-process REGISTRY=local API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule`; startup, host typecheck and lint passed; host tests 76 passed / 1 failed across 7 files.
- [x] PASS (12 tests): `make test-api-unit SCOPE=tests/unit/reservation-reaper-schedule.test.ts REGISTRY=local API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule`.
- [x] PASS (37 tests, real Postgres): `make test-api-endpoints SCOPE=tests/api/llm-budget-ledger.test.ts REGISTRY=local API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule`.
- [x] PASS (unit: 114 files, 1,019 passed / 2 skipped; endpoints: 120 files, 974 passed): `make test-api-unit test-api-endpoints REGISTRY=local API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule`.
- [x] PASS C2: `make scope-check API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule`.
- [x] PASS (healthy responses in inspected tail): `make logs-api TAIL=30 REGISTRY=local API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule`.
- [x] PASS: `make down REGISTRY=local API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule`.
- [x] PASS (empty): `make ps REGISTRY=local API_PORT=9482 UI_PORT=5682 MAILDEV_UI_PORT=1582 ENV=test-llm-reaper-schedule`.
