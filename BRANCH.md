# Feature: Local Scheduled Tasks Lot S1 (@sentropic/local-scheduler)

## Objective
Implement Lot S1 of `spec/SPEC_EVOL_LOCAL_SCHEDULED_TASKS.md`: core `@sentropic/local-scheduler` package, fail-closed lock, runner, unit generator, fake adapter, Docker Make targets, and root lockfile registration.

## Scope / Guardrails
- Scope limited to `packages/local-scheduler/**`, `Makefile` targets (`typecheck-local-scheduler`, `test-local-scheduler`, `build-local-scheduler`), and root `package-lock.json` under `BR-LSCH-EX1a`.
- Make-only and Docker-first (`ENV=local-scheduler-s1` passed last).
- Zero Python, zero network, zero secrets, no systemd adapter (`Lot S2`).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/local-scheduler/**`
  - `BRANCH.md`
  - `Makefile`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/*-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`

## Feedback Loop
- [ ] **BR-LSCH-EX1a** (`Makefile`, `package-lock.json`) — Rationale: add Docker-first `typecheck-local-scheduler`, `test-local-scheduler`, `build-local-scheduler` targets (mirroring `@sentropic/harness`, `Makefile:2353-2406`) and register `@sentropic/local-scheduler` in root `package-lock.json` via `make lock-root` (`Makefile:614`) so Lot S1 executes its own Make-only gate without touching forbidden paths. Impact: editing `Makefile` matches the CI `global` path filter; adding `packages/local-scheduler/package.json` and its root lock entry changes the API tool-deps key, triggering one `sentropic-api-tool-deps` image rebuild; runtime behavior of existing packages and API/UI/E2E lanes is unchanged. Rollback: revert the additive `Makefile` block and re-run `make lock-root` after removing `packages/local-scheduler`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single cohesive package Lot S1 in `tmp/cm-release-0270` (`feat/local-scheduler-s1`).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `spec/SPEC_EVOL_LOCAL_SCHEDULED_TASKS.md`.
  - [x] Verify branch `feat/local-scheduler-s1` in `tmp/cm-release-0270` from `origin/main` and disk space >= 45 GB.
  - [x] Declare `BR-LSCH-EX1a` for `Makefile` and `package-lock.json`.

- [x] **Lot 1 — Package scaffold, errors, contract, state/env/pid modules**
  - [x] Add `package.json`, `tsconfig.json`, `LICENSE`, `README.md`, `src/errors.ts`.
  - [x] Add `src/contract.ts` (types, validation, secret/loader/allowlist/shebang checks).
  - [x] Add `src/state-dir.ts`, `src/host-pid-guard.ts`, `src/env-file.ts`.

- [x] **Lot 2 — Witness, health evaluator, fail-closed lock, rotator, unit generator**
  - [x] Add `src/witness.ts` and pure `src/health.ts`.
  - [x] Add `src/lock.ts` (namespace-aware fail-closed lock and reclaim protocol).
  - [ ] Add `src/log-rotator.ts` and `src/systemd/unit-generator.ts`.

- [ ] **Lot 3 — Runner, fake adapter, entrypoint, tests**
  - [ ] Add `src/runner.ts`, `src/adapter.ts`, `src/index.ts`.
  - [ ] Add unit, lock, runner, unit-generator, health, static, and fake-adapter tests in `tests/`.

- [ ] **Lot 4 — Makefile targets, root lockfile & final verification**
  - [ ] Add `typecheck-local-scheduler`, `test-local-scheduler`, `build-local-scheduler` in `Makefile`.
  - [ ] Update root `package-lock.json` via `make lock-root ENV=local-scheduler-s1`.
  - [ ] Run `make typecheck-local-scheduler`, `make test-local-scheduler`, `make build-local-scheduler`, `make scope-check` with `ENV=local-scheduler-s1`.
  - [ ] Push, open PR, remove `BRANCH.md` before final review, watch CI checks.
