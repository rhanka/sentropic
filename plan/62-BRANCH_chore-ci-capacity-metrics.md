# Feature: BR-76 — Measure CI/CD execution receipts

## Objective
- [ ] Establish result completeness and measured queue/capacity receipts before changing execution cost.
- [ ] Branch `chore/ci-capacity-metrics`, step 1 of nine; train order BR-76 → BR-77; dependencies: this documentation PR merged; no earlier acceleration branch.
- [ ] Owner split decision 2026-10-19: this PR claims metrics + expected-results + docs only; Lot 2 and the capacity/contention/rollback parts of Lot 3 move to BR-77 (`plan/71-BRANCH_chore-ci-capacity-policy.md`).

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/ci-capacity-metrics`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-ci-capacity-metrics` or `ENV=e2e-ci-capacity-metrics`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9380, UI_PORT=5580, MAILDEV_UI_PORT=1480; verify availability before starting services and pass all three ports to service commands.
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
  - [ ] `.github/workflows/ci.yml` under BR76-EX1; `Makefile` under BR76-EX2.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] BR76-EX1 — Planned workflow exception: instrument `changes` and `ci-gate`, PR concurrency, and main scheduling without cancelling an active release. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR76-EX2 — Planned Makefile exception: add `ci-run-metrics`, `test-ci-run-metrics`, and `test-ci-expected-results` targets (new). Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.
- [ ] BR76-EX3 — Follow-up plan exception: create `plan/71-BRANCH_chore-ci-capacity-policy.md` (forbidden path, owner split decision 2026-10-19). Impact: one new plan file; no code or workflow change. Rollback: delete the file.

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
- [ ] **Lot 2 — Finite capacity and concurrency (moved to BR-77, `plan/71-BRANCH_chore-ci-capacity-policy.md`)**
  - [ ] Moved: quota/reservation/cost inventory, bounded dispatch, fan-out cap, concurrent PR/main qualification.
- [ ] **Lot 3 — UAT and measured acceptance (capacity/contention/rollback parts moved to BR-77)**
  - [ ] Moved to BR-77: obsolete-PR/concurrent-main verification, contention budgets, rollback drill.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
  - [x] BR-76 receipts recorded in `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md` section 9 and `spec/ci-cd-ten-minutes/capacity.md`; gaps: account quota, cost, concurrent PR/main behavior. No temporary EVOL notes were created.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: `make test-ci-run-metrics test-ci-expected-results ENV=test-ci-capacity-metrics` must parse/import the changed scripts and reject invalid result sets; application typecheck/lint is not applicable to these script-only edits.
  - [ ] Build: no image/package build recipe changes; retain this head's existing build and artifact receipts.
  - [ ] API regression: no API source/test edits; verify every selected API result from this head is present and successful.
  - [ ] UI regression: no UI source/test edits; verify the unchanged UI test/build results are present in the complete verdict.
  - [ ] E2E regression: no browser/VSCode/IdP membership change; reconcile this head's selected and executed test identities (concurrent PR/main qualification moved to BR-77).
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-capacity-metrics` before each commit; end isolated service lots with `make down ENV=test-ci-capacity-metrics` and `make down ENV=e2e-ci-capacity-metrics`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
