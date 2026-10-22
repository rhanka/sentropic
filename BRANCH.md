# Feature: feat(artifacts): #861 L2 — preserve and project typed failures

## Objective
- [ ] Implement spec r2 E1–E3 in the exclusive L2 modules; prepare HTTP/MCP projection for L6.
## Scope / Guardrails
- [x] Base: feat/artifacts-861-contracts at a5bfbacef; worktree tmp/worktrees/artifacts-861-L2.
- [x] Make-only; ENV=test-artifacts-861-L2 last; no services, no Python, no merge.
- [x] Spec r2 SHA-256 e0bffcf079bddaf5fcef8b4232100b821f5efd225a7ffb92a239ea4b540ea9a4 verified; Q0 read-only.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/failures.ts`
  - `packages/artifacts/src/server/outcome-projection.ts`
  - `packages/artifacts/tests/provider-failures.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `.github/workflows/**`
  - `packages/artifacts/src/http.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/src/adapters/**`
- **Conditional Paths (explicit owner clarification required)**:
  - `packages/artifacts/package.json`
## Feedback Loop
- [ ] L2-CONTRACT: L0 predates r2 and lives outside src/rootDir; define r2 types inside allowed failures.ts, with L6 to export the frozen public subpath. No L0 edits.
- [ ] L2-VERSION: mandatory CI bump conflicts with exclusive scope and frozen workspace/probe; owner clarification pending.
- [ ] L2-INTEGRATION: real-provider execute/adapter wiring is exclusively L6; stage-2 acceptance qualifies classifier and both projectors.
## AI Flaky tests
- [x] No AI tests or nondeterministic external services required.
## Orchestration Mode (AI-selected)
- [x] Multi-branch: independent L2 lane parallel with L1/L3; integration owned by conductor.
## UAT Management (in orchestration context)
- [x] No UI; real-provider Radar acceptance remains L6/L8, pinned Radar 3fc55b4f4.
## Plan / Todo (lot-based)
- [x] Lot 0: rules, r2 §6/E1–E5, Q0 and L0 inspected; harness branch check passed.
- [x] Lot 1: all 73 vectors fail individually on L0; real-app baseline capture confirms S3 500/internal_error and typed lost connection 409/conflict (ports injected below app, no probe).
- [ ] Lot 2: implement failures.ts and outcome-projection.ts; E2/E3 matrix, trusted seam, cause retention and redaction.
  - [x] Define r2 outcomes, typed operation errors and full-scope/key contention marker in failures.ts; coordinator supplies commit state.
  - [x] Implement code/typed-cause classification, trusted host mapper and non-enumerable original cause; never classify from driver messages.
- [ ] Lot 3: scoped/full artifacts tests, typecheck/lint, mechanical scope before each atomic commit (<150 lines).
- [ ] Lot 4: push; draft PR based on L0 with this body; green CI; report SHA/run/ambiguities; do not merge.

