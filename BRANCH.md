# Feature: CI - Reduce time (multiworkers + split E2E)

## Objective
Reduce CI time by enabling API multiworkers and splitting E2E tests into two parallel groups.

## Scope / Guardrails
- Scope limited to CI/test configuration (Make targets, CI workflow, test runner config).
- One migration max in `api/drizzle/*.sql` (not expected).
- Make-only workflow, no direct Docker commands.
- All new text in English.

## Scoping Decisions
- **API workers**: Use a `WORKERS` variable in the Makefile (same pattern as E2E target), default to 4.
- **E2E split**: Group A (00–03, 14 files) / Group B (04–07, 16 files). Confirmed by reviewing CI times (~8 min bottleneck).
- **CI strategy**: Use GitHub Actions matrix strategy for E2E groups.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- Rationale: Grouped into a single CI-focused branch to keep waves at four branches.

## UAT Management (in orchestration context)
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read the relevant `.mdc` files and `README.md`.
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Confirm scope and guardrails.
  - [x] Scoping decisions confirmed by user.

- [x] **Lot 1 — Enable API multiworkers**
  - [x] Update `api/vitest.config.ts`: remove `singleFork: true`, enable multiple workers.
  - [x] Add `API_TEST_WORKERS` variable to Makefile test-api targets (default 4), following the E2E WORKERS pattern.
  - [x] Pass workers setting to vitest via env or CLI.
  - [ ] Lot gate: `make typecheck-api` + `make lint-api`

- [x] **Lot 2 — Split E2E into 2 parallel groups (matrix strategy)**
  - [x] Update `.github/workflows/ci.yml`: replace single `test-e2e` job with matrix strategy (group-a: 00-03, group-b: 04-07).
  - [x] Ensure both matrix jobs run in parallel after dependencies.
  - [x] Test that each group runs independently.
  - [ ] Lot gate: CI passes with both groups

- [ ] **Lot N — Final validation**
  - [ ] Sub-lot gate: `make test-api`
  - [ ] Sub-lot gate: `make test-ui`
  - [ ] Prepare E2E build: `make build-api build-ui-image`
  - [ ] Sub-lot gate: `make clean test-e2e`
  - [ ] Final gate: Create PR with BRANCH.md content & verify CI
  - [ ] Final commit removes `BRANCH.md` and checks `TODO.md`
