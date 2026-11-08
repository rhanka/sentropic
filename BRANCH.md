# Feature: Train 1a 2026-11-07 artifacts 0.2.20 (git tools routing, live-host subpath)

## Objective
- [ ] One train, one PR, one CI, one npm publication: @sentropic/artifacts 0.2.20 carrying the git-backed tool routing (feat/artifacts-route-git-tools) and the live-host subpath (feat/artifacts-live-host).
- [x] Wagons: feat/artifacts-route-git-tools, feat/artifacts-live-host (cherry-picked onto main 8ee9c24ef; wagon BRANCH.md edits dropped).
- [x] CI wagon perf/ci10-cluster-mesh (4ff175482, 2b454214d) cherry-picked; wagon BRANCH.md replaced by the train plan, BR89-EX1 carried over.
- [ ] CI wagon perf/ci10-e2e-critical (branch only, no PR): e2e critical path at least 3 min shorter under BR92-EX1 and BR92-EX2.

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
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed with declared exception)**:
  - `package-lock.json` under BR88-EX1.
  - `api/package-lock.json`, `api/src/services/mcp/cluster-registry.ts`, `api/tests/api/app-mcp-registry.test.ts`, `api/tests/api/app-mcp-installed.test.ts` under BR88-EX2.
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**`, `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` under BR88-EX3.
  - `.github/workflows/ci.yml` under BR89-EX1 and BR92-EX2.
  - `Makefile` under BR92-EX1.

## Feedback Loop
- [x] BR88-EX1: package-lock.json workspace entry of @sentropic/artifacts moves 0.2.18 to 0.2.20. Rollback: revert the version bump and lock line together.
- [x] BR88-EX2: provider-version repin of the APP-P1 manifest digest to 0.2.20 `6faa661d9eab38920f4b7926d0778af00e3054dc3064f14c3d644ee0faa97ab7` (same digest at version 0.2.18 stays `d55df3ad…`, tool definitions byte-stable), plus the API lock workspace entry. Impact: API registry pin and its two scoped tests only. Rollback: revert with the version bump.
- [x] BR88-EX3: selected-fixture repin of @sentropic/artifacts 0.2.18 to 0.2.20 through `make pack-candidate-siblings` (CI-equivalent PR context) and `refresh-lazy-package-lock`; guarded archive sha256 `35b4d0c39c310747bf1174b66e19ba6d4168fb9b0f7765f9f8f208ee16d23189`, lock integrity and tuple-spec pin updated. Impact: packaging fixture only. Rollback: revert with the version bump.
- [x] BR89-EX1 (wagon perf/ci10-cluster-mesh): validate-cluster-mesh matrix regrouped from 3 legs of 3 serial lanes to 7 legs (max-parallel 7), memory MCP qualification run once from the install leg. Impact: +4 jobs per selected run, every lane and gate kept. Rollback: revert the workflow and the scripts/ci shape tests together.
- [x] BR92-EX1 (wagon perf/ci10-e2e-critical): Makefile computes API_VERSION, UI_VERSION and E2E_VERSION once per make run (unexported while parsing, frozen and exported at the end) instead of ~100 times under GNU Make 4.4; same tag values; `make down` accepts an optional DOWN_TIMEOUT. Impact: every CI make call loses ~17 s of parse time; default `make down` unchanged. Rollback: revert the Makefile hunks.
- [ ] BR92-EX2 (wagon perf/ci10-e2e-critical): browser jobs download their three images in one parallel step, load them in parallel, stop the disposable stack with a short grace period; browser shards rebalanced on measured durations. Impact: same jobs, receipts, provider isolation guard and shutdown check. Rollback: revert the workflow, scripts/ci/browser-shards.mjs and the scripts/ci tests together.
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
- [x] Lot 2b (CI run 42411674268 fixes): APP-P1 digest computed through `make test-artifacts` probe (0.2.20 `6faa661d…`, 0.2.18 override `d55df3ad…`); selected fixture refreshed; `test-cluster-mesh SCOPE=tests/packaging` 85 pass, `test-lazy-package` with sibling receipts 136/136.
- [x] Lot 2c (CI wagon BR89-EX1): ci-dag 10/10, unit-graph 7/7, expected-results 28/28, ci-static 3/3, performance-report 8/8, run-metrics 36/36, package-qualification-dag 9/9, package-candidate 9/9, consumer-contracts 25/25, ci-capacity-policy shapeValid.
- [ ] Lot 2d: API `tests/api/app-mcp-registry.test.ts` and `tests/api/app-mcp-installed.test.ts` run in the train CI app-cluster-mesh shards (local API stack needs an image rebuild, refused at 91% disk).
- [ ] Lot 3: push, open PR, CI and GLM review in parallel.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
