# Feature: BR-76 — Measure CI/CD and reserve execution capacity

## Objective
- [ ] Establish result completeness and measured queue capacity before changing execution cost.
- [ ] Branch `chore/ci-capacity-metrics`, step 1 of nine; train order BR-76 → BR-77; dependencies: this documentation PR merged; no earlier acceleration branch.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/ci-62-capacity-metrics`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-ci-62` (packet) mapping plan `ENV=test-ci-capacity-metrics`, never `dev`; no secrets in evidence.
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
- [ ] BR76-EX2 — Planned Makefile exception: add `ci-run-metrics`, `ci-expected-manifest`, `ci-expected-results`, `test-ci-run-metrics`, and `test-ci-expected-results` targets. Impact: named CI measurement and result entry points only. Rollback: restore the previous recipes and rerun their qualification.

- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.
- [x] R2-2: queue distributions exclude skipped nonexecutions; missing job readiness stays null, with no workflow-age fallback. Docker regressions reproduce both defects.
- [x] R2-5: skipped delivery endpoints are unselected with null elapsed; mixed execution sets stay partial. Zero-duration, inverted, and omitted-member regressions qualify the helpers.
- [x] R2-3 CLI: emit retained per-job/per-step spans with run/attempt/job identity; an executed CLI regression checks the measured Test step and unknown queue readiness.
- [x] R2 real-capture reconciliation: Main 39113919235/attempt 1 retains 84 rows, 59 execution waits, p50 63s, max 972s; changes job 117635669586 emits its 8s job and numbered step receipts through `make ci-run-metrics`.
- [x] R2-1 selection foundation: interpret workflow conditions with a restricted parser; unsupported syntax fails closed and context strings never execute as code.
- [x] R2-1 expected-set foundation: derive the intended DAG and expanded matrix names from workflow conditions before dispatch; unconditional validators stay required even with empty change filters.
- [x] R2-1 Make manifest: generate and retain actual workflow selections; actual-workflow regressions reject missing/ignored matrix members and unconditional validators, while unselected jobs pass.
- [x] R2-1 dispatch wiring: `changes` retains the workflow-derived manifest as a run/attempt-specific artifact before any dependent lane dispatches.
- [x] R2-3 capture input: accept retained raw Jobs API rows and normalize their run/attempt/job identities and numbered steps through the metrics entry point; absent readiness remains null.
- [x] R2-1 reconciliation: bind the expected manifest to run/attempt/head identity, enforce individual API matrix receipts, and require the full declared gate context including the collector itself.
- [x] R2-3 workflow delivery: the receipt job retains raw run/job/step API rows and the Make metrics output as run/attempt-specific artifacts after selected lanes complete; final-gate timing remains post-run measurement.
- [x] Preserve the train-integrity observer's existing non-gating contract: retain its receipt without making the collector a dependent; unchanged release-train wiring tests enforce this boundary.
- [x] R2-1 live gate: download this attempt's expected manifest and actual expanded receipts, then invoke the Make evaluator with the complete final needs context; exact-script regressions reject omissions/skips and accept legitimate unselected members.
- [x] Rerun qualification: the carried-forward `changes.expected_attempt` selects the original before-dispatch manifest; later attempts preserve run/head identity and require each raw job row to belong to the captured attempt. Future/cross-run manifests fail.
- [x] Real-capture qualification exposed GitHub's 100-character matrix-name truncation (job 117852314185); expected names now match the observed receipt and ambiguous truncated names fail closed.
- [x] Capture attempt-specific run metadata: the reference run's generic endpoint now reports attempt 2 while the measured jobs belong to attempt 1; both workflow collectors use the attempt endpoint to preserve that distinction.
- [x] Retain source SHA and actual workflow SHA separately in raw captures and metrics output; unavailable workflow revision remains null rather than assuming equality with the source.
- [x] R2 regression gate: 56 Docker tests pass (19 metrics, 15 expected-result/actual-gate, 22 unchanged publishable wiring); real review capture 39186952208/1 reconciles 58 selected required members and leaves skipped delivery elapsed null.
- [x] R1-4/R2-4 contention window: overlapping PR/main windows exclude skipped nonexecutions and unmeasurable/inverted intervals (Docker regression).
- [ ] R2-4 remains open: the account API returns `plan: null`, billing HTTP 404 requests missing `user` scope, and no quota/reservation/cost inventory was supplied. Account owner supplies that inventory; branch author must qualify the resulting bounded dispatch policy, concurrent PR/current-main delivery, rollback, and timing budgets.

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
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, relevant security/domain rules, `README.md`, `TODO.md`, the execution `PLAN.md`, the study, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Verify branch mechanically with harness; confirm prerequisite receipts and conductor registration/import before implementation; inventory the actual files and existing assertions at the new base.
  - [x] Capture a real baseline with run/attempt/job IDs, source SHA, workflow SHA, cache state, runner class, spans, selected endpoints, and executed test identities.
  - [x] Baseline receipts: source SHA `81deb7bd78d99bca8d51f67c4f1d4424fb772d75`; study evidence baseline `441453966a4dfac12c220f154508d7ab1ee3c237`; study Main run `39113919235` attempt 1; study PR run `39124873217` attempt 1; runner class `ubuntu-latest`; workflow SHA equals source SHA; cache state recorded as to measure at implementation time.
  - [x] Ports verified free on slot 0: API_PORT=9380, UI_PORT=5580, MAILDEV_UI_PORT=1480; harness `check branch` PASS for `chore/ci-capacity-metrics`.
  - [x] Declare exceptions above; names marked new below are deliverables to create, not existing commands or evidence.
- [ ] **Lot 1 — Expected results and timing receipts**
  - [x] Create `scripts/ci/ci-run-metrics.mjs` and `scripts/ci/ci-expected-results.mjs`: record actual DAG readiness/dispatch, job and step spans, four distinct delivery endpoints, attempts, selected matrices, and cache identities.
  - [x] `ci-run-metrics.mjs` complete (helpers, run summary, endpoint readiness, CLI).
  - [x] In `ci-run-metrics.test.mjs` (new), cover overlapping branches, skipped/unmeasured values, timestamp gaps, partial runs, and reruns without double-counting carried-forward jobs.
  - [x] In `ci-expected-results.test.mjs` (new), reject failed, missing, cancelled, and unexpectedly skipped required members; prove legitimately unselected jobs do not block.
  - [x] Lot gate: `make test-ci-run-metrics test-ci-expected-results ENV=test-ci-62` green in Docker (19 + 15 tests); unchanged publishable wiring passes 22/22; Main run `39113919235` attempt 1 retains 84 rows, 59 execution queue waits, p50 63s, max span 664s, and executed peak 17 half-open; no sub-spans invented.
- [ ] **Lot 2 — Finite capacity and concurrency**
  - [ ] Inventory real account quotas/runner classes; record reservation, scheduling priorities, cost, and peak demand in `spec/ci-cd-ten-minutes/capacity.md` (new). Measured so far: runner classes, executed peak 17, runner-minutes 148.25, queue and delivery receipts. Roughly 24 workers is a hypothesis, not a provisioned fact; quota, reservation, and registry cost remain to measure.
  - [ ] Cancel only superseded PR attempts; preserve main release execution and avoid release overlap; cap/stagger package fan-out based on measured available slots. Cancellation ownership is wired (PR-only cancel, identified gate verdict, unexpected-skip rejection); the measured-slot fan-out cap is not staged yet.
  - [ ] Lot gate: concurrent real PR/main runs prove cancellation ownership and complete current-main delivery; attach capacity and wait receipts before accepting the configuration.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Inspect PR qualification, images, preproduction, and package results separately; verify an obsolete PR stops and a concurrent main release continues. No application UI changes.
  - [ ] Budget to measure: classification ≤15s, verdict ≤5s, aggregate critical-path scheduling ≤60s under declared concurrent traffic; compare with the study's 877s E2E ready-to-start wait, not with a fabricated whole-run speedup.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore prior scheduling policy and conservative dispatch width; keep expected-result and metrics checks; demonstrate that cancellation never stops the current release.
- [x] **Lot 4 — Docs consolidation**
  - [x] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [x] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [x] Static: `make test-ci-run-metrics test-ci-expected-results ENV=test-ci-62` must parse/import the changed scripts and reject invalid result sets; application typecheck/lint is not applicable to these script-only edits.
  - [ ] Build: no image/package build recipe changes; retain the final concurrent PR/main runs' existing build and artifact receipts.
  - [ ] API regression: no API source/test edits; verify every selected API result from the concurrent runs is present and successful.
  - [ ] UI regression: no UI source/test edits; verify the unchanged UI test/build results are present in the complete verdict.
  - [ ] E2E regression: no browser/VSCode/IdP membership change; reconcile the concurrent runs' selected and executed test identities, including cancellation ownership.
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-62` before each commit; end isolated service lots with `make down ENV=test-ci-62` and `make down ENV=e2e-ci-62`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
