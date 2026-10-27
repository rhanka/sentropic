# P3 re-pin after #769 (integration)

## Objective
Re-pin `feat/engram-e2-integration` from the P2 generation (`f2b094ae`, retained history `2b85ff28`) to the P3 generation frozen by main #769: manifest `1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730`, catalog `9bf377b774dda54a3b37189eea57cb845acca7b27b8b55b399f23c20215a1211`, l0-freeze `0541b15ba4d5e49ba3b30d92da1c5e3c2fd668e40937e4f942103a678e849bfb`.

## Scope / Guardrails
- Base `origin/feat/engram-e2-integration` (`d22fc3f24`); PR targets `feat/engram-e2-integration`.
- Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
- Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
- Pin files only: no src, range, version or product change.
- Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/evidence/memory-mcp-l5/l0-freeze.json` (P3 content, from main #769)
  - `tools/memory-mcp-l5/proof-catalog-v1.json` (P3 content, from main #769)
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (P3 manifest, from main #769)
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256` (P3 pin)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `tools/memory-mcp-l5/artifacts/history/**` (immutable history stays)
  - `packages/cluster-mesh/src/**`
  - `packages/cluster-mesh/assets/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - _none_
- **Exception process**:
  - _none required_

## Feedback Loop
- [x] `C6-FREEZE.md` has no integration counterpart (E0/E6 lot file keeping its own P2 line); the re-pin ports the P3 generation files that exist on integration: the two content files plus manifest and sidecar, so the freeze check stays coherent.
- [x] Frozen sha256 verified after the change: l0-freeze `0541b15b…`, catalog `9bf377b7…`, manifest `1c96bada…` (sidecar contains the manifest hash).
- [x] Retained history (`2b85ff28`, `f2b094ae` generations) untouched.
- [ ] Push draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one integration fix; no delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code changes; no test campaign (pin files only, hashes verified byte for byte).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Branch setup**: worktree `tmp/worktrees/p3-repin` on the integration base; `harness check branch` PASS.
- [x] **Lot 1 — Re-pin**: copy the four P3 files from `origin/main`; verify the three frozen sha256.
- [ ] **Lot 2 — Final validation**
  - [ ] `make scope-check` before commit; commits under 150 lines via `make commit`.
  - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify validate-cluster-mesh green without merging.
