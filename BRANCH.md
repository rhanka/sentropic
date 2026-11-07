# Feature: Wagon perf/ci10-cluster-mesh (validate-cluster-mesh under 6 min)

## Objective
- [ ] Cut validate-cluster-mesh wall time from 10.6 min to under ~6 min without removing or weakening any check, and without pushing the critical path out under the account runner cap.

## Scope / Guardrails
- [x] Branch perf/ci10-cluster-mesh from origin/main 8ee9c24ef; worktree tmp/worktrees/ci10-cluster-mesh; ENV=test-ci10-cmesh.
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
  - `.github/workflows/ci.yml` under BR89-EX1.

## Feedback Loop
- [x] BR89-EX1: validate-cluster-mesh matrix regrouped from 3 legs of 3 serial lanes to 7 legs (max-parallel 7), memory MCP qualification run once from the install leg. Impact: +4 jobs per selected run, every lane and gate kept. Rollback: revert the workflow and the scripts/ci shape tests together.
- [ ] Acceptance: train CI spans show every validate-cluster-mesh leg at or under ~6 min and no later test-phase end.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: wagon branch merged by the train integration lane.

## UAT Management (in orchestration context)
- [ ] Exact-head train CI spans retained by the integration lane.

## Plan / Todo (lot-based)
- [x] Lot 0: profile run 42408187255 per step and per lane in .tmp/rv/wagon-ci10-cluster-mesh.md.
- [ ] Lot 1: regroup the matrix into 7 legs longest first; memory MCP step once; shape checks pinned (expected-results width 7, DAG members, memory-once test).
- [ ] Lot 2: scoped checks green (test-ci-dag, test-ci-unit-graph, test-ci-expected-results, test-ci-static, test-ci-performance-report, test-ci-run-metrics, ci-capacity-policy, test-ci-package-qualification-dag, test-ci-consumer-contracts, publishable-ci-wiring).
- [ ] Lot N: train CI green on the exact head; BRANCH.md removed at merge.
