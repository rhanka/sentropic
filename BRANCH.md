# Feature: Memory MCP L5 R5 qualification
## Objective
- [x] Evaluate the exact Engram 0.22.0 candidate against retained P3: **NOT QUALIFIED**; keep it outside E2.
## Scope / Guardrails
- [x] Worktree `tmp/worktrees/memory-l5-r5`; branch `feat/memory-l5-r5` from origin/main.
- [x] Make-only; shared Docker flock; pinned Node image; no Python; no rebase or merge.
- [x] `API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-memory-l5`, ENV last; no listeners needed.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/evidence/memory-mcp-l5/**`
  - `tools/memory-mcp-l5/r5-*`
  - `.github/workflows/ci.yml` (BRR5-EX1)
  - `scripts/ci/ci-expected-results.test.mjs` (BRR5-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
## Feedback Loop
- [x] BRR5-EX1: required exact-head CI is blocked by reproduced GitHub HTTP 502 on current-attempt job pages of 100; pages of 30 succeed. Allow only collector/final-guard pagination and its existing contract test. Impact: more API requests, same complete job set, identities, permissions and fail-closed verdict. Rollback: restore both page sizes and the fixture expectation; no gate waiver.
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
- [x] Record all outcomes in `spec/evidence/memory-mcp-l5/r5-result.md`; no accepted checkpoint.
- [x] Cleanup: `make down` completed; `make ps` empty for the isolated environment.
- [x] Prepare this file as draft PR body; retain the branch plan and do not merge.
- [x] CI delivery rule: require completed/success on the exact final head and record the run/head at delivery.
- [x] Independent review selection unavailable; `r5-review.md` records no dispatched peers or consensus.
- [x] BRR5-EX1: `make test-ci-expected-results` passes 24 tests; `make memory-l5-tooling` passes 104 again. Evidence in `r5-ci-pagination.json`; scope/cleanup precede commit and successful CI on the resulting final head remains the delivery condition.
