# Feature: feat(artifacts): #861 L2 — preserve and project typed failures

## Objective
- [x] Implement spec r2 E1–E3 in the exclusive L2 modules; prepare HTTP/MCP projection for L6.
## Scope / Guardrails
- [x] Base: feat/artifacts-861-contracts at a5bfbacef; worktree tmp/worktrees/artifacts-861-L2.
- [x] Make-only; ENV=test-artifacts-861-723 last; no services, no Python; merge L0 only, never merge the PR.
- [x] Spec r2 SHA-256 e0bffcf079bddaf5fcef8b4232100b821f5efd225a7ffb92a239ea4b540ea9a4 verified; Q0 read-only.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/failures.ts`
  - `packages/artifacts/src/server/outcome-projection.ts`
  - `packages/artifacts/tests/provider-failures.test.ts`
  - `packages/artifacts/l0-freeze/**`
  - `packages/artifacts/tests/commit-contract.test.ts`
  - `packages/artifacts/tests/effective-profile.test.ts`
  - `packages/artifacts/docs/common-contract-map.md`
  - `packages/artifacts/docs/migration-inventory-l0.md`
  - `packages/artifacts/README.md`
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
- [x] BR861-L2-EX1: owner explicitly requested merging the L0 fix wave without rebase. The additional allowed paths are inherited merge-only L0 changes at d4bd43b3c; no direct L2 edits. Impact: updated declaration/test/docs baseline. Rollback: revert the merge with first parent as mainline. Both parents preserve the same .track tree.
- [ ] L2-CONTRACT: L0 predates r2 and lives outside src/rootDir; define r2 types inside allowed failures.ts, with L6 to export the frozen public subpath. No L0 edits.
- [ ] L2-VERSION: r2 §6 reserves shared manifests to the integrator after the wave; mandatory PR bump remains that owner's gate. package.json unchanged; workflow dispatch on this stacked PR does not exercise the PR-only bump job.
- [ ] L2-INTEGRATION: real-provider execute/adapter wiring is exclusively L6; stage-2 acceptance qualifies classifier and both projectors.
- [ ] L2-RADAR: pinned 3fc55b4f4 helper still probes retired takeTypedCause/setFinalizeAuthorization and old selection names; Radar/L6/L8 must rebind r2, never emulate those slots.
- [ ] L2-CI (blocked; integration owner): run 39835817986 validates artifacts including integration/pack/probe, but four global builds fail the audit gate on locked DOMPurify 3.4.14 (critical GHSA-cg2g-xh64-v4q7, high GHSA-mrv2-3pqr-j5jr). A three-line lock-only 3.4.17 patch is prepared in tmp/l2-evidence/dompurify-3.4.17.patch; the unchanged audit gate passes on that isolated proposal. Shared lock remains outside L2 scope; no suppression. Acceptance: apply through the owning security/base lane and obtain a green full workflow on the rebased L2 head.
## AI Flaky tests
- [x] No AI tests or nondeterministic external services required.
## Orchestration Mode (AI-selected)
- [x] Multi-branch: independent L2 lane parallel with L1/L3; integration owned by conductor.
## UAT Management (in orchestration context)
- [x] No UI; real-provider Radar acceptance remains L6/L8, pinned Radar 3fc55b4f4.
## Plan / Todo (lot-based)
- [x] Merge L0 repair d4bd43b3c, retaining L2 BRANCH.md and all upstream atomic commit identities; the merge includes inherited changes, with authored correction commits below 150 lines.
- [x] Astra P2-1: 401/404/410 refusal regressions fail before the fix (3 failed / 76 passed); only guard 503 can advertise retry. Assert classifier and encoded MCP retry, retaining same-key/fresh-guard outage semantics.
- [x] Lot 0: rules, r2 §6/E1–E5, Q0 and L0 inspected; harness branch check passed.
- [x] Lot 1: all 76 vectors fail individually on an isolated git archive of L0 a5bfbacef; real-app baseline capture confirms S3 500/internal_error and typed lost connection 409/conflict (ports injected below app, no probe).
- [x] Lot 2: implement failures.ts and outcome-projection.ts; E2/E3 matrix, trusted seam, cause retention and redaction.
  - [x] Guard outage 503 always projects capability_unavailable/retriable true; 403 policy denial stays non-retriable (host flag cannot reverse either rule).
  - [x] Project sanitized HTTP/platform AppToolResult; expose a pure ledger descriptor (host owns durable invocation deduplication).
  - [x] Define r2 outcomes, typed operation errors and full-scope/key contention marker in failures.ts; coordinator supplies commit state.
  - [x] Implement code/typed-cause classification, trusted host mapper and non-enumerable original cause; never classify from driver messages.
- [x] Lot 3: scoped/full artifacts tests, typecheck/lint, mechanical scope before each atomic commit (<150 lines).
  - [x] make typecheck-artifacts test-artifacts ENV=test-artifacts-861-L2: 28 files, 292 tests passed, including all 76 L2 vectors.
  - [x] make lint-artifacts ENV=test-artifacts-861-L2 passed after the guard correction; no services or AI tests required.
- [ ] Lot 4: push; draft PR based on L0 with this body; green CI; report SHA/run/ambiguities; do not merge.
  - [x] Draft PR #723 targets feat/artifacts-861-contracts; exact L2 scope only, no merge.
  - [ ] Full CI green: waiting for the integration-owned DOMPurify correction; final-head artifacts qualification is being refreshed.
