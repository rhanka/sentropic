# Feature: Train 2026-11-07 CI10 stage 3 (image guards, prebuilt toolbox, lighter e2e)

## Objective
- [ ] One train, one PR, one CI: move API image guards and toolbox qualification off the critical path, pull a content-addressed prebuilt toolbox, and lighten the e2e shards, targeting a full PR CI of 12-13 minutes without self-hosted runners.
- [x] Wagons: perf/ci10-image-checks, perf/ci10-toolbox-e2e (cherry-picked onto main 695ebb580).

## Scope / Guardrails
- [x] Branch train/2026-11-07-ci10-b; worktree tmp/worktrees/train2; ENV=test-ci10-train2.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling.
- [x] Scoped local checks only; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/**`
  - `scripts/test-artifact-content-image.sh`
  - `Makefile`
  - `api/tests/unit/auth/oauth-state-adapter.test.ts`
  - `.github/workflows/ci.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/*/src/**`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed with declared exception)**:
  - `.github/workflows/ci.yml` under BR85-EX1.
  - `Makefile` under BR85-EX2.

## Feedback Loop
- [x] BR85-EX1: image guards job, toolbox qualification job, GHCR toolbox pull and main-only push (job-level packages: write), e2e image loads and shutdown. Rollback: revert the workflow and wiring tests together.
- [x] BR85-EX2: toolbox registry pull and push targets in the Makefile. Rollback: restore recipes.
- [x] BR85-EX3: test-only fix of the oauth-state-adapter race test (main red after the security train, Postgres 40001): run() goes through withSerializationRetry like production; assertions unchanged. Rollback: revert fa7ac7f8e.
- [ ] Acceptance: exact-head CI wall time retained in .tmp/rv/train-ci10-b.md on three runs.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: two CI wagons integrated into one dated train with one CI.

## UAT Management (in orchestration context)
- [ ] Exact-head pull_request CI timing retained in .tmp/rv/train-ci10-b.md.

## Plan / Todo (lot-based)
- [x] Lot 1: wagons cherry-picked onto main without conflict.
- [x] Lot 2: scoped make checks green (ci-dag 10/10, unit-graph 5/5, expected-results 28/28, api-tool-cache 4/4, ci-static 3/3).
- [ ] Lot 3: push, open PR, GLM review.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
