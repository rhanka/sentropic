# Feature: BR-76 — Measure CI/CD execution receipts

## Objective
- [ ] Establish result completeness and measured queue/capacity receipts before changing execution cost.
- [ ] Branch `chore/ci-capacity-metrics`, step 1 of nine; train order BR-76 → BR-77; dependencies: this documentation PR merged; no earlier acceleration branch.
- [ ] Owner split decision 2026-10-19: this PR claims metrics + expected-results + docs only; Lot 2 and the capacity/contention/rollback parts of Lot 3 move to BR-77 (`plan/71-BRANCH_chore-ci-capacity-policy.md`).

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
- [ ] BR76-EX3 — Follow-up plan exception: create `plan/71-BRANCH_chore-ci-capacity-policy.md` (forbidden path, owner split decision 2026-10-19). Impact: one new plan file; no code or workflow change. Rollback: delete the file.

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
- [x] R1-4/R2-4 measured admission and budgets: `admissionDecision` checks observed peak against declared slots plus release reserve; `budgetVerdict` flags 15s/5s/60s breaches and keeps missing inputs to-measure (Docker regressions).
- [x] R1-4/R2-4 cancellation and release continuity: `cancellationOwnership` attributes each cancelled row to a superseded or current attempt within and across runs (head-ref receipts); `releaseContinuity` requires every release endpoint measured and successful (Docker regressions, round-4 probes green).
- [x] R1-4/R2-4 CLI capacity receipts: the metrics output retains admission, budget, cancellation, and continuity sections from optional capture inputs (Docker regression).
- [x] Round-3 count correction: attempts 1+2 read 168 input rows, 58 copies dropped, 110 retained rows (60 measured, 50 skipped) in capacity.md and the study; exact-head budget breaches retained with run/attempt/job IDs, Lot 2/3 acceptance still open.
- [ ] R2-4 follow-up (BR-77): the account API returns `plan: null`, billing HTTP 404 requests missing `user` scope, and no quota/reservation/cost inventory was supplied. The BR-77 agent inventories quotas/costs itself via the GitHub API, then qualifies the bounded dispatch policy, concurrent PR/current-main delivery, rollback, and timing budgets.
- [ ] Round-4 E2E root cause: `tests/05-usecase-detail.spec.ts:690` expected 201, got 409 because this branch predated main fix `3dab10a48` (same-owner concurrent lock acquisition returned conflict). Resolved by merging origin/main; no E2E timeout change; branch carries no app-code edit for it.

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
- [ ] **Lot 2 — Finite capacity and concurrency (moved to BR-77, `plan/71-BRANCH_chore-ci-capacity-policy.md`)**
  - [ ] Moved: quota/reservation/cost inventory, bounded dispatch, fan-out cap, concurrent PR/main qualification.
- [ ] **Lot 3 — UAT and measured acceptance (capacity/contention/rollback parts moved to BR-77)**
  - [ ] Moved to BR-77: obsolete-PR/concurrent-main verification, contention budgets, rollback drill.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
- [x] **Lot 4 — Docs consolidation**
  - [x] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [x] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [x] Static: `make test-ci-run-metrics test-ci-expected-results ENV=test-ci-62` must parse/import the changed scripts and reject invalid result sets; application typecheck/lint is not applicable to these script-only edits.
  - [ ] Build: no image/package build recipe changes; retain this head's existing build and artifact receipts.
  - [ ] API regression: no API source/test edits; verify every selected API result from this head is present and successful.
  - [ ] UI regression: no UI source/test edits; verify the unchanged UI test/build results are present in the complete verdict.
  - [ ] E2E regression: no browser/VSCode/IdP membership change; reconcile this head's selected and executed test identities (concurrent PR/main qualification moved to BR-77).
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-62` before each commit; end isolated service lots with `make down ENV=test-ci-62` and `make down ENV=e2e-ci-62`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
