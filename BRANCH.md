# Feature: #861 L8d packed tuple and full Radar qualification

## Objective
- [ ] Qualify candidate archives and all eight spec r2 section 6.3 suites with explicit evidence and zero silent skips.

## Scope / Guardrails
- [x] Worktree tmp/worktrees/861-L8d; branch feat/artifacts-861-L8d; merge integration and L6 without rebasing.
- [x] Make-only; ENV=test-861-l8d last; ports API 18924, UI 15924, Maildev 11924.
- [x] Every Docker step uses shared flock and matching make down; no publication or other lane edits.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/probe/l8d/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/cluster-mesh/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No exceptions authorized; product defects stay with the owning lot and retain failing evidence.

## Feedback Loop
- [x] Read-only Radar pins: A1 f2b6c25cc9458ec285d6d4f620a55dad8c30f909; A2 b104ae90a28a5581e8eabd15f12acb58558d3396; acceptance e2e9515ea41baebf5539743f0cfa0dea750d072c; main merge 2dbde92e9a6c532abe4f9e7bed8ed9a9b381d530.
- [x] BASE #910 retires the route called by immo-mcp data-source.ts:316; qualify pinned ARTEFACTS integration separately from current main.
- [x] Runner records each suite independently; failures remain known_failure and missing shards remain not_covered.
- [x] Reused integration build outputs only after matching each artifacts/mesh/platform source tree; unchanged platform/auth use exact registry archives.
- [x] Image gate stays not_covered: pinned Radar image-smoke uses forbidden raw Docker; no image qualification is inferred from a Node container pass.

## AI Flaky tests
- [x] No flaky acceptance granted; missing contracts and skipped acceptance cases fail qualification.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: qualification only; integrator owns shared manifests and L8a/b/c/d aggregation.

## UAT Management (in orchestration context)
- [x] No UI changes; candidate evidence cannot authorize published tuple or production activation.

## Plan / Todo (lot-based)
- [x] Lot 0 — read Docker lock, spec r2 L8d/6.3/Q1–Q4 and pins; mechanical branch check; L6 already included.
- [x] Lot 1 — fail-closed suite/four-shard validation; 15 runner regressions pass, zero skips.
- [ ] Lot 2 — strict full-Radar install; runtime/declaration/container smokes; archive/lock/image/test hashes.
- [ ] Lot 3 — five API suites and all three host suites with gate 1; retain failures and missing interfaces.
- [ ] Lot 4 — aggregate shards, final scope check, atomic commits, push and draft PR targeting integration.

## Deferred to L9
- [x] Registry provenance/signatures, published-byte rerun and production activation require separate release gates.
