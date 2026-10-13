# Feature: Comments cluster-mesh storage port — Lot C0

## Objective
- [ ] Implement C0 of the FROZEN L3a v4.1 storage-port spec: compatibility and extension manifest, frozen-M1 preservation test pinning M1 source hashes, exact transport and oracle packaging declarations.
- [ ] Merge frozen M1 (PR #663), promoted spec (origin/spec/comments-annotations-port), and cluster-mesh storage K1/K2a (PR #666) cleanly without modifying frozen M1 files.

## Scope / Guardrails
- [x] Branch `feat/comments-cm-c0` in `tmp/worktrees/comments-cm-c0`, branched from `origin/feat/comments-annotations-model` (frozen M1, PR #663, freeze 2dabe25ce).
- [x] Merge `origin/spec/comments-annotations-port` and `origin/feat/cluster-mesh-storage-k1` (PR #666).
- [x] Resolve merge conflict in `BRANCH.md` only; never modify frozen M1 files (`docs/comments-annotations/contract/contract-v1.json`, `docs/comments-annotations/freeze-receipt.md`, `packages/comments/src/**`, `packages/comments/tests/**`).
- [x] Implement C0 deliverables from §17: `docs/comments-annotations/contract/storage-module-v1.json`, `docs/comments-annotations/contract/storage-compatibility.md`, and test `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`.
- [x] Test-first: test fails when M1 source hashes change, and verifies compatibility manifest and storage contract boundaries.
- [x] Make-only workflow, Docker-first, ENV last with `API_PORT=9500 UI_PORT=5700 MAILDEV_UI_PORT=1600 ENV=test-comments-c0`.
- [x] Commits under 150 changed lines, max 10-15 files, named `git add` then separate `make commit MSG="..."`, no AI attribution.
- [x] Report `.h2a/build/c0_report.md` in the new worktree (untracked).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/comments-annotations/contract/storage-module-v1.json`
  - `docs/comments-annotations/contract/storage-compatibility.md`
  - `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `packages/cluster-mesh/src/storage/**`
  - `packages/cluster-mesh/tests/storage/**`
  - `packages/cluster-mesh/tests/packaging/**`
  - `spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md`
  - `docs/comments-annotations/**`
  - `spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `docs/comments-annotations/contract/contract-v1.json`
  - `docs/comments-annotations/freeze-receipt.md`
  - `packages/comments/src/**`
  - `packages/comments/tests/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `BR-C0-EX1` — Merge commit contains incoming files from K1/K2a (PR #666) and spec promotion; verified frozen M1 files are untouched.

## AI Flaky tests
- [x] No AI flaky tests in scope.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick (default for orthogonal tasks; single final test cycle)
- [x] Rationale: C0 delivers compatibility manifest and frozen-M1 preservation test in single worktree.

## UAT Management (in orchestration context)
- [x] Mono-branch: no UI surface in C0, no UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & merge resolution**
  - [x] Create worktree `tmp/worktrees/comments-cm-c0` on branch `feat/comments-cm-c0` from `origin/feat/comments-annotations-model`.
  - [x] Merge `origin/spec/comments-annotations-port`.
  - [x] Merge `origin/feat/cluster-mesh-storage-k1`.
  - [x] Resolve merge conflict in `BRANCH.md` using `plan/BRANCH_TEMPLATE.md`.
  - [x] Verify frozen M1 files are unchanged (`docs/comments-annotations/contract/contract-v1.json`, `docs/comments-annotations/freeze-receipt.md`, `packages/comments/src/**`, `packages/comments/tests/**`).
  - [x] Complete merge commit.

- [ ] **Lot C0 — Compatibility manifest & M1 preservation test**
  - [x] Read §17 row C0 and confirmation `.h2a/l3a/l3a_v4_confirmation.md` (G1–G5).
  - [x] Test-first: implement `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts` pinning M1 source hashes.
  - [ ] Implement `docs/comments-annotations/contract/storage-module-v1.json`.
  - [ ] Implement `docs/comments-annotations/contract/storage-compatibility.md`.
  - [ ] Run typecheck and test targets: `make test-cluster-mesh SCOPE=tests/comments-contract-boundaries.spec.ts API_PORT=9500 UI_PORT=5700 MAILDEV_UI_PORT=1600 ENV=test-comments-c0`.
  - [ ] Verify existing comments and cluster-mesh test suites pass.

- [ ] **Lot N — Final validation & PR**
  - [ ] Run `make scope-check API_PORT=9500 UI_PORT=5700 MAILDEV_UI_PORT=1600 ENV=test-comments-c0`.
  - [ ] Push `feat/comments-cm-c0` to origin: `git push origin feat/comments-cm-c0`.
  - [ ] Open draft PR with stacked note ("depends on #663 and #666").
  - [ ] Generate `.h2a/build/c0_report.md` (untracked).
  - [ ] Stop after C0.
