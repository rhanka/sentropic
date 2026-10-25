# Feature: #861 final artifacts 0.2.0 candidate integration

## Objective
- [ ] Build the final artifacts 0.2.0 / cluster-mesh 0.22.0 candidate, requalify L8d, and obtain green PR #739 CI.

## Scope / Guardrails
- [x] Worktree tmp/worktrees/861-integration; branch feat/immo-861-integration; merge-only integration.
- [x] ENV=test-861-int last; shared Docker lock; matching make down after each Docker step.
- [x] No main merge or publication; the conductor owns publication.
- [x] Selective staging, make commit, fewer than 150 changed lines per new commit, no attribution trailers.

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
  - `package-lock.json`
  - `packages/llm-mesh/**`
  - `api/**`
  - `e2e/**`
- **Exception process**:
  - [x] BR861-EX1: retain existing isolated Compose qualification wiring; new release targets use that same service and environment.
  - [x] BR861-EX2: preserve approved incoming history and Track bytes without new edits outside qualification scope.
  - [x] BR861-EX3: retain reserved candidate manifest/lock versions artifacts 0.2.0 and cluster-mesh 0.22.0.
  - [x] BR861-EX4: retain artifacts 0.2.0 qualification pins and guarded sibling receipts.

## Feedback Loop
- [x] INT-18: pull --no-rebase reached 464581fb813b2fbfb6b4691b250162e0dfd942e9, including #750 public executor, packed example, A6 and A4.
- [x] INT-19: #750 replaced the integration plan with its topic plan; restore this integration scope while retaining all approved implementation bytes.
- [x] L0 freeze and previous integration decisions remain in the retained merge history.

## AI Flaky tests
- [x] No flaky acceptance, timeout increase or skipped required case.

## Orchestration Mode (AI-selected)
- [x] Multi-branch; one release integrator; L8d owns packed Radar qualification evidence.

## UAT Management (in orchestration context)
- [x] Package qualification only; no production activation claim.

## Plan / Todo (lot-based)
- [x] Lot 0 — pull integration with a merge; verify branch mechanically.
- [x] Lot 1a — artifacts unit gate: 440 tests / 35 files passed at product source 464581fb8.
- [x] Lot 2a — add reproducible guarded packing through the existing qualification Compose service.
- [x] Lot 2b — guard all three sibling identities and qualify the exact packed mesh archive.
- [x] Lot 2c — prepare ownership only on this worktree's candidate output and sibling archive directories.
- [x] Lot 1b — real PostgreSQL/MinIO integration and E2E: 172 tests / 12 files passed.
- [ ] Lot 1b — real integration, lint, frozen types and mesh surface/tuple/packaging gates.
- [ ] Lot 2 — record packed archives, SHA-256, npm integrity, source and toolchain provenance.
- [ ] Lot 3 — merge integration into L8d; requalify against current frozen-profile / E3 Radar pins.
- [ ] Lot 4 — push qualification evidence and monitor PR #739 at its final head until CI passes.
