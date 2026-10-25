# Feature: #861 integration (L0–L7)

## Objective
- [x] Integrate approved topic heads with merge commits and qualify real artifacts and mesh tuple gates without publishing.

## Scope / Guardrails
- [x] Worktree: tmp/worktrees/861-integration; branch: feat/immo-861-integration.
- [x] ENV=test-861-int last; Docker steps use shared flock and make down after each step.
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
  - [x] BR861-EX1: qualification runner only; purpose: exact-tuple tests under mandatory Compose lock; impact: disposable test services and host harness scope check; rollback: remove qualification wiring. Main-only publishing stays unchanged.
  - [x] BR861-EX2: owner-requested origin/main merge only; preserve #734 and main changes in conditional paths; no integration edits there; rollback: revert the merge.

## Feedback Loop
- [x] INT-6: merged approved L6 e67a978f9; retained integration plan and L6 compiled MCP capability selection. Ported main's UTF-8 MCP regression to the trusted invocation API. Frozen L0 files and Track journal remain byte-identical.
- [x] INT-2: origin/main merge conflicts only in BRANCH.md; retain this integration plan. Track journal is byte-identical to the pre-merge integration head.
- [x] INT-3: restored the frozen build-mcp-platform recipe; retained P1 packed graph verification passed (30 files, 54 edges) inside the isolated Compose runner, without regenerating evidence.
- [x] BR861-EX3: root lock workspace metadata follows the artifacts/mesh candidate versions; no dependency resolution change; rollback with candidate manifests.
- [x] INT-4: reserved artifacts 0.2.0 and mesh 0.22.0 candidate manifests per spec r2 sections 5.2/6.1; registry baselines are 0.1.4/0.21.2. Platform 0.4.0 and mcp-auth 0.2.2 are reused; no publication or L8 acceptance claim. Artifacts build and 11 MCP tests passed.
- [x] INT-5: aligned selected fixture declarations with its retained published artifacts 0.1.4 entry; source tuple checks pass (4 tests; 3 installed checks await their dedicated runner). Mesh surface passes 21 tests. Full local packaging reached a registry 404 for llm-mesh 0.27.1; CI's verified sibling path remains required.
- [x] L0: owner accepts external CI failure tracked in #734.
- [x] L3: owner accepts 157f231d5; type convergence belongs to L6, excluded from this train.
- [x] Merge policy: retain integration BRANCH.md; report each source conflict separately.
- [x] L5 brings reviewed Track events; preserve them without editing. The L5 scope check reported advisory failures because the initial train plan forbade Track; this plan now permits preservation of the approved history.
- [x] INT-1: full installed packaging reproduced 90 passes / 1 failure at types-and-bundlers.spec.ts:82. The old optional-peer-only assertion rejected L7's declared platform digest import. Require the exact two runtime edges and the artifacts-only declaration edge; no runtime change.

## AI Flaky tests
- [x] No flaky acceptance granted.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: one integrator; merge order L0, L1, L2, L3, L4, L5, L7.

## UAT Management (in orchestration context)
- [x] No UI changes; real package and service tests are the qualification scope.

## Plan / Todo (lot-based)
- [x] Lot 0 — merge d41f47092 (contracts).
- [x] Lot 1 — merge 0c71291a2 (profile); only the topic plan conflicted.
- [x] Lot 2 — merge b29b6a334 (failures); only the topic plan conflicted.
- [x] Lot 3 — merge 157f231d5 (coordinator); only the topic plan conflicted.
- [x] Lot 4 — merge a8df25634 (publication/collection); only the topic plan conflicted.
- [x] Lot 5 — merge c703afc68 (MCP/HTTP); only the topic plan conflicted.
- [x] Lot 7 — merge eae0c261a (mesh surface/tuple); only the topic plan conflicted.
- [x] Lot 6 — merge e67a978f9 (approved transport/type convergence); resolved plan, MCP names and MCP tests.
- [ ] Requalification — artifacts unit/integration, lint, freeze-types and mesh surface/tuple/packaging on the final integration head.
- [x] Qualification — make test-artifacts: 407 passed, 31 files; source tree at 818b6c509; build passed; make down passed.
- [x] Qualification — make test-artifacts-integration: 94 passed across 10 files against real PostgreSQL/MinIO; build and make down passed.
- [x] Qualification — make lint-artifacts: 0 errors, 0 warnings; make down passed.
- [x] Qualification — mesh artifacts-surface.spec.ts: 21 passed, 1 file; make down passed.
- [x] Qualification — full test-lazy-package: 91 passed, 15 files; artifacts-tuple: 7 passed; tuple-skew: 14 passed; types-and-bundlers: 17 passed.
- [x] Handoff — branch pushed; draft PR [#739](https://github.com/rhanka/sentropic/pull/739) targets main; all seven approved merges retained; no new lot defects observed in the requested gates.
