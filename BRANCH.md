# Feature: L8c commit failure and transport parity qualification

## Objective
- [ ] Qualify spec r2 E3 through separate HTTP/MCP processes and retain known product failures.

## Scope / Guardrails
- [x] Make-only; shared Docker lock; no host runtime or Python.
- [x] Worktree: `tmp/worktrees/861-L8c`; branch: `feat/artifacts-861-L8c`.
- [x] Environment: `test-861-l8c`; API 13308, UI 9508, Maildev 5408; Compose qualification publishes no ports.
- [x] Radar read-only pins: A1 `f2b6c25cc9458ec285d6d4f620a55dad8c30f909`, A2 `b104ae90a28a5581e8eabd15f12acb58558d3396`, Q2 `e2e9515ea41baebf5539743f0cfa0dea750d072c`.
- [x] Radar BASE #910 retires the route called by `packages/immo-mcp/src/data-source.ts:316`; current main is not a substitute pin.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/tests/commit-failure-parity.integration.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/**`
  - `packages/cluster-mesh/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No scope exceptions; product defects return to their lot owner with a reproducer.

## Feedback Loop
- [x] Runner workaround: `/tmp/861-l8c.Makefile` copies existing targets with only the qualification ENV guards expanded; SHA-256 `493237dbea196cfdbc93fc0859432b4565821ccef1d1975717627aecd101f6ad`.
- [ ] Radar Q2/Q3 runs require exact packed tuple installation and a pinned read-only checkout; no registry-baseline pass counts as candidate qualification.

## AI Flaky tests
- [x] No AI tests or flaky allowance.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**: isolated L8c qualification shard; integration owns product fixes and tuple packing.

## UAT Management (in orchestration context)
- [x] No UI change; consumer qualification belongs to the integrated packed tuple.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read Docker lock, master/workflow/testing rules, spec S4/L8c, Q1–Q4 and section 6.3.
  - [x] Create worktree, run `harness check branch`, merge L6 and refresh integration without rebasing.
- [ ] **Lot 1 — Failure matrix**
  - [x] Add `packages/artifacts/tests/commit-failure-parity.integration.test.ts` with separate child processes, real PostgreSQL coordination and E3 fault injection.
  - [ ] Assert sanitized HTTP/MCP projections, correlation, no compensating execution and write/read accounting descriptors.
  - [ ] Retain known failures with file:line evidence rather than changing another lot's implementation.
- [ ] **Lot 2 — Validation and handoff**
  - [ ] Run scoped `test-artifacts-integration`, typecheck and lint under the shared Docker lock; clean this environment after each step.
  - [ ] Run pinned Radar MCP/failure suites, or record the exact missing prerequisite without a coverage claim.
  - [ ] Run `make scope-check` before each atomic commit; selective staging; `make commit` only.
  - [ ] Push and create draft PR targeting `feat/immo-861-integration`; report SHA, results and defects.
