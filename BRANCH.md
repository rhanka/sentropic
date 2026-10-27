# Wire shared PG for the memory lane (integration)

## Objective
Run the `memory` lane of `engram-e2-qualify` against the shared Postgres service (`ENV=test-e2-int` style) so PG-backed memory cases execute instead of skipping, fail-closed when PG is absent.

## Scope / Guardrails
- Base `origin/feat/engram-e2-integration` (`d22fc3f24`); PR targets `feat/engram-e2-integration`.
- Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
- Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
- Makefile lane wiring only: no src, range, version or product change.
- Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `Makefile` (BR-MEMPG-EX1: memory lane shares `engram-e2-postgres-up` and `CM_PG_URL` with the postgres lane; fail-closed under `set -eu` when PG is absent)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/cluster-mesh/src/**`
  - `packages/cluster-mesh/tests/**`
  - `packages/cluster-mesh/assets/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - _none_
- **Exception process**:
  - [x] BR-MEMPG-EX1 (integrator): the memory lane starts the shared PG service and exports the lane `CM_PG_URL`, mirroring the postgres lane; a missing PG aborts the lane before any test runs.

## Feedback Loop
- [x] Root cause: the `memory` lane ran `test-cluster-mesh SCOPE=tests/engram-memory` with no `CM_PG_URL` and no PG service, so PG-backed memory cases skipped and any PG stage never ran in CI.
- [x] Fix: same `CM_PG_URL` value and same `engram-e2-postgres-up` gate as the `postgres` lane; `set -eu` keeps it fail-closed.
- [x] No `ci.yml` change: `qualify-engram-e2` already runs `engram-e2-qualify` on the `test-e2-int` Compose project that provides the `postgres` host (proven by the postgres lane).
- [ ] Push draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one integration fix; no delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code changes; qualify the memory lane locally on integration with PG up (skips become executions where PG-backed).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Branch setup**: worktree `tmp/worktrees/mem-pg-wire` on the integration base; `harness check branch` PASS.
- [x] **Lot 1 — Wiring**: `CM_PG_URL` + `postgres-up` for the memory lane.
- [ ] **Lot 2 — Final validation**
  - [ ] `make scope-check` before each commit; commits under 150 lines via `make commit`.
  - [ ] Run `make engram-e2-lane E2_LANE=memory ENV=test-e2-int` locally; receipts retained, cleanup done.
  - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.
