# Feature: Schedule the reservation reaper

## Objective
- [ ] Schedule crash recovery for expired gateway holds in the API and standalone host.
- [ ] Prove concurrent schedulers cannot duplicate settlement or budget charges.

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
- [ ] BRRS-B1 | blocked | Owner: conductor | Host database wiring requires an additional approved path: `apps/llm-gateway/src/app.ts`. `createLedgerDependencies` captures the injected database; `HostApp` exposes only app/readiness/admission/pending, and `startHost` cannot access that database. Proposed bounded change: expose a sweep callback bound to the same injected ledger database on the composed host, consumed by lifecycle. Acceptance: host boot and periodic sweeps use that exact store, stop at shutdown, and never overlap. Verify with lifecycle tests and real Postgres races. Rollback: remove callback and lifecycle wiring together. No additional path edited.
- [x] BRRS-A1 | attention | Owner: implementation | Use existing product partition configuration as scheduling eligibility; preserve cutover ownership and never activate `/gw` from the scheduler.
- [x] BRRS-A2 | attention | Owner: implementation | Released never-dispatched holds create no cost row under the existing contract; assert zero rows for released requests and exactly one row for reconciled requests.
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
- [ ] **Lot 1 — API scheduler**
  - [ ] Add counts-only sweep wrapper and boot/periodic scheduling with enable, interval and limit configuration.
  - [ ] Add `api/tests/unit/reservation-reaper-schedule.test.ts` for defaults, disable, failures and overlap prevention.
- [ ] **Lot 2 — Host scheduler**
  - [ ] Resolve BRRS-B1 before implementation.
  - [ ] Configure and bind boot/periodic sweeps to the host ledger with shutdown cancellation and no overlap.
  - [ ] Add `apps/llm-gateway/tests/lifecycle-reaper.test.ts` for configuration, boot, periodic execution and SIGTERM.
- [ ] **Lot 3 — Accounting proof and documentation**
  - [ ] Extend `api/tests/api/llm-budget-ledger.test.ts` with two concurrent reapers; assert terminal states, exact budget deltas and ledger cardinality.
  - [ ] Update spec section 12.8 only after scheduling is implemented and verified.
- [ ] **Lot 4 — Final validation**
  - [ ] Run targeted API and host tests.
  - [ ] Run `make typecheck-api lint-api`.
  - [ ] Run full `make test-api-unit test-api-endpoints` and `make test-llm-gateway-process`.
  - [ ] Run `make scope-check` before each commit; update this plan in each commit.
  - [ ] Run `make down`; report exact commands, counts and final commit log.
