# Feature: feat(memory-l5): Lot 2 durable reference

## Objective
- [ ] Implement durable workflow reference and fail-closed P3/E2 receiving harness; retain missing host acceptance explicitly.
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
  - `tools/memory-mcp-l5/lot2*.mjs`
  - `tools/memory-mcp-l5/verifier.mjs`
  - `tools/memory-mcp-l5/policies/**`
  - `tools/memory-mcp-l5/tests/lot2*`
  - `spec/evidence/memory-mcp-l5/lot2/**`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] L5L2-EX1: bounded Makefile Lot 2 delegation/manifest forwarding; local/CI parity; rollback added wiring only.
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
- [ ] Lot 1: store/policy/recovery/confirmation/crash tests specified; verifier and manifest tests next.
- [ ] Lot 2: implement reference export/transactions/fences/policy persistence and assurance verifier.
- [ ] Lot 3: wire strict manifest receiving gate; retain immutable E4; run tooling/typecheck/lint and reference tests.
- [ ] Lot 4: report blocked acceptance, review, push draft PR to main and verify CI; do not merge.
