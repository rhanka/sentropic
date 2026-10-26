# Feature: Engram E0 C6 asset freeze

## Objective
- [ ] Freeze the neutral declaration surface and additive asset mapping against installed Engram 0.21.1, preserving semantic digest `sha256:dff737ced37d801ef48bb4d7088fc4fbc92021d21fe2034ff33ea643b49bec28`.

## Scope / Guardrails
- [x] Approved specification: root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E0 only; PostgreSQL first under E2-Q1.
- [x] Branch `feat/cluster-mesh-engram-e0`; worktree `tmp/worktrees/mem-e0`; integration base `6c3f9f04a`; author codex / gpt-6.1-sol / high.
- [x] Make only; `ENV=test-e2-int` last; no Python; no publication or merge.
- [x] Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
- [x] Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
- [x] Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
- [ ] Sole integrator allocates a unique pack-only `0.23.0-dev.N`; final declaration packaging remains serially assigned to that integrator.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts`
  - `packages/cluster-mesh/assets/storage/engram-memory/**`
  - `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts`
  - `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts`
  - `packages/cluster-mesh/tests/engram-memory/neutral-contract-types.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/src/storage/**`
  - `tools/memory-mcp-l5/artifacts/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Exception process**:
  - [ ] Record a numbered exception with rationale, impact and rollback before the serial integrator-owned pack-only bump.

## Feedback Loop
- [x] Owner update closes common-rule/Immo E2-D1 and Comments ACK gate; retained ACK in root `.tmp/engram-e2-host-tuple/e0-entry-check-2026-10-26.md`.
- [ ] Integration-target bump probe: retain unchanged-version failure then corrected-version success here; no implementation acceptance before both receipts.
- [x] Register E0 dependencies, worktree/BRANCH and environment ownership in PLAN.md within this PR.
- [x] Negative-probe source: initial C6 identity inventory only; package version unchanged from the actual integration base (0.22.2).
- [x] Owner sanctions `test-e2-int`; E0 exclusively owns that Compose qualification project while holding the shared Docker lock; no host ports published.
- [x] Integration fast-forwarded and pushed to main `6c3f9f04a`; no conflict or P2 change. #709 succession: E6 projection, E7 binding, E10 installed qualification; SQLite checkpoint 2026-10-30.
- [x] No E0 source, assets, dependency locks or pre-candidate manifests changed before admission.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: one E0 topic targets the integration branch; serial metadata writer; no delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code changes; qualify declaration and installed constructor compatibility.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Entry gates**
  - [x] Read Docker lock, rules, approved plan and P2 binding; mechanical branch check passes.
  - [x] Verify #755 landing and ancestry; align existing clean E0 worktree with integration.
  - [ ] Close Feedback Loop admission blockers; integrator refreshes registry/version allocation.
- [ ] **Lot 1 — E0 C6 asset freeze**
  - [ ] Reconcile installed 0.21.1 constructor/options, full handle/errors, u64 limits and five profiles against the handoff.
  - [ ] Add neutral-contract.ts and additive inventory/equivalence assets.
  - [ ] Freeze name `engram-memory-neutral-contract`, version `1.0.0`, intended path `contracts/engram-memory-neutral-contract-v1.d.ts` with both producers.
  - [ ] Extend contract-vectors.spec.ts and binding-compatibility.spec.ts; add independently compilable neutral-contract-types.ts structural checks.
  - [ ] Preserve the exact semantic digest; final emitted bytes, runtime/profile equivalence and backend acceptance remain pending.
- [ ] **Lot 2 — Docs consolidation and final validation**
  - [ ] Run permitted Compose build/typecheck/lint/scoped tests and current-head E2 qualification with receipts; scope-check before each commit.
  - [ ] Push and open draft PR using this BRANCH.md; verify E2 qualification green without merging.
  - [ ] Supply actual producer freeze reference and §6 interim reply through the conductor; request and retain identity acknowledgement.
