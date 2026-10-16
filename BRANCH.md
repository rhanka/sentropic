# Feature: Raise registry visibility retry budget (train lock + publish waits)

## Objective
Raise every registry visibility retry budget on the release-train path from 18 x 10 s (~3 min) to 36 x 10 s (~6 min), with a maintained assertion of the configured budget, so npm CDN propagation delays like run 38933799163 can no longer turn main red.

## Scope / Guardrails
- Scope limited to retry-budget defaults and their tests.
- One migration max in `api/drizzle/*.sql` (N/A, no DB change).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/main-lock-fix`.
- Automated test campaigns must run on dedicated environments (`ENV=test-main-lock-fix`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/tests/packaging/check-lock-integrity.mjs`
  - `packages/cluster-mesh/tests/packaging/lock-integrity-registry.spec.ts`
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/publishable-manifests.test.mjs`
  - `scripts/ci/publishable-pack.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `BRANCH.md`
  - `.h2a/build/main_lock_fix_report.md` (untracked report, already written)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BR-MLF-EX1: two `?=` budget defaults only, see Feedback Loop)
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `attention` BR-MLF-EX1 (Makefile budget defaults): reason — effective publish/qualify waits are Makefile `?=` defaults (`LLM_MESH_REGISTRY_WAIT_ATTEMPTS`, `QUALIFY_WAIT_ATTEMPTS`); script defaults alone do not change CI behavior; precedent tag `BRCIW-EX1` already marks these lines; impact — longer waits only, success path unchanged (breaks early on first visible lookup); rollback — revert two lines.
- `acknowledge` Root cause of run 38933799163: timing only (npm propagation > 3.5 min vs 18 x 10 s budget), evidenced in `.h2a/build/main_lock_fix_report.md`; attempt-3 re-run green.
- `attention` Scope-check (`make scope-check`) reports advisory `FAIL C2` on `Makefile` (conditional path): harness exception grammar requires `BR\d+[a-z]?-EX\d+`, which this unnumbered hotfix branch cannot mint without misattribution; `BR-MLF-EX1` is declared above with reason/impact/rollback. Check is advisory-only (D5 Layer A), never blocking; proceeding.

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
- Rationale: Single small CI-plumbing change, one branch, one PR.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/main-lock-fix`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/main-lock-fix` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`.
  - [x] Confirm isolated worktree `tmp/worktrees/main-lock-fix` on branch `fix/main-train-lock-integrity` at `db314a67f` (= origin/main).
  - [x] Diagnose run 38933799163 attempts 1+2 with evidence (timing, not fixture defect); re-run failed jobs to green (attempt 3 `success`).
  - [x] Map every registry-visibility budget knob (`check-lock-integrity.mjs`, `publishable-manifests.mjs`, Makefile x2) and every literal-18 test assertion.
  - [x] Define environment mapping (`ENV=test-main-lock-fix`, `API_PORT=9575`, `UI_PORT=5775`, `MAILDEV_UI_PORT=1675`).
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BR-MLF-EX1` for Makefile budget defaults.

- [ ] **Lot 1 — Raise budgets with budget assertions**
  - [x] `packages/cluster-mesh/tests/packaging/check-lock-integrity.mjs`: default retries 18 -> 36, add `budget` subcommand printing `{ attempts, delayMs }`, update usage.
  - [x] `packages/cluster-mesh/tests/packaging/lock-integrity-registry.spec.ts`: assert via `budget` that configured total wait is >= 360 s.
  - [x] `scripts/ci/publishable-manifests.mjs`: `REGISTRY_WAIT` attempts 18 -> 36.
  - [x] `scripts/ci/publishable-manifests.test.mjs`: assert `REGISTRY_WAIT`/`waitBudget()` default total >= 360 s.
  - [x] `scripts/ci/publishable-pack.test.mjs`: update `waitBudget()` default expectation to `{ attempts: 36, delaySeconds: 10 }`.
  - [x] `Makefile` (BR-MLF-EX1): `QUALIFY_WAIT_ATTEMPTS` 18 -> 36, `LLM_MESH_REGISTRY_WAIT_ATTEMPTS` 18 -> 36, refresh budget comments.
  - [x] `scripts/ci/publishable-ci-wiring.test.mjs`: update literal-18 Makefile assertions and test names to 36 x 10 s.
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-main-lock-fix` (advisory FAIL C2 on Makefile, covered by BR-MLF-EX1, see Feedback Loop)
    - [x] **API tests**
      - [x] N/A (no API change)
    - [x] **UI tests (TypeScript only)**
      - [x] N/A (no UI change)
    - [x] **Packaging/CI-guard tests**
      - [x] `packages/cluster-mesh/tests/packaging/lock-integrity.spec.ts` 3/3, `lock-integrity-registry.spec.ts` 5/5 (incl. new budget-floor test)
      - [x] `make test-publishable-manifests ENV=test-main-lock-fix`: 86/86 (incl. updated 36 x 10 s assertions)
      - [x] `make typecheck-cluster-mesh ENV=test-main-lock-fix`: pass
      - [x] No timeout inflation in tests (budget subcommand returns instantly; registry spec keeps 4-retry/10 ms overrides)
      - [x] Infra flakes retried to green, unrelated to change: npm ETIMEDOUT in `build-auth-hono` prereq, one install SIGTERM (Error 143)
    - [ ] **E2E tests**
      - [ ] N/A (no user-facing behavior change)
    - [ ] UAT checkpoints: N/A (CI plumbing only, no UI/API surface)

- [ ] **Lot N-2 UAT**
  - [ ] Web app: N/A (no user-visible surface)
  - [ ] Chrome plugin: N/A
  - [ ] VScode plugin: N/A

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] N/A (no spec change; budget comments updated inline in Makefile)

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (scoped to touched TS specs if a lane exists)
  - [ ] Retest packaging/CI-guard suites (cf Lot 1)
  - [ ] No `packages/*/src/**` change: no version bump required (`enforce-package-bump` unaffected)
  - [ ] Commits stay <= 150 lines each (`git add` selective, `make commit`, never `git add .`)
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Never merge (conductor merges).
