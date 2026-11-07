# Feature: Train 1a 2026-11-07 artifacts 0.2.20 (git tools routing, live-host subpath)

## Objective
- [ ] One train, one PR, one CI, one npm publication: @sentropic/artifacts 0.2.20 carrying the git-backed tool routing (feat/artifacts-route-git-tools) and the live-host subpath (feat/artifacts-live-host).
- [x] Wagons: feat/artifacts-route-git-tools, feat/artifacts-live-host (cherry-picked onto main 8ee9c24ef; wagon BRANCH.md edits dropped).
- [x] CI wagon perf/ci10-cluster-mesh (4ff175482, 2b454214d) cherry-picked; wagon BRANCH.md replaced by the train plan, BR89-EX1 carried over.

## Scope / Guardrails
- [x] Branch train/2026-11-07-artifacts-0.2.20; worktree tmp/worktrees/train1a; ENV=test-train1a.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling.
- [x] Scoped local checks only; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/**`
  - `package-lock.json`
  - `api/package-lock.json`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
  - `.github/workflows/ci.yml`
  - `scripts/ci/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed with declared exception)**:
  - `package-lock.json` under BR88-EX1.
  - `api/package-lock.json`, `api/src/services/mcp/cluster-registry.ts`, `api/tests/api/app-mcp-registry.test.ts`, `api/tests/api/app-mcp-installed.test.ts` under BR88-EX2.
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**`, `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` under BR88-EX3.
  - `.github/workflows/ci.yml` under BR89-EX1.

## Feedback Loop
- [x] BR88-EX1: package-lock.json workspace entry of @sentropic/artifacts moves 0.2.18 to 0.2.20. Rollback: revert the version bump and lock line together.
- [x] BR88-EX2: provider-version repin of the APP-P1 manifest digest to 0.2.20 `6faa661d9eab38920f4b7926d0778af00e3054dc3064f14c3d644ee0faa97ab7` (same digest at version 0.2.18 stays `d55df3ad…`, tool definitions byte-stable), plus the API lock workspace entry. Impact: API registry pin and its two scoped tests only. Rollback: revert with the version bump.
- [x] BR88-EX3: selected-fixture repin of @sentropic/artifacts 0.2.18 to 0.2.20 through `make pack-candidate-siblings` (CI-equivalent PR context) and `refresh-lazy-package-lock`; guarded archive sha256 `35b4d0c39c310747bf1174b66e19ba6d4168fb9b0f7765f9f8f208ee16d23189`, lock integrity and tuple-spec pin updated. Impact: packaging fixture only. Rollback: revert with the version bump.
- [x] BR89-EX1 (wagon perf/ci10-cluster-mesh): validate-cluster-mesh matrix regrouped from 3 legs of 3 serial lanes to 7 legs (max-parallel 7), memory MCP qualification run once from the install leg. Impact: +4 jobs per selected run, every lane and gate kept. Rollback: revert the workflow and the scripts/ci shape tests together.
- [ ] Acceptance: exact-head CI green, GLM APPROVE, npm publication of 0.2.20 by the publish workflow after merge.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: two package wagons integrated into one train with a single version and publication.

## UAT Management (in orchestration context)
- [ ] Exact-head pull_request CI result retained in the PR.

## Plan / Todo (lot-based)
- [x] Lot 1: wagons cherry-picked onto main without code conflict.
- [x] Lot 2: version 0.2.20, merged changelog, lock entry.
- [ ] Lot 3: push, open PR, CI and GLM review in parallel.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
