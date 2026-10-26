# Fix: pack-only dev tolerance for the installed-comments bare probe

## Objective
Make the `cluster-mesh-comments-installed` bare probe accept the `incompatible_version` refusal when the installed candidate is a pack-only `0.23.0-dev.N` bump (reserved next, declared once), so E2/E6/E3/E4 stop failing on it. The frozen fixture keeps pinning the latest published release (`0.22.4`); no range, version or product file is touched.

## Scope / Guardrails
- Base `origin/feat/engram-e2-integration` (`d22fc3f24`); PR targets `feat/engram-e2-integration`.
- Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
- Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
- Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
- Test-only change: probe + gate module + packaging of the probe + unit spec.
- Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs`
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts`
  - `packages/cluster-mesh/tests/storage/installed-bare.mjs`
  - `packages/cluster-mesh/tests/storage/postgres.mk`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/cluster-mesh/src/**`
  - `packages/cluster-mesh/assets/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - _none_
- **Exception process**:
  - _none required_

## Feedback Loop
- [x] Second dev-bump gate: `installed-bare.mjs:17` pins `not_installed`; a `0.23.0-dev.N` candidate refuses with `incompatible_version` (frozen Comments range).
- [x] Same triple contract as #767 (`isPackOnlyDevBump`, `RESERVED_NEXT = 0.23.0`, latest published `0.22.4`), duplicated as plain `.mjs` for the bare probe; bump together with #767's module.
- [x] Pin fed from the frozen fixture via `CM_PACK_ONLY_PIN` (make extraction + docker env); gate module copied next to the probe.
- [x] Negative tests in `pack-only-dev-gate.spec.ts`: stale pin, wrong reserved, rc, stable and off-line candidates keep refusing.
- [ ] Push draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one integration fix; no delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code changes; qualify the unit spec on integration plus the decision-level synthetic dev cases.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Branch setup**: worktree `tmp/worktrees/comments-gate` on the integration base; verify P2 unchanged.
- [x] **Lot 1 — Fix**: gate module, probe tolerance, mk pin plumbing, unit + synthetic spec.
- [ ] **Lot 2 — Final validation**
  - [ ] `make scope-check` before each commit; commits under 150 lines via `make commit`.
  - [ ] Run the new spec on integration (stable head, synthetic dev cases included).
  - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.
