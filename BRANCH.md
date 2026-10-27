# Feature: BR-77 — Bound CI execution capacity and qualify contention/rollback

## Objective
- [ ] Enforce finite execution capacity and qualify contention/rollback on measured receipts.
- [ ] Branch `chore/ci-capacity-policy`, step 2 of nine; train order BR-76 → BR-77; dependency: BR-76 (PR #705, metrics + expected-results) merged.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md` and `spec/ci-cd-ten-minutes/capacity.md`; BR-76 receipts are inputs, not deliverables.
- [ ] Work in `tmp/worktrees/ci-capacity-policy`; rebase on main after BR-76 merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-ci-capacity` or `ENV=test-ci-capacity`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9385, UI_PORT=5585, MAILDEV_UI_PORT=1485; verify availability before starting services and pass all three ports to service commands.
- [ ] The agent inventories quotas and costs itself via the GitHub API (account/plan, billing usage with `user` scope, runner inventory); no owner-supplied inventory is assumed.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/71-BRANCH_chore-ci-capacity-policy.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `scripts/ci/ci-run-metrics.mjs`
  - [ ] `scripts/ci/ci-run-metrics.test.mjs`
  - [ ] `scripts/ci/ci-expected-results.mjs`
  - [ ] `scripts/ci/ci-expected-results.test.mjs`
  - [ ] `spec/ci-cd-ten-minutes/capacity.md`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR77-EX1; `Makefile` under BR77-EX2.
  - [ ] `scripts/ci/publishable-ci-wiring.test.mjs` under BR77-EX3.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [x] BR77-EX1 — Workflow exception: bound shared runner concurrency, independent package validation/publication, branch dry-run publication qualification, keep PR-only cancellation. Impact: dispatch and required results. Rollback: revert workflow policy while preserving complete-result checks.
- [x] Review r2 owner instruction: replace repo-wide slot mutexes with per-run matrix widths and PR cancellation; measure hosted-runner scheduling. Static demand no longer claims account admission. API quality remains required at the gate and image publishers.
- [x] BR77-EX2 — Makefile exception: capacity-policy entry points only. Impact: named CI measurement/policy entry points only. Rollback: restore the previous recipes and rerun their qualification.
- [x] BR77-EX2 includes the requested dry-run publication target: real existing guarded packs, per-package receipts, no registry writes; rollback removes the target and dispatch mode.
- [x] BR77-EX3 — Permit `scripts/ci/publishable-ci-wiring.test.mjs` to assert the explicit branch dry-run alternative while preserving all production publication barriers. Rollback: restore assertions with the workflow.
- [x] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.
- [ ] Inherited open acceptance from BR-76/Round-4: account quota/reservation/cost inventory; bounded dispatch policy; concurrent PR/current-main delivery; rollback drill; classification ≤15s, verdict ≤5s, aggregate scheduling ≤60s under declared concurrent traffic.

## AI Flaky tests
- [ ] Deterministic checks are blocking. Any retained live-provider exception needs non-systematic same-commit/same-command success, failure signature, impact analysis, and explicit owner sign-off; never increase timeouts.

## Orchestration Mode (AI-selected)
- [ ] **Multi-branch** — This is one independently reviewed/qualified branch of the serialized nine-branch train.
- [ ] Rationale: preserve branch-level rollback and serialize shared workflow/Makefile edits; internal CI lanes may run concurrently.

## UAT Management (in orchestration context)
- [ ] Run the lot UAT on the exact pushed qualification SHA; record immutable source/target SHAs for any integrated qualification workspace.
- [ ] Use isolated automated environments; web/Chrome/VSCode UAT below is limited to affected behavior; no root-dev automated testing.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, relevant security/domain rules, `README.md`, `TODO.md`, the execution `PLAN.md`, the study, `spec/ci-cd-ten-minutes/capacity.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Verify branch mechanically with harness; confirm BR-76 merged; inventory the actual files and existing assertions at the new base.
  - [x] Declare exceptions above; names marked new below are deliverables to create, not existing commands or evidence.
  - [x] Base origin/main 440599d04e91bb33e3874588f067c6a90bffd1b3; harness C1 passed; inherited suites passed 45/45. BR77 uses ENV=test-ci-capacity per owner packet.
