# Feature: Local Scheduled Tasks Lot S1 (@sentropic/local-scheduler)

## Objective
Implement Lot S1 of `spec/SPEC_EVOL_LOCAL_SCHEDULED_TASKS.md`: core `@sentropic/local-scheduler` package, fail-closed lock, runner, unit generator, fake adapter, Docker Make targets, and root lockfile registration.

## Scope / Guardrails
- Scope limited to `packages/local-scheduler/**`, `Makefile` targets (`typecheck-local-scheduler`, `test-local-scheduler`, `build-local-scheduler`, `pack-local-scheduler`), root `package-lock.json`, and minimal CI pack-lane registration (`scripts/ci/consumer-boundaries.json`, `scripts/ci/publishable-manifests.mjs`, `.github/workflows/ci.yml`, `scripts/ci/consumer-contracts.test.mjs`, `scripts/ci/ci-expected-results.test.mjs`) under `BR-LSCH-EX1a'`.
- Make-only and Docker-first (`ENV=local-scheduler-s1` passed last).
- Zero Python, zero network, zero secrets, no systemd adapter or publish targets (`Lot S2`).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/local-scheduler/**`
  - `BRANCH.md`
  - `Makefile`
  - `package-lock.json`
  - `scripts/ci/consumer-boundaries.json`
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/consumer-contracts.test.mjs`
  - `scripts/ci/ci-expected-results.test.mjs`
  - `.github/workflows/ci.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/*-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`

## Feedback Loop
- [x] **BR-LSCH-EX1a** (`Makefile`, `package-lock.json`) — Rationale: add Docker-first `typecheck-local-scheduler`, `test-local-scheduler`, `build-local-scheduler` targets (mirroring `@sentropic/harness`, `Makefile:2353-2406`) and register `@sentropic/local-scheduler` in root `package-lock.json` via `make lock-root` (`Makefile:614`) so Lot S1 executes its own Make-only gate without touching forbidden paths. Impact: editing `Makefile` matches the CI `global` path filter; adding `packages/local-scheduler/package.json` and its root lock entry changes the API tool-deps key, triggering one `sentropic-api-tool-deps` image rebuild; runtime behavior of existing packages and API/UI/E2E lanes is unchanged. Rollback: revert the additive `Makefile` block and re-run `make lock-root` after removing `packages/local-scheduler`.
- [x] **BR-LSCH-EX1a'** (`Makefile` `pack-local-scheduler`, `scripts/ci/consumer-boundaries.json`, `scripts/ci/publishable-manifests.mjs` `PACK_TARGETS`, `.github/workflows/ci.yml` `validate-local-scheduler`, `scripts/ci/consumer-contracts.test.mjs`, `scripts/ci/ci-expected-results.test.mjs`) — Rationale: `origin/main` CI enforces `enforce-package-bump` (requiring a `consumer-boundaries.json` entry for every changed package), `validate-publishable-manifests` (requiring a `PACK_TARGETS` entry and `make pack-<slug>` lane for any changed public package), `publishable-ci-wiring.test.mjs` (requiring a `validate-<slug>` job in `ci.yml` wired into `ci-gate` for every `PACK_TARGETS` entry), and `consumer-contracts.test.mjs` / `ci-expected-results.test.mjs` (asserting exact component and validator counts). Widens `BR-LSCH-EX1a` strictly to these CI pack-lane registration items per conductor decision (25/11 22:30), leaving publish targets, `STEADY_STATE_PUBLISHERS`, `BOOTSTRAP_TARGETS`, `SystemdUserAdapter`, and `Dockerfile.systemd-ci` in Lot S2. Impact: adds one independent `validate-local-scheduler` CI job running `typecheck`/`test`/`build`/`pack` on `packages/local-scheduler/**` or `global` changes; zero runtime or npm-publish impact. Rollback: revert the `consumer-boundaries.json`, `publishable-manifests.mjs` (`PACK_TARGETS`), `Makefile` (`pack-local-scheduler`), `.github/workflows/ci.yml` (`local_scheduler` filter/`validate-local-scheduler`), and CI test count updates.

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
  - [x] Add `src/log-rotator.ts` and `src/systemd/unit-generator.ts`.

- [x] **Lot 3 — Runner, fake adapter, entrypoint, tests**
  - [x] Add `src/runner.ts`, `src/adapter.ts`, `src/index.ts`.
  - [x] Add unit, lock, runner, unit-generator, health, static, and fake-adapter tests in `tests/`.

- [ ] **Lot 4 — Makefile targets, root lockfile & final verification**
  - [x] Add `typecheck-local-scheduler`, `test-local-scheduler`, `build-local-scheduler` in `Makefile`.
  - [x] Update root `package-lock.json` via `make lock-root ENV=local-scheduler-s1`.
  - [x] Run `make typecheck-local-scheduler`, `make test-local-scheduler`, `make build-local-scheduler`, `make scope-check` with `ENV=local-scheduler-s1`.
  - [ ] Push, open PR, keep `BRANCH.md` until pre-merge cleanup, watch CI checks.

- [ ] **Lot 5 — r2 CI registration (`BR-LSCH-EX1a'`) & full test suite coverage**
  - [x] Register `local-scheduler` in `scripts/ci/consumer-boundaries.json`, `scripts/ci/publishable-manifests.mjs` (`PACK_TARGETS`), and update CI count assertions in `scripts/ci/consumer-contracts.test.mjs` and `scripts/ci/ci-expected-results.test.mjs`.
  - [x] Add `pack-local-scheduler` in `Makefile` and `validate-local-scheduler` CI pack lane in `.github/workflows/ci.yml`.
  - [x] Expand `tests/contract.spec.ts` (errors, spec bounds, allowlist/shebang/symlinks, `assertHostPidNamespace`).
  - [x] Expand `tests/unit-generator.spec.ts` (control/glob/quote/backslash/`$`/`$$` escaping, non-Node runner, timer/resources).
  - [x] Add `tests/env-witness.spec.ts` (env-file rejections, kill-switch truth table, stateDir resolution, witness atomicity & closed v1 validation, `skips.jsonl` `O_APPEND`).
  - [x] Expand `tests/health-env.spec.ts` (every `evaluateTaskHealth` verdict, pause ok/warning, skew, re-enable, all hints).
  - [ ] Expand `tests/lock.spec.ts` (all fail-closed cases, namespace mismatch, reclaim guard, quarantine mismatch abort, release ownership, fs magics).
  - [ ] Expand `tests/runner.spec.ts` (never-rejects public API, step-1 file-mode/`stateDir` parity, step-5 refusal, `consecutiveFailures`, child env sanitization).
  - [ ] Expand `tests/runner-signals.spec.ts` and `tests/fake-adapter-static.spec.ts` (`SIGINT`, process-group timeout, step-8 `skips.jsonl` rotation, fake adapter idempotency/uninstall, static exports/guards).
  - [ ] Re-run Docker exit gates (`typecheck`, `test`, `build`, `scope-check`) + CI guard suites, push, update PR #1079 body, watch `gh pr checks 1079 --watch` until green.
