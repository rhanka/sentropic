# Fix: #861 public contract gaps

## Objective
- [x] Integrate approved topic heads with merge commits and qualify real artifacts and mesh tuple gates without publishing.

## Scope / Guardrails
- [x] Worktree: tmp/worktrees/861-contract-gaps; branch: fix/artifacts-861-contract-gaps.
- [x] ENV=test-861-gaps last; Docker steps use shared flock and make down after each step.
- [x] Main merge and publication require owner GO.
- [x] No rebase, squash, cherry-pick, Python, or attribution trailers.
- [x] Merge commits preserve reviewed histories; the 150-line bound applies to new integration fixes and resolutions.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/**`
  - `scripts/ci/immo-861-*`
  - `Makefile`
  - `docker-compose.immo-861.yml`
  - `.track/**`
  - `.github/workflows/ci.yml`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `.cursor/rules/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml`
  - `.security/**`
  - `api/**`
  - `e2e/**`
  - `docker-compose.test.yml`
  - `package-lock.json`
  - `packages/llm-mesh/**`
- **Exception process**:
  - [x] BR861-EX4: align only the three cluster-mesh qualification PEERS pins and their wiring assertion with artifacts 0.2.0; CI evidence rejected 0.1.3 against >=0.2.0 <0.3.0. Impact: qualification inputs only, no publication trigger or gate removed; rollback: restore these four version literals.
  - [x] BR861-EX1: qualification runner only; purpose: exact-tuple tests under mandatory Compose lock; impact: disposable test services and host harness scope check; rollback: remove qualification wiring. Main-only publishing stays unchanged.
  - [x] BR861-EX2: owner-requested origin/main merge only; preserve #734 and main changes in conditional paths; no integration edits there; rollback: revert the merge.

## Feedback Loop
- [x] BR861-GAPS-EX1: permit the existing isolated Compose runner, platform build, scope check and teardown for test-861-gaps; impact is one additional test environment; rollback removes this environment from the existing guards.
- [x] Candidate remains 0.2.0 per the owner request and r2 single-writer version reservation; no publication.
- [ ] GAPS-1: public executor/types and packed typed example; test packed installation and compilation.
- [x] GAPS-RED: packed example missing; three preparation regression cases fail on missing exports. Regression tests committed before implementation.
- [x] GAPS-1a: example now includes a compiled frozen-shape profile, PG participant with shared policy locks, fence minting and a serialized durable cleanup scheduler with an explicit lifetime/cadence.
- [ ] GAPS-2: correlated preparation inventory/deadlines and bounded safe cleanup; test denial, expiry, shared blobs and retry after cleanup failure.
- [x] GAPS-2a: memory and PostgreSQL stores retain preparation history and atomically invalidate expired attempts before cleanup; metadata uses existing JSON intents without schema or L3 port changes.
- [x] GAPS-2b: public preparation inspection and deterministic batch-bounded cleanup retain shared references/pins, serialize deletion with claims, and surface retryable cleanup debt.
- [x] GAPS-2c: added the real PostgreSQL regression for cleanup winning before a paused finalization; publication must roll back release, pointer and success.
- [x] GAPS-2d: preparation records include unique attempt/invocation/time/deadline metadata; PostgreSQL completion refuses expired/abandoned intents in the same finalization transaction. Cleanup-released pins do not mask the coordinator outcome.
- [ ] GAPS-3: correlated purge pause and claim inspection; test both race orders on PostgreSQL.
- [x] GAPS-3a: added durable claim history inspection and a call-scoped purge deletion adapter with release/finished; no global monkey patch or authority shortcut.
- [x] GAPS-3b: added PostgreSQL tests for both claim/reference race orders, durable pause inspection, advisory exclusion through DELETE, retained shared bytes and fresh preparation after resolution.
- [x] GAPS-PG: all three new PostgreSQL race assertions passed; reference-first fixture now drains its own pending purge claim to preserve isolation for existing inventory assertions.
- [ ] GAPS-4: full artifacts unit/integration, lint, freeze, packed example, digests, push and draft PR against feat/immo-861-integration.
- [x] GAPS-GATES2: 171 integration/E2E tests / 12 files passed; packed public example compiled successfully. Public cleanup/test host bindings are documented in the shipped migration guide.
- [x] GAPS-GATES1: artifacts/platform build and frozen contract compilation passed; all 437 unit tests / 35 files passed. PostgreSQL/MinIO passed 131 cases / 11 files; the remaining child-process suite needs the runner's own platform SDK dependency link.
- [x] GAPS-INFRA: npm TLS resets reproduced twice in Docker and once on host; added an isolated offline qualification path using read-only external tool dependencies, excluding sibling @sentropic packages. Packed consumer installs archives only.
- [x] GAPS-INFRA2: cached Node 22 declaration archive is SHA-512 verified; tool dependencies reside in a container-only node_modules directory for normal transitive resolution.
- [x] GAPS-2e: regression added for a crashed writer whose external PUT finishes after cleanup; debt must become observable and sweepable again.
- [x] GAPS-2f: delayed PUT regression reproduced; inspection reopens residual debt and subsequent bounded sweeps recheck settled history without deleting protected bytes.
- [x] BR861-EX3: root lock workspace metadata follows the artifacts/mesh candidate versions; no dependency resolution change; rollback with candidate manifests.
- [x] L0: owner accepts external CI failure tracked in #734.
- [x] L3: owner accepts 157f231d5; type convergence is now integrated through the approved L6 head.
- [x] Merge policy: retain integration BRANCH.md; report each source conflict separately.
- [x] L5 brings reviewed Track events; preserve them without editing. The L5 scope check reported advisory failures because the initial train plan forbade Track; this plan now permits preservation of the approved history.

## AI Flaky tests
- [x] No flaky acceptance granted.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: one integrator; merge order L0, L1, L2, L3, L4, L5, L7, L6.

## UAT Management (in orchestration context)
- [x] No UI changes; real package and service tests are the qualification scope.

## Plan / Todo (lot-based)
- [x] PR #738 was automatically marked merged by GitHub after integration; added the requested comment: merged via integration #739. PR #739 stays open; CI is monitored on its final pushed head.
