# Feature: #861 L8d complete integration requalification

## Objective
- [ ] Qualify packed artifacts 0.2.0 and cluster-mesh 0.22.0 against the pinned full Radar consumer.

## Scope / Guardrails
- [x] Worktree tmp/worktrees/861-L8d; branch feat/artifacts-861-L8d; no rebase.
- [x] ENV=test-861-l8d last; ports API 18924, UI 15924, Maildev 11924.
- [x] Shared Docker lock and matching Compose down after every step; no publication.
- [x] Merge 895e67f97 preserves integration 082fe4c60 and #744/#747/#748; Track unchanged.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/probe/l8d/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/cluster-mesh/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Requested merge preserves reviewed product changes; new lane edits stay within qualification scope.

## Feedback Loop
- [x] Radar integration b2b802b5 plus acceptance/helper overlay e2e9515; A1/A2 ancestry checked by pin-radar.
- [x] #748 promotes ERESOLVE/TS2307 reproductions to normal assertions; no TODO acceptance.
- [ ] Record Q1/Q2 missing-contract failures separately from Radar's scoped listKeys test defect.

## AI Flaky tests
- [x] No flaky acceptance; failures and skips prevent qualification.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: this lane owns packed consumer evidence; product and Radar fixes retain their owners.

## UAT Management (in orchestration context)
- [x] Package qualification only; no production activation claim.

## Plan / Todo (lot-based)
- [x] Lot 0 — verify branch and merge complete integration without rebase.
- [ ] Lot 1 — rebuild and pack candidate; strict full-Radar install; archive runtime and declaration compilation.
- [ ] Lot 2 — execute eight Radar suites with gate 1; retain exact source hashes and counts.
- [ ] Lot 3 — fail-closed receipt/shard validation; update receipt, scope check, atomic commits and push PR #746.

## Deferred to L9
- [x] Published bytes, provenance and activation require separate release gates.
