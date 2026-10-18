# Feature: BR-62 — Measure CI/CD and reserve execution capacity

## Objective
- [ ] Establish result completeness and measured queue capacity before changing execution cost.
- [ ] Branch `chore/ci-capacity-metrics`, step 1 of nine; train order 62 → BR-63; dependencies: this documentation PR merged; no earlier acceleration branch.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/ci-capacity-metrics`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-ci-capacity-metrics` or `ENV=e2e-ci-capacity-metrics`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9310, UI_PORT=5510, MAILDEV_UI_PORT=1410; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/62-BRANCH_chore-ci-capacity-metrics.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `scripts/ci/ci-run-metrics.mjs`
  - [ ] `scripts/ci/ci-run-metrics.test.mjs`
  - [ ] `scripts/ci/ci-expected-results.mjs`
  - [ ] `scripts/ci/ci-expected-results.test.mjs`
  - [ ] `spec/ci-cd-ten-minutes/capacity.md`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR62-EX1; `Makefile` under BR62-EX2.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] BR62-EX1 — Planned workflow exception: instrument `changes` and `ci-gate`, PR concurrency, and main scheduling without cancelling an active release. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR62-EX2 — Planned Makefile exception: add `ci-run-metrics`, `test-ci-run-metrics`, and `test-ci-expected-results` targets (new). Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.

- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.

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
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, relevant security/domain rules, `README.md`, `TODO.md`, the execution `PLAN.md`, the study, and `plan/BRANCH_TEMPLATE.md`.
  - [ ] Verify branch mechanically with harness; confirm prerequisite receipts and conductor registration/import before implementation; inventory the actual files and existing assertions at the new base.
  - [ ] Capture a real baseline with run/attempt/job IDs, source SHA, workflow SHA, cache state, runner class, spans, selected endpoints, and executed test identities.
  - [ ] Declare exceptions above; names marked new below are deliverables to create, not existing commands or evidence.
- [ ] **Lot 1 — Expected results and timing receipts**
  - [ ] Create `scripts/ci/ci-run-metrics.mjs` and `scripts/ci/ci-expected-results.mjs`: record actual DAG readiness/dispatch, job and step spans, four distinct delivery endpoints, attempts, selected matrices, and cache identities.
  - [ ] In `ci-run-metrics.test.mjs` (new), cover overlapping branches, skipped/unmeasured values, timestamp gaps, partial runs, and reruns without double-counting carried-forward jobs.
  - [ ] In `ci-expected-results.test.mjs` (new), reject failed, missing, cancelled, and unexpectedly skipped required members; prove legitimately unselected jobs do not block.
  - [ ] Lot gate: `make test-ci-run-metrics test-ci-expected-results ENV=test-ci-capacity-metrics`; compare a captured real run to GitHub timestamps without inventing sub-spans.
- [ ] **Lot 2 — Finite capacity and concurrency**
  - [ ] Inventory real account quotas/runner classes; record reservation, scheduling priorities, cost, and peak demand in `spec/ci-cd-ten-minutes/capacity.md` (new). Roughly 24 workers is a hypothesis, not a provisioned fact.
  - [ ] Cancel only superseded PR attempts; preserve main release execution and avoid release overlap; cap/stagger package fan-out based on measured available slots.
  - [ ] Lot gate: concurrent real PR/main runs prove cancellation ownership and complete current-main delivery; attach capacity and wait receipts before accepting the configuration.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Inspect PR qualification, images, preproduction, and package results separately; verify an obsolete PR stops and a concurrent main release continues. No application UI changes.
  - [ ] Budget to measure: classification ≤15s, verdict ≤5s, aggregate critical-path scheduling ≤60s under declared concurrent traffic; compare with the study's 877s E2E ready-to-start wait, not with a fabricated whole-run speedup.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore prior scheduling policy and conservative dispatch width; keep expected-result and metrics checks; demonstrate that cancellation never stops the current release.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-capacity-metrics` before each commit; end isolated service lots with `make down ENV=test-ci-capacity-metrics` and `make down ENV=e2e-ci-capacity-metrics`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
