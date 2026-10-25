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
- [x] Lot 2d — retain prior sibling archives outside the guarded destination before regenerating final receipts.
- [x] Lot 1b — real PostgreSQL/MinIO integration and E2E: 172 tests / 12 files passed.
- [x] Lot 1 — artifacts 440/35 files, real integration/E2E 172/12, lint and freeze-types pass; mesh surface 21/1, full packaging 97/15 with no skips (artifacts tuple 7, tuple skew 15, strict tuple 3, MCP tuple 2, types/bundlers 17).
- [x] Lot 2 — guarded pack source deca5422c; artifacts SHA-256 6122ed8d2adea53be6366918f7df83238e8a7bd0596fdd48b0be752497f2ae82; mesh d01a2c7669b7e18e1597d2407790bd64a865a6fe258b6bd61f7f6fba4a6452ab; SHA-512 integrity and toolchain recorded in packages/artifacts/probe/l8d/CANDIDATE-0.2.0.md and the requested root .tmp report.
- [x] Lot 3 — merged candidate source into L8d; strict full-Radar install, packed smoke and 19 runner tests pass against dde9f4c85 with listKeys 8d6aabb0a. E3 local branch has the same head; no newer head at pin selection.
- [x] Lot 3 result — L8d NO-GO: Q1 0/31, Q2 0/31, acceptance 0/6; required totals 73 pass / 72 fail / 5 setup skips; full host 152 pass / 1 fail. Per-case evidence classifies 71 Radar failures and 2 H3 coverage gaps across all invoked tests; image smoke and final matching L8a/b/c shards remain uncovered.
- [x] Lot 4a — push L8d evidence and merge its history without product, frozen-contract or Track changes; retain this integration plan.
- [ ] Lot 4b — push final integration head and monitor PR #739 until CI passes; final CI state belongs in the external candidate receipt to avoid a metadata-only CI loop.
