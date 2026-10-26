# Feature: Engram E8 authoritative candidate scope liaison

## Objective
- [ ] Exercise the frozen Engram 0.21.1 candidate-to-invocation/store/scope liaison outside sealed bytes; C7 remains pending producer co-review and E7 integration.

## Scope / Guardrails
- [x] Approved root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E8 only; base E0 `ad4164534`.
- [x] Branch `feat/cluster-mesh-engram-e8`; worktree `tmp/worktrees/mem-e8`; merge only, no rebase.
- [x] Make only; `ENV=test-e2-int` last; no Python, publication, merge, or Engram re-pin.
- [x] Preserve frozen 0.21.1 DTOs and P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop on a changed P2.
- [x] Shared Docker lock for builds/tests/containers; sanctioned Compose targets; cleanup after each step.
- [x] No service ports published; reserve API 9040, UI 5240, mail 1140 if needed.
- [x] Specific-file staging; `make commit` only; each commit below 150 changed lines; no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/tests/engram-memory/host-scope-binding.ts`
  - `packages/cluster-mesh/tests/engram-memory/scope.spec.ts`
  - `packages/cluster-mesh/tests/engram-memory/candidate-scope.spec.ts`
  - `packages/cluster-mesh/src/engram-memory/host-scope-binding.ts`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `PLAN.md`
  - `packages/cluster-mesh/assets/storage/engram-memory/C6-FREEZE.md`
  - `packages/cluster-mesh/assets/storage/engram-memory/neutral-asset-inventory.json`
  - `packages/cluster-mesh/assets/storage/engram-memory/neutral-equivalence.json`
  - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts`
  - `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts`
  - `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts`
  - `packages/cluster-mesh/tests/engram-memory/neutral-contract-types.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/cluster-mesh/src/storage/**`
  - `tools/memory-mcp-l5/artifacts/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Exception process**:
  - [x] BRE8-EX1: owner assigns unique pack-only `0.23.0-dev.4`; manifest/root-lock version edits only; rollback both together; never publish.

## Feedback Loop
- [x] BRE8-EX2: integration base `6c3f9f04a` does not yet contain E0; list inherited E0 paths for actual-base CI scope only. `git diff --exit-code ad4164534 HEAD -- <inherited paths>` passes; E8 must not edit those bytes. Impact: scope declaration only; rollback: remove inherited entries after E0 integration. Manifest/root-lock entries remain version-only under BRE8-EX1.
- [ ] Report producer questions to gr-conductor; C7 is not accepted by this branch alone.
- [ ] Integrate after E7; durable E9 and installed E10 acceptance remain separate.
- [x] Host fixture keeps the factory-stamped store object; invocation and crypto dependencies are host/engine-private; a fresh ledger refuses until host authority is restored.
- [x] Resume: retain prior commits; type the DTO fixtures and crypto result explicitly; cover admission, asynchronous issuance revocation and ambiguous commit refusal.
- [x] Known llm-gateway 404 is outside E8 scope per owner.
- [x] Registry 2026-10-26: latest mesh 0.22.1; assigned 0.23.0-dev.4 returns 404 and exceeds registry/base; pack-only manifest/root-lock bump, no publication.

## AI Flaky tests
- [x] No AI-dependent tests, flaky waiver, or increased timeout.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: independent E8 topic targets `feat/engram-e2-integration`.

## UAT Management (in orchestration context)
- [x] No UI change; host integration and producer co-review replace interactive UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: read Docker lock, E8 row, E0 ACK, rules/template; mechanical branch check; P2 pinned.
- [x] **Lot 1 — Tests first**: candidate probe reproduced 5 failures/1 pass before liaison; expanded memory suite passes 92/92 across 12 files, including installed constructor provenance and DTO compilation.
- [x] **Lot 2 — Host liaison**: host-owned fixture; private authoritative issuance and pre-effect guards; no caller DTO or copied invocation creates a mapping; no production seam needed before E7.
- [x] **Resume qualification**: 16/16 candidate scenarios pass; full pre-extension memory run 92/92; P2 unchanged; PR #764 is draft, targets integration and remains unmerged. Actual-base inherited E0 scope is explicit.
- [ ] **Lot 3 — Validation**: focused tests, memory suite, typecheck/lint/build, dev.4 manifest commit, scope checks, unchanged P2.
- [ ] **Lot 4 — Handoff**: push; draft PR from this file; green E2 qualification; report PR/head/CI and producer questions; do not merge.
