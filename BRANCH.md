# Feature: Local scheduler S2 review followups

## Objective
Close carried S2 review items (`S2-5` to `S2-12`) from `.tmp/rv/local-scheduler-s2.md` with regression tests that fail without each fix, and bump `@sentropic/local-scheduler` to `0.2.1` for `enforce-package-bump`.

## Scope / Guardrails
- Scope limited to `packages/local-scheduler/**`, `Makefile` (`BR-LSCH-EX3`), and `package-lock.json` (`BR-LSCH-EX3`).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/cm-release-0270` (`test/local-scheduler-followups`).
- Automated test campaigns run on `ENV=local-scheduler-fu`, never on `ENV=dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/local-scheduler/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`
  - `.github/workflows/**`

## Feedback Loop
- `BR-LSCH-EX3` (`Makefile`, `package-lock.json`):
  - Status: `acknowledge` (explicit S2 followup scope: `S2-6` Makefile Python guard fix + `enforce-package-bump` root lockfile refresh).
  - Reason: `S2-6` fixes the POSIX `set -eu` `! command -v python3` bug in `Makefile:2441` (`test-local-scheduler-systemd-ci`); modifying `packages/local-scheduler/src/**` requires bumping `packages/local-scheduler/package.json` to `0.2.1` and refreshing the `"packages/local-scheduler"` version in `package-lock.json` (`S2-3` parity).
  - Impact: `Makefile` change matches CI `global` path filter (runs full CI matrix); `package-lock.json` is a 1-line version string update (`"0.2.0"` -> `"0.2.1"`). Zero runtime impact on other packages.
  - Rollback: revert the 1-line `Makefile` guard change and revert `"packages/local-scheduler"` version in `package-lock.json`.

## AI Flaky tests
- None expected (deterministic unit and Docker systemd CI tests).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single followup branch)
- [ ] **Multi-branch**
- Rationale: All items belong to one package (`packages/local-scheduler`) and one CI gate cycle.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/rv/local-scheduler-s2.md`, and `.h2a/reviews/pr1080-opus.md`.
  - [x] Create branch `test/local-scheduler-followups` from `origin/main` in `tmp/cm-release-0270`.
  - [x] Confirm `S2-4` already resolved on `origin/main` (`173c98a184`) and `R2-8` closed at S1 merge.
  - [x] Declare `BR-LSCH-EX3` for `Makefile` (`S2-6`) and `package-lock.json` (`0.2.1`).

- [x] **Lot 1 — Probe, calendar & unavailability fixes (`S2-7`, `S2-8`, `S2-9`, `S2-12`)**
  - [x] `S2-8`: map `systemd-analyze` timeout to `SchedulerUnavailableError('timeout')` in `src/systemd/calendar.ts`.
  - [x] `S2-9`: emit actionable `SchedulerUnavailableError` message in `src/systemd/systemctl.ts` and `src/systemd/calendar.ts`.
  - [x] `S2-12`: add internal deps seam on `probeLingerEnabledWith` and unit test for numeric-UID fallback.
  - [x] `S2-7`: spell out `Omit<LocalTaskManifestV1, 'units'>` in `eqRender` in `tests/systemd-probes.spec.ts`.

- [x] **Lot 2 — Adapter parity & unit test gaps (`S2-5` unit cases, `S2-10`)**
  - [x] `S2-10`: align `createFakeSchedulerAdapter.enable` (`src/adapter.ts`) to throw `ManifestCorruptError` on corrupt previous manifest.
  - [x] `S2-5` (unit): test `enable` with failing `hostPidGuard`, `enable`/`uninstall` when unavailable, `status` on missing task, and failed update preserving `manifest.json` `spec.description` in `tests/systemd-adapter.spec.ts`.

- [x] **Lot 3 — Real systemd CI rollback, stop polling & Makefile guard (`S2-5` CI, `S2-6`, `S2-11`)**
  - [x] `S2-6`: fix `Makefile` `test-local-scheduler-systemd-ci` Python guard and add regression check in `tests/fake-adapter-static.spec.ts`.
  - [x] `S2-5` (CI) & `S2-11`: test real `timers.target.wants` symlink removal after real `enable`, real-manager update rollback, and lock-phase polling before `stop` in `tests/fixtures/systemd-ci-suite.mjs`.

- [ ] **Lot N — Version bump & final validation**
  - [ ] Bump `packages/local-scheduler/package.json` to `0.2.1` (`enforce-package-bump`) and refresh `package-lock.json` (`make lock-root ENV=local-scheduler-fu`).
  - [ ] Run Docker gates (`ENV=local-scheduler-fu`): `typecheck-local-scheduler`, `test-local-scheduler`, `build-local-scheduler`, `pack-local-scheduler`, `test-local-scheduler-systemd-ci`, `scope-check`.
  - [ ] Remove `BRANCH.md` in final commit, push, open PR, and watch `gh pr checks` until green.
