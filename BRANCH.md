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
  - [x] Rebased on origin/main 22d8a9e68b1abae2665fedb528526d2a84c6bc4d; retire inherited integration-plan prefix in bounded commits: 233/233 lines.
- [x] **Lot 1 — Quota, reservation, and cost inventory (GitHub API)**
  - [x] Query account/runner/billing routes directly; retain null quota and HTTP 404 rather than inventing capacity/cost. Record observed lower-bound policy and static slot admission in capacity.md.
  - [x] Inventory real account quotas/runner classes via the GitHub API; record reservation, scheduling priorities, cost, and peak demand in `spec/ci-cd-ten-minutes/capacity.md`.
  - [x] Lot gate: inventory receipts attached with API routes/IDs; unknowns stay to-measure, never assumed.
- [ ] **Lot 2 — Bounded dispatch and concurrency**
  - [x] Review r2: begin removing static capacity mutexes (classification and validation jobs); retain PR cancellation and independent publication. Removal continues before the next push.
  - [x] Review r2: remove the next 30 capacity mutexes, including API/E2E matrix slots; keep matrix membership and widths 15/5.
  - [x] Review r2: remove every remaining capacity mutex. API/E2E widths stay 15/5; validators/publishers remain independent; PR cancellation and existing release groups remain.
  - [x] Review r2: run API/IdP typecheck and lint beside E2E; retain typecheck-lint-api in receipts and ci-gate, so failures still block qualification/publication.
  - [x] Review r1: remove the 13/10-deep validator chains; six queued capacity groups preserve 23 independent jobs and their selected-result identities.
  - [x] Review r1: ordinary publishers depend on their own validators; preserve the existing oauth-to-mcp-auth and mesh/gateway/cluster registry dependency barriers.
  - [ ] Lot gate: concurrent real PR/main runs prove cancellation ownership and complete current-main delivery; attach capacity and wait receipts before accepting the configuration.
- [ ] **Lot 3 — Contention budgets and rollback drill**
  - [x] Combine real run captures for observed-peak admission, execution-overlap witnesses, superseded PR ownership and per-main-release continuity; incomplete runs remain to-measure.
  - [x] Reject queued API placeholder timestamps and invalid/skipped critical-path endpoints; include dependency-to-dispatch handoff delay in aggregate scheduling (34 metrics tests).
  - [x] Real cancellation receipt exposed runner_id=0 entries with positive API intervals; preserve their identities/stamps but exclude them from execution, cost and peak credit (35 metrics tests).
  - [x] Post-run classification/verdict timing uses that same runner-dispatch evidence; absent runners never receive duration credit. New policy qualification uses ENV=test-ci-capacity.
  - [x] Include workflow admission before root job creation (rollback 189s; completed main 1s) in critical-path scheduling. Preserve unknown admission/readiness as null; completed main aggregate is 1559s.
  - [x] Reject admission credit for partial/empty captures or missing execution stamps; reject release continuity without endpoint mappings. Preserve raw observed peaks separately (35 metrics tests).
  - [x] Main 40356941217 attempt 2 is green on base 22d8a9e68: all selected endpoints continuous after retrying an artifact-download failure. Carried package endpoints completed before retry creation retain null elapsed timing; reuse durationSeconds to reject the observed negative interval.
  - [x] Add post-run Make capture using the actual run/attempt Jobs API, exact source workflow, and retained pre-dispatch manifest. Missing artifacts fail closed; no selection reconstructed from outcomes.
  - [x] Qualify aggregate scheduling receipts on identified critical-path executions; preserve single-job queue statistics. Main cancellations remain current across newer main runs (32 metrics tests).
  - [x] Inspect PR qualification, images, preproduction, and package results separately; verify an obsolete PR stops and a concurrent main release continues. No application UI changes.
  - [ ] Budget to measure: classification ≤15s, verdict ≤5s, aggregate critical-path scheduling ≤60s under declared concurrent traffic.
  - [ ] Rollback drill: require a completed drill and record its run ID; cancelled run 40353670942 does not qualify.
  - [x] Prepare live conservative rollback: one package validation lane and API/E2E widths 1/1; retain the pre-BR77 cancellation/release groups and every completeness/metrics check. Run beside main 40341027258 attempt 2.
  - [ ] Rollback head 474e023163fd1be0b2f0ac7f33442c2d97dc561c started run 40353670942, cancelled before completion; a passing metrics job is not a completed drill.
  - [x] Main 40341027258 attempt 2 completed successfully through both supersessions: all four endpoints continuous; peak 12; 210.45 runner-minutes. Classification/verdict/scheduling 19s/19s/1559s breach 15s/5s/60s; retain these failures in capacity.md. Rollback metrics job 121682975411 passed live.
- [x] **Lot 4 — Docs consolidation**
  - [x] Update this plan, the study, and `spec/ci-cd-ten-minutes/capacity.md` with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] P1 (Opus r1) timing acceptance: completed final-policy PR 40460101167 took 3661s and main-like dry-run 40460107095 took 3928s on 2026-10-27; both exceed 2288s. Policy unchanged; PR stays draft.
  - [x] Final measurement source: merge dd2737fa486985ecfa756261b26ba2323e73289f incorporates origin/main 2d6643692389ecbb7e5ac410e7b31a3cfbaa732a. Harness C1/C2 and all 35 + 21 + 90 tooling tests passed before push; both attempt-1 runs completed successfully without interruption.
  - [x] PR receipt: 06:16:16–07:17:17 UTC, 62 executions / 27 skips; qualification 3660s = 2582s scheduling + 1078s execution, then 1s finalization. E2E D job 122046116611 queued 2571s and executed 357s. Full receipts and hotspots are in capacity.md.
  - [x] Main-like dry-run receipt: 06:16:20–07:21:48 UTC, 82 executions / 7 skips; qualification 3927s = 2965s scheduling + 962s execution, then 1s finalization. All 21 guarded-pack steps passed; registry writers skipped. Package endpoint 3304s = 3205s scheduling + 99s execution.
  - [x] Retained manifests attest the same policy digest and fresh executions; strict CI_REQUIRE_CAPACITY_PROOF=1 rejects both timing regressions. Combined observed execution peak is 15. A branch workflow_dispatch remains a main-like dry-run, not actual main release evidence; no broader acceptance ticked.
  - [ ] Review r1: tests first for queued capacity groups, independent validators/publishers; require completed final-policy PR/main receipts <=2288s; no receipt, no acceptance.
  - [x] Review r1 publication qualification: branch dry-run 40408883195 completed successfully on source 1b5ef5368, 82 executions / 7 skips. All 21 publisher jobs completed real guarded packs; identified archive receipts and skipped registry writers/post-publication checks verified individually. This is a branch wiring receipt, not main delivery or timing acceptance.
  - [x] Use the capacity Make entry points for dispatch/status/capture. Final-source PR 40402395319 and branch dry-run 40408883195 both completed; no intermediate push interrupted these two receipts.
  - [x] Superseded old-policy run 40380899105 retained the PR group after automatic cancellation; verified PR 766, same-repo branch and obsolete head 773aa4283, then finished cancellation at 19:19:06 UTC. No current run or main release cancelled.
  - [x] Dry-run 40385085415 exposed missing CI context in cowork-desktop job 121805361211. Test-first correction passes 21 fixtures and the local guarded pack; final-source dry-run 40408883195 job 121963393513 now passes the actual pack in CI/WARN mode with the registry writer skipped. Full 21-package qualification remains separate below.
  - [x] Review r1: wall-clock proof rejects cancelled/incomplete/old-policy receipts, branch dispatches labelled as main, duplicate PRs, missing gates and 2289s regressions.
  - [x] Receipt-reader regression: reject carried executions predating the attempt creation and missing execution stamps; observed main retry 40356941217 cannot qualify fresh delivery. All 21 expected-results tests pass; workflow unchanged.
  - [x] Policy provenance: both completed captures retain the same pre-dispatch workflow digest and fresh first-attempt executions; strict proof rejects their elapsed times. Mismatched/unattested historical captures remain unqualified, with test-first regression coverage.
  - [ ] Acceptance command: `make ci-capacity-policy CI_REQUIRE_CAPACITY_PROOF=1 CI_POLICY_RUN_FILES='<pr>/capture.json <main>/capture.json' ENV=test-ci-capacity`; static admission alone never qualifies timing.
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [x] Static: `make test-ci-run-metrics test-ci-expected-results ENV=test-ci-capacity` must parse/import the changed scripts and reject invalid result sets.
  - [x] Review r1 local qualification: 35 metrics + 21 expected-results and 90 publication tests pass (includes 24 wiring checks). Static PR/main bounds 15/17; final-policy timing acceptance remains open.
  - [x] Final conflict-resolution rebase on main 55431a99c73ae72bcf9404c8de5b1c8375f9e39b preserved the workflow/scripts from a251dbfa5; the sole BRANCH.md conflict is resolved. Harness C1/C2 and all 35 + 21 + 90 tests pass again; 37 replayed commits remain below 150 changed lines.
  - [ ] Timing rejected: completed PR 40402395319 on frozen policy source 1b5ef536885cf1f8533e88fc54dc40dbbf8c7223 succeeded with 62 executions / 27 skips, but wall-clock 18224s exceeds 2288s. Aggregate critical-path scheduling is 17227s; strict proof command rejects it. Require qualifying new PR/main receipts before acceptance.
  - [ ] Build: no image/package build recipe changes; retain the final concurrent PR/main runs' existing build and artifact receipts.
  - [ ] API regression: no API source/test edits; verify every selected API result from the concurrent runs is present and successful.
  - [ ] UI regression: no UI source/test edits; verify the unchanged UI test/build results are present in the complete verdict.
  - [ ] E2E regression: no browser/VSCode/IdP membership change; reconcile the concurrent runs' selected and executed test identities, including cancellation ownership.
  - [ ] Run `make scope-check ENV=test-ci-capacity` before each commit; end isolated service lots with `make down ENV=test-ci-capacity` and `make down ENV=test-ci-capacity`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
