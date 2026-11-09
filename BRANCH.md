# Feature: artifacts install progress watchdog

## Objective
Replace the flat 300 s wall clock for the dependency install phase with a progress-based watchdog and add phase observability on the build-only and live paths.

## Scope / Guardrails
- Scope limited to `api/src/services/artifacts/live/**` and `api/tests/unit/artifacts-live/**`.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/fix-install-timeout` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `packages/**/src/**` (version bump per Package Publication rule if touched)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] BRLOCK-EX1 retained verbatim in Scope / Guardrails (policy reference intact)

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
- Rationale: single orthogonal api-only fix, no app-specific code, one test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/fix-install-timeout`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`/home/antoinefa/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/fix-install-timeout` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create isolated worktree `tmp/worktrees/fix-install-timeout` on branch `fix/artifacts-install-progress-watchdog` from `origin/main` (verified `f69bc2a03`).
  - [x] Capture Makefile targets for debug/testing (`make test-api-unit`, `make typecheck-api`, `make lint-api`).
  - [x] Define environment mapping: `ENV=test-fix-install-timeout`, `API_PORT=8921`, `UI_PORT=5321`, `MAILDEV_UI_PORT=1221`.
  - [x] Confirm command style: `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make ... ENV=test-fix-install-timeout` with `ENV` last, foreground only.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.

- [ ] **Lot 1 — Observability: phase start/end/duration + failing phase name**
  - [x] Add phase runner helper logging `artifact_live_phase` with fields `key` hash, `phase`, `ms`, `outcome`, `reason`, no secret.
  - [x] Wire it on build-only phases (`install`, `prepare`, `build`, `verify`) and live paths (`prepare-live`, `project`, `idle`).
  - [x] Failing phase persists in job reason (e.g. `phase_timeout:install`) via existing `jobs.fail` / `stateDetail`.
  - [x] Lot gate:
    - [x] `make typecheck-api` + `make lint-api` (both green 2026-11-09; lint shows only pre-existing `no-console` warnings outside `live/`)
    - [x] **API tests**
      - [x] New `api/tests/unit/artifacts-live/deadline.test.ts` (phase log fields, no secret in logs)
      - [x] Scoped runs while evolving: `make test-api-unit SCOPE="tests/unit/artifacts-live/deadline.test.ts tests/unit/artifacts-live/cache.test.ts" ENV=test-fix-install-timeout` (27/27 green, no unhandled errors)
      - [x] Sub-lot gate: `make test-api ENV=test-fix-install-timeout` (deferred to CI per owner OPTIM rule: lanes run scoped tests, full suites run in CI)
      - [x] AI flaky tests run (non-blocking only under acceptance rule): deferred to CI (`make test-api-ai` needs model access; change touches no AI path)
    - [ ] **UI tests (TypeScript only)**
      - [ ] None (api-only change, no UI surface)
    - [ ] **E2E tests**
      - [ ] None (api-only change, no user flow change)

- [ ] **Lot 2 — Progress watchdog for the install phase**
  - [x] Replace flat 300 s wall clock for install with stall watchdog (no progress for N s, e.g. 60 s) + absolute ceiling sized for ~1500 packages / ~1 GB cold cache at measured relay rate (justify, e.g. 20 min), env-configurable with safe default.
  - [x] Thread install progress (tarball streamed / bytes) from fetch + cleanInstall + sink into the watchdog.
  - [x] Keep other phase bounds unchanged (install alone streams ~1 GB over the relay with no api-visible progress signal; prebundle/dev/build/verify are pod-local and keep their 300 s recipe + phase bounds).
  - [x] Update `runStaleMs` for the longer install bound.
  - [x] Verify cache written after successful cold install and cut install poisons nothing.
  - [ ] Explain first-81 s serial chain (file:line) in the final report; remove avoidable waits only if trivial.
  - [x] Lot gate: same API checklist as Lot 1 plus `cache.test.ts` watchdog cases (progress alive, stall, ceiling, reason carries phase, no poison).

- [ ] **Lot 3 — Independent review findings (Wonder dedup, REQUEST_CHANGES)**
  - [x] B1: stall arms only on the first progress report (no cut of the 120-600 s pre-progress windows); progress per sent put frame and drained page.
  - [x] M1: watchdog abort propagates to fetch, queue wait and supervisor frames; cut install stops and never admits.
  - [x] M2: start log carries `reason: 'started'`; bare `phase_timeout` rewritten to `phase_timeout:<phase>`; idle `verify` wrapped in `runPhase`.
  - [x] MINORs: env bounds clamped to 2^31-1; ceiling comment reconciled with recipe/stream inner bounds; post-settle reports ignored; timing margins widened.
  - [x] Tests: slow-start cold install not cut early; stall/ceiling/abort cases; signal threading; per-frame progress; queue abort.
  - [ ] Explain first-81 s serial chain (file:line) in the final report; remove avoidable waits only if trivial.
  - [x] Lot gate: `make typecheck-api` + `make lint-api` + scoped `test-api-unit` (deadline, cache, supervisor-install, heavy).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md` → Package Publication.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
