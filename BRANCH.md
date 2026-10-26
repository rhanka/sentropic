# Feature: feat(memory-l5): Lot 2 durable reference

## Objective
- [x] Implement durable workflow reference and fail-closed P3/E2 receiving harness; retain missing host acceptance explicitly.
## Scope / Guardrails
- [x] Worktree tmp/worktrees/mem-l5-lot2; branch feat/memory-l5-lot2; base origin/fix/memory-l5-p09-p3; merge only.
- [x] Preserve catalog, l0-freeze and P3 bytes; no Python; shared Docker lock; ENV=test-mem-l5-lot2 last.
- [x] Disposable official containers only; ports 9625/5825/1725; no application services required.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/mcp-broker/src/memory-reference/**`
  - `packages/mcp-broker/tests/memory/**`
  - `packages/mcp-broker/package.json`
  - `packages/mcp-broker/README.md`
  - `package-lock.json`
  - `tools/memory-mcp-l5/lot2*.mjs`
  - `tools/memory-mcp-l5/verifier.mjs`
  - `tools/memory-mcp-l5/import-graph.mjs`
  - `tools/memory-mcp-l5/policies/**`
  - `tools/memory-mcp-l5/tests/lot2*`
  - `tools/memory-mcp-l5/tests/receipt-contract.test.mjs`
  - `spec/evidence/memory-mcp-l5/lot2/**`
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] L5L2-EX1: bounded Makefile Lot 2 delegation/manifest forwarding; local/CI parity; rollback added wiring only.
  - [x] L5L2-EX2: update only broker workspace version in package-lock.json; retain frozen P3 lock snapshot; rollback this scalar.
  - [x] L5L2-EX3: CI uses explicit source/reference mode with historical P3 validation; strict qualification remains unchanged. Required after the new broker version; rollback only this CI mode/wiring.
## Feedback Loop
- [ ] gr-conductor: real P3-bound lot2-manifest/sidecar, E2/backend/neutral/profile/lock closure and G1–G4/C9 receipts pending; fixture is unverified.
- [ ] Owner/Engram: authoritative enrollment/assurance mapping and current L0 role dispositions pending; no deployed identity acceptance.
## AI Flaky tests
- [x] Deterministic storage/security tests; no waiver.
## Orchestration Mode (AI-selected)
- [x] Mono-branch; implementation by author; independent review per harness review skill.
## UAT Management (in orchestration context)
- [x] No UI change; reference/receiving harness only; final E4 and owner UAT remain later lots.
## Plan / Todo (lot-based)
- [x] Lot 0: read lock/schedule/spec/template; verify mechanical branch and immutable baseline.
- [x] Lot 1: six reference test files, signed-token corpus and manifest refusal tests specified; first store run fails on missing reference module.
  - [x] `packages/mcp-broker/tests/memory/sqlite-workflow-store.test.ts`
  - [x] `packages/mcp-broker/tests/memory/sqlite-workflow-crash.test.ts` and `fixtures/workflow-child.mjs`
  - [x] `packages/mcp-broker/tests/memory/mutation-recovery.test.ts`
  - [x] `packages/mcp-broker/tests/memory/policy-version-persistence.test.ts`
  - [x] `packages/mcp-broker/tests/memory/confirmation-continuation.test.ts`
  - [x] `packages/mcp-broker/tests/memory/oidc-assurance.test.ts`
  - [x] `tools/memory-mcp-l5/tests/lot2-{assurance,manifest,retained-inputs,envelope,canonical-report}.test.mjs`
- [x] Lot 2: reference persistence and signed qualification assurance implemented; production policy refuses pending authoritative mappings.
- [x] Lot 3: reference 66/tooling 112 passed; full source gate passed; reference archive and complete hashed reports retained; absent/unverified manifest refusals passed; Node 24.21.0/SQLite 3.53.4 WAL/FULL, no Python executable.
  - [x] Namespace-only recovery lookup regression reproduced and fixed; reference archive and reports refreshed; import/export graph passed with 55 files/114 edges.
  - [x] Canonical report guard rejects source-only/cross-tuple results; all five real E2 cases are mandatory before Lot 2 can close.
  - [x] Malformed host configuration/driver digests refuse; receiving-harness suite passed 112 tests; retained report refreshed.
- [ ] Lot 4: report blocked acceptance, review, push draft PR to main and verify CI; do not merge.
