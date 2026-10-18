# Feature: CI optimization Lot 1

## Objective
Cut CI/CD wall-clock under 5 minutes whenever the app is not touched.
Implement Lot 1 exactly as the reviewed plan defines it.

## Scope / Guardrails
- Scope limited to Lot 1: PR concurrency, path-filter repair, smoke placement.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/ci-optimization-lot1`.
- Automated test campaigns run on `ENV=test-ci-opt-lot1`, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Owner verbatim 2026-10-18: « ca va pas du tout la vélocité du ci/cd ».
- Binding owner decisions: « C stric tel quel » and « éviter de restester les llm inutilement ».
- Every affected LLM test still runs complete and blocking.
- Never merge this branch. No secrets. No Python.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/measure-runs.mjs`
  - `scripts/ci/measure-runs.test.mjs`
  - `scripts/ci/concurrency.test.mjs`
  - `scripts/ci/filter-consumers.mjs`
  - `scripts/ci/filter-consumers.test.mjs`
  - `scripts/ci/smoke-placement.test.mjs`
  - `scripts/ci/ci-wiring.test.mjs`
  - `scripts/ci/fixtures/optimization-baseline.json`
  - `scripts/ci/fixtures/consumer-regressions.json`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `packages/*/src/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml`
  - `Makefile`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- `BR90-EX1` (`attention`): harness-grammar alias for plan exception `BR-CI-OPT-EX1` (no branch number on this line; BR-90 is unassigned in `PLAN.md`).
- `BR90-EX2` (`attention`): harness-grammar alias for plan exception `BR-CI-OPT-EX2` (same note).
- `BR-CI-OPT-EX1` (`attention`): `.github/workflows/ci.yml` conditional workflow scope.
  - Reason: Lot 1 needs PR concurrency, repaired filters, smoke dependencies, required gate checks.
  - Impact: PR validation and shared runners affected; publication locks and main/dispatch isolation preserved.
  - Rollback: disable the new policy, run complete required jobs, preserve repaired coverage, restore lint dependency independently.
- `BR-CI-OPT-EX2` (`attention`): `Makefile` default-forbidden path.
  - Reason: additive Docker-based CI wiring tests, replay/metrics targets, scoped selector parameters.
  - Impact: existing target behavior and ENV isolation preserved.
  - Rollback: remove new entry points after workflow consumers are disabled; retain existing test recipes and full-suite behavior.

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
- Rationale: single workflow file edited serially; sub-workstreams share `ci.yml` and cannot run independent CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT checkpoints are listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/ci-optimization-lot1`.
  - Push branch before UAT.
  - No UI changes in Lot 1; CI UAT runs on real PR runs.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Record current main SHA `94a38286eae4dbbff1cde192faa4f332abe60efa`, workflow/Make hashes, required check names, publication locks, image prerequisites.
  - [ ] Read `scripts/ci/publishable-ci-wiring.test.mjs` before extending wiring coverage.
  - [ ] Reconcile workflow/Make/test drift vs study baseline `fb5e92a6ae4928066e181716fdffbfb490b0b4f3`.
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last; `ENV=test-ci-opt-lot1`.
  - [ ] Confirm scope and guardrails; exceptions `BR-CI-OPT-EX1`/`BR-CI-OPT-EX2` declared above.
  - [ ] Baseline facts: `ci.yml` sha256 `86ad863a`, `Makefile` sha256 `a4d325c6`.
  - [ ] Publication locks preserved: `api-image-publication`, `npm-publish-train` (`cancel-in-progress: false`).
  - [ ] Image prerequisites: `api-image` + `api-tool-image` artifacts feed smoke/test jobs.
  - [ ] Required check: `ci-gate` aggregates every PR job; stays unconditional leaf.
  - [ ] No application ports needed: pure script/CI wiring targets only.

- [ ] **Lot 1 — PR concurrency**
  - [ ] Add workflow-level concurrency group `github.workflow`-`pr-N`/`run-ID`, `cancel-in-progress` on `pull_request` only.
  - [ ] Prove side-effect publication/deployment jobs cannot run in the cancellable PR lane.
  - [ ] Add `scripts/ci/concurrency.test.mjs` (same-PR cancel, cross-PR isolation, main/dispatch unique groups, locks preserved, rerun behavior).
  - [ ] Add final-head gate assertions to `scripts/ci/ci-wiring.test.mjs`.
  - [ ] Lot gate:
    - [ ] `make test-ci-optimization SCOPE=scripts/ci/concurrency.test.mjs ENV=test-ci-opt-lot1`
    - [ ] `make test-ci-optimization SCOPE=scripts/ci/ci-wiring.test.mjs ENV=test-ci-opt-lot1`
  - [ ] CI UAT:
    - [ ] Run a PR revision, then a second revision while jobs run; only the first is cancelled; the second yields complete affected results + blocking gate.
    - [ ] Run two different PRs; neither cancels the other; main/dispatch keep locks.

- [ ] **Lot 2 — Measure instrumentation**
  - [x] Add `scripts/ci/measure-runs.mjs`, `scripts/ci/measure-runs.test.mjs`, `scripts/ci/fixtures/optimization-baseline.json`.
  - [x] Add Make targets `ci-optimization-collect`, `ci-optimization-compare`.
  - [x] Lot gate:
    - [x] `make test-ci-optimization SCOPE=scripts/ci/measure-runs.test.mjs ENV=test-ci-opt-lot1`

- [ ] **Lot 3 — Filter repair**
  - [ ] Add `scripts/ci/filter-consumers.mjs`, `scripts/ci/filter-consumers.test.mjs`, `scripts/ci/fixtures/consumer-regressions.json`.
  - [ ] Extend `ci.yml` filters with omitted consumers incl. `mcp-auth` file-dependency propagation into API/AI.
  - [ ] Keep `make check-ci-version-filters`; supplement with consumer regression test.
  - [ ] Add filter-output assertions to `scripts/ci/ci-wiring.test.mjs` (additions/deletions/renames, global/Make changes).
  - [ ] Cover 74 non-fallback / 181 incl. fallback omissions, four LLM cases explicit, beyond PR #675.
  - [ ] API test files created/updated: none. UI test files created/updated: none. E2E test files created/updated: none.
  - [ ] Lot gate:
    - [ ] `make test-ci-optimization SCOPE=scripts/ci/filter-consumers.test.mjs ENV=test-ci-opt-lot1`
    - [ ] `make check-ci-version-filters check-ci-optimization test-ci-optimization ENV=test-ci-opt-lot1`
  - [ ] CI UAT:
    - [ ] Exercise an omitted-consumer fixture (incl. mcp-auth to API to affected AI), plus doc-only and global-change cases; inspect selected jobs + complete LLM evidence.

- [ ] **Lot 4 — Smoke placement and gate hardening**
  - [ ] Remove only `typecheck-lint-api` from `smoke-idp-screens.needs`; retain `changes`, `build-api-image`, `build-api-tool-image`, `security-sast-sca`.
  - [ ] Verify no lint outputs/artifacts are consumed by smoke; retain both as mandatory gate dependencies.
  - [ ] Add `scripts/ci/smoke-placement.test.mjs` (DAG acyclic, overlap, required deps stay, failure blocks green, missing/cancelled blocks green).
  - [ ] Strengthen `ci-gate`: required LLM result absent/skipped/neutral/failed/cancelled cannot satisfy strict green; unaffected jobs skip only with explicit selection reason.
  - [ ] Remove `continue-on-error` on AI suites so affected AI failures block green.
  - [ ] Extend `scripts/ci/publishable-ci-wiring.test.mjs` only if exact assertions need updating; keep publication/provenance/main-only invariants.
  - [ ] Lot gate:
    - [ ] `make test-ci-optimization SCOPE=scripts/ci/smoke-placement.test.mjs ENV=test-ci-opt-lot1`
    - [ ] `make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs ENV=test-ci-opt-lot1`
  - [ ] CI UAT:
    - [ ] Inspect lint/smoke overlap on real runs; image/security predecessors satisfied; lint or smoke failure prevents green; no false green after cancellation/missing/failed AI shard.
    - [ ] Compare failed-lint work before/after plus successful-run delay; record extra smoke work; roll back smoke independently if cost outweighs delay benefit.

- [ ] **Lot 5 — Make targets and final gates**
  - [x] Add Make targets `test-ci-optimization` and `check-ci-optimization` (Node test runner in pinned image, pinned YAML parser, `SCOPE` file paths, fail on empty/missing selection).
  - [ ] Wire tests into a required CI job so CI-only changes cannot bypass them.
  - [ ] Lot gate:
    - [ ] `make check-ci-optimization test-ci-optimization ENV=test-ci-opt-lot1`
    - [ ] `make scope-check ENV=test-ci-opt-lot1`

- [ ] **Lot 6 — Push and DRAFT PR**
  - [ ] Push branch, open DRAFT PR with before/after measurement protocol from the plan as body.
  - [ ] Watch CI, fix branch-caused red jobs, report PR number, head SHA and CI state, then stop.
  - [ ] Never merge.

