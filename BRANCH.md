# Feature: Train 1a 2026-11-07 artifacts 0.2.20 (git tools routing, live-host subpath)

## Objective
- [ ] One train, one PR, one CI, one npm publication: @sentropic/artifacts 0.2.20 carrying the git-backed tool routing (feat/artifacts-route-git-tools) and the live-host subpath (feat/artifacts-live-host).
- [x] Wagons: feat/artifacts-route-git-tools, feat/artifacts-live-host (cherry-picked onto main 8ee9c24ef; wagon BRANCH.md edits dropped).

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
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed with declared exception)**:
  - `package-lock.json` under BR88-EX1.
  - `api/package-lock.json`, `api/src/services/mcp/cluster-registry.ts`, `api/tests/api/app-mcp-registry.test.ts`, `api/tests/api/app-mcp-installed.test.ts` under BR88-EX2.

## Feedback Loop
- [x] BR88-EX1: package-lock.json workspace entry of @sentropic/artifacts moves 0.2.18 to 0.2.20. Rollback: revert the version bump and lock line together.
- [x] BR88-EX2: provider-version repin of the APP-P1 manifest digest to 0.2.20 `6faa661d9eab38920f4b7926d0778af00e3054dc3064f14c3d644ee0faa97ab7` (same digest at version 0.2.18 stays `d55df3ad…`, tool definitions byte-stable), plus the API lock workspace entry. Impact: API registry pin and its two scoped tests only. Rollback: revert with the version bump.
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
