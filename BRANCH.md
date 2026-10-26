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

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] BR77-EX1 — Planned workflow exception: cap/stagger package fan-out on measured slots, serialize main releases, keep PR-only cancellation. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR77-EX2 — Planned Makefile exception: capacity-policy entry points only. Impact: named CI measurement/policy entry points only. Rollback: restore the previous recipes and rerun their qualification.
- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.
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
- [ ] **Lot 0 — Baseline and constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, relevant security/domain rules, `README.md`, `TODO.md`, the execution `PLAN.md`, the study, `spec/ci-cd-ten-minutes/capacity.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [ ] Verify branch mechanically with harness; confirm BR-76 merged; inventory the actual files and existing assertions at the new base.
  - [ ] Declare exceptions above; names marked new below are deliverables to create, not existing commands or evidence.
  - [x] Base origin/main 440599d04e91bb33e3874588f067c6a90bffd1b3; harness C1 passed; inherited suites passed 45/45. BR77 uses ENV=test-ci-capacity per owner packet.
- [ ] **Lot 1 — Quota, reservation, and cost inventory (GitHub API)**
  - [x] Query account/runner/billing routes directly; retain null quota and HTTP 404 rather than inventing capacity/cost. Record observed lower-bound policy and static slot admission in capacity.md.
  - [ ] Inventory real account quotas/runner classes via the GitHub API; record reservation, scheduling priorities, cost, and peak demand in `spec/ci-cd-ten-minutes/capacity.md`.
  - [ ] Lot gate: inventory receipts attached with API routes/IDs; unknowns stay to-measure, never assumed.
- [ ] **Lot 2 — Bounded dispatch and concurrency**
  - [ ] Cancel only superseded PR attempts; preserve main release execution and avoid release overlap; cap/stagger package fan-out based on measured available slots.
  - [ ] Lot gate: concurrent real PR/main runs prove cancellation ownership and complete current-main delivery; attach capacity and wait receipts before accepting the configuration.
- [ ] **Lot 3 — Contention budgets and rollback drill**
  - [x] Qualify aggregate scheduling receipts on identified critical-path executions; preserve single-job queue statistics. Main cancellations remain current across newer main runs (32 metrics tests).
  - [ ] Inspect PR qualification, images, preproduction, and package results separately; verify an obsolete PR stops and a concurrent main release continues. No application UI changes.
  - [ ] Budget to measure: classification ≤15s, verdict ≤5s, aggregate critical-path scheduling ≤60s under declared concurrent traffic.
  - [ ] Rollback drill: restore prior scheduling policy and conservative dispatch width; keep expected-result and metrics checks; demonstrate that cancellation never stops the current release.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan, the study, and `spec/ci-cd-ten-minutes/capacity.md` with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: `make test-ci-run-metrics test-ci-expected-results ENV=test-ci-capacity` must parse/import the changed scripts and reject invalid result sets.
  - [ ] Build: no image/package build recipe changes; retain the final concurrent PR/main runs' existing build and artifact receipts.
  - [ ] API regression: no API source/test edits; verify every selected API result from the concurrent runs is present and successful.
  - [ ] UI regression: no UI source/test edits; verify the unchanged UI test/build results are present in the complete verdict.
  - [ ] E2E regression: no browser/VSCode/IdP membership change; reconcile the concurrent runs' selected and executed test identities, including cancellation ownership.
  - [ ] Run `make scope-check ENV=test-ci-capacity` before each commit; end isolated service lots with `make down ENV=test-ci-capacity` and `make down ENV=test-ci-capacity`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
