# Feature: Train 4 2026-11-07 CI10 stage 4 (parallel unit shards, toolbox dependency base, matrix reload)

## Objective
- [ ] One train, one PR, one CI: start all API test shards at once longest first, pull a verified toolbox dependency base on PRs, and reload the matrix page after a late workspace scope reset.
- [x] Wagons: perf/ci10-stage4, fix/ui-matrix-reload (cherry-picked onto main 3f1027496 without conflict).

## Scope / Guardrails
- [x] Branch train/2026-11-07-ci10-d; worktree tmp/worktrees/train4; ENV=test-ci10-train4.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling.
- [x] Scoped local checks only; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/**`
  - `Makefile`
  - `api/Dockerfile`
  - `.github/workflows/ci.yml`
  - `ui/src/routes/matrix/+page.svelte`
  - `ui/tests/utils/matrix-reload.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/*/src/**`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed with declared exception)**:
  - `.github/workflows/ci.yml` under BR87-EX1.
  - `Makefile` and `api/Dockerfile` under BR87-EX2.

## Feedback Loop
- [x] BR87-EX1: unit shard scheduling and toolbox base pull and publish wiring in ci.yml. Rollback: revert the workflow and wiring tests together.
- [x] BR87-EX2: toolbox base targets in the Makefile and the Dockerfile base stage split. Rollback: restore recipes and stages.
- [ ] Acceptance: spans of three CI runs retained in .tmp/rv/ci10-final.md.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: two wagons integrated into one dated train with one CI.

## UAT Management (in orchestration context)
- [ ] Exact-head pull_request CI result and critical-path spans retained in the PR.

## Plan / Todo (lot-based)
- [x] Lot 1: wagons cherry-picked onto main without conflict.
- [x] Lot 2: scoped checks green (ci-dag 10/10, unit-graph 7/7, expected-results 28/28, api-tool-cache 6/6, ci-static 3/3).
- [x] Lot 3: push, open PR, GLM review.
- [x] Review B1: pin the exact longest-first wave and the complete endpoint set (performance-report 8/8).
- [x] Review M3: a deps miss or a failed thin build falls back to the full toolbox build with a warning; full-build failure stays fatal (api-tool-cache 11/11, api-tooling layers, disk-hygiene).
- [x] Review L4: the deps record names its tooldeps identity; a stale or malformed record is refused and truncated (api-tool-cache 13/13).
- [x] Review M2: observed slots lower bound 17 -> 28, the executed peak of run 42393158936 (half-open spans); account quota stays to-measure (expected-results 28/28).
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
