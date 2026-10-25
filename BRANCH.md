# Feature: #861 integration (L0–L5, L7)

## Objective
- [ ] Integrate approved topic heads with merge commits and qualify real artifacts and mesh tuple gates without publishing.

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
- **Forbidden Paths (must not change in this branch)**:
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml`
- **Exception process**:
  - [x] BR861-EX1: qualification runner only; purpose: exact-tuple tests under mandatory Compose lock; impact: disposable test services and host harness scope check; rollback: remove qualification wiring. Main-only publishing stays unchanged.

## Feedback Loop
- [x] L0: owner accepts external CI failure tracked in #734.
- [x] L3: owner accepts 157f231d5; type convergence belongs to L6, excluded from this train.
- [x] Merge policy: retain integration BRANCH.md; report each source conflict separately.

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
- [ ] Lot 3 — merge 157f231d5 (coordinator).
- [ ] Lot 4 — merge a8df25634 (publication/collection).
- [ ] Lot 5 — merge c703afc68 (MCP/HTTP).
- [ ] Lot 7 — merge eae0c261a (mesh surface/tuple).
- [ ] Qualification — make test-artifacts; record exact counts and source SHA.
- [ ] Qualification — make test-artifacts-integration against PostgreSQL/MinIO; record exact counts.
- [ ] Qualification — make lint-artifacts; record errors and warnings.
- [ ] Qualification — mesh artifacts-surface.spec.ts, artifacts-tuple.spec.ts, tuple-skew.spec.ts.
- [ ] Handoff — push and open draft PR to main; report head, counts, conflicts, and lot defects.
