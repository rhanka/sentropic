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
- [ ] Preserve missing proof/checkpoint obligations as blockers; never weaken a gate.
## AI Flaky tests
- [x] No accepted flakes or timeout changes.
## Orchestration Mode (AI-selected)
- [x] Mono-branch: one qualifier; independent review when eligible peers are reachable.
## UAT Management (in orchestration context)
- [x] No UI change; deployed host/native stores/key cleanup remain unverified.
## Plan / Todo (lot-based)
- [ ] Verify delivery and P3; run existing memory-l5 gates and reproduce disabled install.
- [ ] Record all outcomes, clean environment, create draft PR and verify successful exact-head CI.
