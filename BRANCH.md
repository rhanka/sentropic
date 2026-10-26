# Fix: pack-only dev tolerance for fixture pins

## Objective
Make the two version-pinned specs tolerate pack-only `0.23.0-dev.N` topic bumps so every lot stays green without touching frozen fixtures, peer ranges or versions.

## Scope / Guardrails
- Base `origin/feat/engram-e2-integration` (0.22.4 after the r1 merge of `origin/main`); PR targets `feat/engram-e2-integration`.
- Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
- Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
- Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
- Test-only change: no fixture, range, version or product file is touched.
- Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/tests/packaging/fixtures/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `packages/cluster-mesh/src/**`
  - `packages/cluster-mesh/assets/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - _none_
- **Exception process**:
  - _none required_

## Feedback Loop
- [x] Base `origin/feat/engram-e2-integration` at `6c3f9f04a`; P2 unchanged; candidate `0.22.2`.
- [x] Root cause: both specs pin the released tuple; pack-only `dev.N` bumps intentionally leave that tuple behind (no silent widening, no fixture churn per bump).
- [x] prepare-artifacts: on `-dev.` candidates the frozen fixture must keep pinning a stable release tarball; the lock entry must match that frozen version.
- [x] registry: any prerelease leaf is refused before peer resolution (matches the pinned `0.23.0` and `0.22.1-rc.1` refusals); released leaves still prove the optional peer is required.
- [x] Opus r1 P2-1 (merge `origin/main` into the integration branch): done, `d22fc3f24` (tuple 0.22.4 / 0.21.3 / 0.28.1, all published); fix branch merged onto it.
- [x] Opus r1 P2-2/P2-3 (named same-base predicate + negative test): `isPackOnlyDevBump` in `prepare-artifacts.spec.ts`; `0.22.1`, cross-base `-dev.`, `-rc.1` and stable-same-base stay on the strict path.
- [x] Opus r1 P2-4 (dev-branch proof in CI on the head): the `isPackOnlyDevBump` cases run in CI; the file-driven dev path was simulated locally on a `-dev.` bump.
- [x] Opus r1 P2-5 (BRANCH.md checkboxes): this file.
- [ ] Push draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one integration fix; no delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code changes; qualify the two specs on integration and on a dev bump.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and branch setup**
  - [x] Read Docker lock; create worktree `tmp/worktrees/integ-fixt` on the integration base; verify P2 unchanged.
  - [x] Write BRANCH.md from template (test-only scope).
- [x] **Lot 1 — Tests (the fix is the tests)**
  - [x] Tolerate `-dev.` candidates in `prepare-artifacts.spec.ts` (frozen stable pin + matching lock entry).
  - [x] Expect prerelease-leaf refusal in `registry.spec.ts` (released leaves keep the peer-required proof).
  - [x] Named `isPackOnlyDevBump` same-base predicate with positive and negative cases.
- [ ] **Lot 2 — Final validation**
  - [ ] `make scope-check` before each commit; commits under 150 lines via `make commit`.
  - [ ] Run the two specs on integration (0.22.4, original paths) and on a dev bump (new paths).
  - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.
