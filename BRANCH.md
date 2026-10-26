# Feature: Memory L5 qualification of engram 0.21.2

## Objective
- [ ] Accept L5-MEMORY-V1 only after all proofs pass against the exact candidate.
## Scope / Guardrails
- [x] Branch `qual/memory-l5-candidate-0212`; worktree `tmp/worktrees/mem-l5`; rebased base `7815a2a8569f44f220fd4daa5e41dae992618e30`.
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
- [x] Owner clarification: official Docker targets using `--rm` are allowed under the shared flock; no ad-hoc Docker recipe is allowed.
- [x] Main has only pre-candidate Lot 1; [producer audit](spec/evidence/memory-mcp-l5/candidate-0212/PRODUCERS.md) identifies absent source suites, later lots and predecessor integrations.
- [x] FAIL evidence: [qualification report](spec/evidence/memory-mcp-l5/candidate-0212/REPORT.md); no runtime qualification or receipt claimed.
## AI Flaky tests
- [x] No waiver and no missing proof treated as passed.
## Orchestration Mode (AI-selected)
- [x] Mono-branch; sequential evidence collection; no subagents.
## UAT Management (in orchestration context)
- [x] Deployed host bindings, native SQLite/PostgreSQL and key cleanup remain unverified.
## Plan / Todo (lot-based)
- [x] Lot 0: verify archive digests, P2 binding, mechanical branch and harness constraints.
- [x] Evidence collector: reproducible read-only inspection; no catalog proof substituted.
- [x] Input snapshots: P2 archives, packed surface, all registry hashes and external publisher receipt verified.
- [x] Execution evidence: existing gate dry run only; shared-lock make down completed; no test stack started.
- [x] Lot 1: audit candidate/catalog; record FAIL with missing P01-P09 files and unexecuted P10; no receipt.
- [x] Lot 2: evidence pushed; draft PR #762 opened; no merge authorized or performed.
- [x] Attempt 2: verify archive digests and unchanged P2; rebase existing PR onto origin/main; audit every official proof producer.
- [ ] Attempt 2 execution: official gate queued under the shared Docker flock; collect results and clean up the isolated test environment.
- [ ] Acceptance: full candidate gate and schema-valid receipt (blocked; no receipt issued).
