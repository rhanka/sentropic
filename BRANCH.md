# Feature: Memory MCP L5 R5 qualification
## Objective
- [ ] Qualify the exact Engram 0.22.0 candidate against retained P3; keep it outside E2.
## Scope / Guardrails
- [x] Worktree `tmp/worktrees/memory-l5-r5`; branch `feat/memory-l5-r5` from origin/main.
- [x] Make-only; shared Docker flock; pinned Node image; no Python; no rebase or merge.
- [x] `API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-memory-l5`, ENV last; no listeners needed.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/evidence/memory-mcp-l5/**`
  - `tools/memory-mcp-l5/r5-*`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
## Feedback Loop
- [x] Preserve P01-P09 proof gaps and checkpoint obligations as blockers; never weaken a gate.
- [x] R5-NATIVE: source-commit disabled gate FAIL reproduced on the real install log; false attribution to tree-sitter, retained as blocking.
## AI Flaky tests
- [x] No accepted flakes or timeout changes.
## Orchestration Mode (AI-selected)
- [x] Mono-branch: one qualifier; independent review when eligible peers are reachable.
## UAT Management (in orchestration context)
- [x] No UI change; deployed host/native stores/key cleanup remain unverified.
## Plan / Todo (lot-based)
- [x] Verify tarball SHA-256/SHA-512 and retained P3; official Lot 1 passes (104 tooling + 183 package tests).
- [x] Attempt Lot 2/3, all six packed scopes and preflight/checkpoint; retain explicit later-lot refusals.
- [x] Exact-byte supplemental producer probes pass; SDK 1.32.2 and floor 1.31.0; disabled runtime 0/0/0/0.
- [x] Supplemental probes live in `tools/memory-mcp-l5/r5-diagnostics.{mk,mjs}`; input scripts and delivery are hash-pinned.
- [ ] Record all outcomes, clean environment, create draft PR and verify successful exact-head CI.
