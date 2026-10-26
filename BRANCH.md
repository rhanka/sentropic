# Feature: Memory L5 qualification of engram 0.21.2

## Objective
- [ ] Accept L5-MEMORY-V1 only after all proofs pass against the exact candidate.
## Scope / Guardrails
- [x] Branch `qual/memory-l5-candidate-0212`; worktree `tmp/worktrees/mem-l5`; base `6c3f9f04a01bca460977428f0632e0a38b74ab13`.
- [x] Candidate/P2 immutable; no implementation, dependency, workflow or proof changes; no Python.
- [x] Make-only; Docker lock; commits below 150 changed lines; no attribution trailers.
- [x] Gate: API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-memory-mcp-l5 (ENV last).
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/evidence/memory-mcp-l5/candidate-0212/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `tools/memory-mcp-l5/**`
  - `packages/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `scripts/**` (none planned).
- **Exception process**:
  - [x] Record explicit exception before extending scope; none planned.
## Feedback Loop
- [x] Main has only pre-candidate Lot 1; candidate proof files are missing; standalone Docker recipes violate the mandatory lock policy.
## AI Flaky tests
- [x] No waiver and no missing proof treated as passed.
## Orchestration Mode (AI-selected)
- [x] Mono-branch; sequential evidence collection; no subagents.
## UAT Management (in orchestration context)
- [x] Deployed host bindings, native SQLite/PostgreSQL and key cleanup remain unverified.
## Plan / Todo (lot-based)
- [x] Lot 0: verify archive digests, P2 binding, mechanical branch and harness constraints.
- [x] Evidence collector: reproducible read-only inspection; no catalog proof substituted.
- [ ] Lot 1: audit candidate/catalog; record FAIL evidence; push draft PR without merging.
- [ ] Acceptance: full candidate gate and schema-valid receipt (blocked; no receipt issued).
