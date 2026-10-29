# Feature: Rerun L5 on the exact Engram 0.22.0 candidate

## Objective
- [ ] Retain the exact 965c93e3 candidate manifest, full L5 attempt, per-case bundle and strict checkpoint verdict without inventing acceptance.
## Scope / Guardrails
- [x] Worktree tmp/worktrees/memory-l5-r5-checkpoint; branch feat/memory-l5-r5-checkpoint; follows #843; preserve producer/P3/catalog/L0 bytes.
- [x] Make-only, shared Docker flock, pinned Node image, ports 9625/5825/1725, ENV=test-memory-l5 last; cleanup after.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `tools/memory-mcp-l5/**`
  - `spec/evidence/memory-mcp-l5/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
## Feedback Loop
- [ ] No signed owner UAT, L0 authorization or role acceptance is fabricated. List exact minimal actions.
- [ ] Separate ordinary-install attribution from remaining inventory, installed proof and provenance gates.
- [ ] Final-head CI and independent complementary reviews remain required; no merge.
## AI Flaky tests
- [x] No waiver or timeout change.
## Orchestration Mode (AI-selected)
- [x] Sequential dependent PR; exact-byte qualification with retained rejected proposals when gates fail.
## UAT Management (in orchestration context)
- [ ] Record authenticated owner pass or authorized L6/L8 deferral only when actually supplied.
## Plan / Todo (lot-based)
- [ ] Lot 0: verify candidate SHA-256/SHA-512, producer P3/source/peer binding and registry mesh archive; assemble immutable inputs and manifest.
  - [x] Add exact-byte input collector; the registry mesh source commit comes from the archive-bound SLSA payload, with signature authentication explicitly unestablished.
  - [x] Independently measured candidate SHA-256/SHA-512 and P3/source/peer bindings match; mesh 0.22.4 archive integrity and SLSA subject match. Retain exact archive bytes and observed source 440599d04e91bb33e3874588f067c6a90bffd1b3 without claiming authenticated acceptance.
- [ ] Lot 1: run memory-l5-qualify; retain every command/exit, raw assertions, native positive controls, manifest and strict checkpoint proposal/result.
  - [x] Add process-time report binding with immutable raw JSON retention; source-only reports retain that mode and cannot become installed E4 evidence.
- [ ] Lot 2: document the actual verdict and exact remaining owner actions, scope/review/CI checks, PR and cleanup; do not issue a false L5 acceptance.
