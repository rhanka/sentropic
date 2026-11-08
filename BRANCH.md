# Feature: Wagon perf/ci-tested-tree (main reuses the same-tree PR qualification)

## Objective
- [ ] A push to main skips the test members already green in the same-tree pull_request run of this workflow, still builds, publishes images by digest, writes release receipts and deploys preprod; any doubt or API error runs everything.

## Scope / Guardrails
- [x] Branch perf/ci-tested-tree from origin/main a5d8dee87; worktree tmp/worktrees/ci-tested-tree; ENV=test-ci-tree-cache.
- [x] Wagon only: branch push, no PR, no version bump, no lock or fixture regeneration.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; no local image build.
- [x] Scoped local checks only; full suites run in the train CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/**`
  - `.github/workflows/ci.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed with declared exception)**:
  - `.github/workflows/ci.yml` under BR92-EX1.

## Feedback Loop
- [x] BR92-EX1: on push to main, `changes` captures (read-only token) every pull_request run of ci.yml whose head commit has HEAD's tree, with every attempt; the expected manifest reuses the newest same-repository one only when every same-tree candidate and attempt is green (no newest-wins) and the reused attempt started within the 24 h bound, with a green run, a green ci-gate, a green expected set, the same policy digest and a success for every member it drops. Impact: test members skip on main with "satisfied by run" evidence; builds, image guards, candidates, publishers, release-receipts, deploy-preprod and the capacity validators still run. Rollback: revert the workflow and scripts/ci together; an absent or false `tested_tree` already runs everything.
- [ ] Acceptance: first main push after the train merge shows the tested-tree summary and an earlier deploy-preprod end.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip of an unqualified member.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: wagon branch merged by the train integration lane.

## UAT Management (in orchestration context)
- [ ] Exact-head train CI spans and the first tested-tree main run retained by the integration lane.

## Plan / Todo (lot-based)
- [x] Lot 0: verify merge tree equals PR head tree (25/25 recent main merges) and profile main runs 42421623485, 42408187255, 42395186428, 42391205757.
- [x] Lot 1: pure assessment `scripts/ci/tested-tree.mjs` and `make test-ci-tested-tree`.
- [x] Lot 2: manifest selection, gate verdict and capacity receipt accept the PR reference.
- [x] Lot 3: release receipt and daily live selector accept the PR reference.
- [x] Lot 4: workflow publishers, test-member guards, `changes` capture and decision.
- [x] Lot 5: scoped checks green (tested-tree 7/7, expected-results 28/28, ci-dag 10/10, ci-static 3/3, run-metrics 37/37, release-receipts 43/43, unit-graph 7/7, performance-report 8/8, consumer-contracts 25/25, live-provider 13/13, wiring + package DAG 51/51, security-daily 333/333, ci-capacity-policy shapeValid); wagon branch pushed.
- [x] Lot 6 (r2, GLM section 9) (d): no newest-wins; every same-tree candidate and every attempt green, else the complete run.
- [x] Lot 6 (a): explicit attempts (the concluded attempt is reused) and a 24 h age bound `TESTED_TREE_MAX_AGE_HOURS` on the reused attempt.
- [x] Lot 6 (e): the release receipt records the merge sha and the reused PR run id, attempt, head sha and tree.
- [ ] Lot 6: the daily live selector refuses a tuple with any non-green same-tree PR run.
- [x] Lot 6: residual recorded: a dropped member is proven by its job conclusion only (a success job with every step skipped is not detectable).
- [ ] Lot 6: scoped checks green; wagon branch pushed.
- [ ] Lot N: train CI green on the exact head; BRANCH.md removed at merge.
