# Feature: Attribute disabled-install native builds to the candidate

## Objective
- [ ] Replace the historical log-wide native-build predicate with observed candidate-attributed process evidence; retain positive build controls.
## Scope / Guardrails
- [x] Worktree tmp/worktrees/memory-l5-disabled-install; branch fix/memory-l5-disabled-install; follows #842; rebase onto main before delivery.
- [x] Preserve candidate 965c93e3, P3, catalog and L0 bytes; no producer edits or gate waiver.
- [x] Make-only, shared Docker flock, pinned Node image, ports 9625/5825/1725, ENV=test-memory-l5 last; make down after.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `tools/memory-mcp-l5/**`
  - `spec/evidence/memory-mcp-l5/**`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] L5DI-EX1: the requested disabled-install fix delegates packed preparation before Vitest and forwards its JSON report; no frozen producing recipe changes. Rollback this delegation only.
## Feedback Loop
- [x] Reproduced historical predicate failure: tree-sitter-lua node-gyp log line was attributed to memory; no demonstrated memory-native compilation in R5.
- [ ] Independent reviews and exact-head CI remain required; no merge or publication.
## AI Flaky tests
- [x] No waiver or timeout change.
## Orchestration Mode (AI-selected)
- [x] Sequential dependent PR; code author; complementary independent review when reachable.
## UAT Management (in orchestration context)
- [x] No product UAT; actual owner assurance/provenance gates stay pending.
## Plan / Todo (lot-based)
- [x] Lot 1: add native process observer and candidate-root attribution predicate; tests/disabled-install.test.mjs ignores unrelated tree-sitter and catches a real node-gyp invocation.
  - [x] Retain the producer observer as an L5-owned tool; record executed native commands independently of attribution, including direct node node-gyp.js builds. Candidate bytes unchanged.
  - [x] Tooling passes 139 tests, including an actual node-gyp rebuild invocation that the candidate predicate blocks and the unrelated tree-sitter refusal regression.
- [ ] Lot 2: run ordinary candidate installation with scripts and optional dependencies enabled; retain logs, trace and positive control; wire packed/disabled-install.test.ts and make target.
  - [x] Add the ordinary-install runner, packed disabled/exports cases and make delegation; execution on exact bytes remains part of the final run. Retain compressed logs/traces and compact hashed JSON.
- [ ] Lot 3: tooling/scope checks, review dossier, draft PR and exact-head CI; cleanup.
  - [x] Resume fix: prepare ordinary installation before the packed assertion, validate retained hashes and tuple, preserve the five-second timer and the native positive control.
  - [x] Revalidated final observer bytes: 140 tooling tests pass; exact-candidate packed disabled-install passes with two positive-control observations and no candidate native build. CI/review remain separate pending gates.
