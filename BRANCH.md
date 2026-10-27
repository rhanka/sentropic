# chore: move memory reservation to cluster-mesh 0.24.0

## Objective
- [ ] Move the E2 memory reservation from 0.23.0 to 0.24.0 and qualify pack-only candidate 0.24.0-dev.1.

## Scope / Guardrails
- [x] Branch feat/engram-e2-repin-024; worktree tmp/worktrees/mem-repin024; integration base 18ddefad340e6970db4acf239d8b6e129ad08e28.
- [x] Inherited: approved memory batch #802, #767/#774 pack-only gates, origin/main 6690b8add51f0eb6e9147b1de702f368d7649498 with speech export and stable cluster-mesh 0.23.2; merge only.
- [x] Decision 2026-10-27: voice L1c #757 published 0.23.0 at 16:33 UTC from 47c61e5d6dcb8b4c228480fd79750efe5f43aed9. Plan lines 95/166 authorize reserved-minor substitution. Record: .tmp/engram-e2-host-tuple/RESERVATION.md and batch #802 body.
- [x] Pack-only candidate; no publication; conductor merges the draft PR.
- [x] Shared Docker flock; ENV=test-mem-batch1 last; ports API 19681, UI 19682, Maildev UI 19683; no qualification PG host ports; cleanup each lane.
- [x] Preserve P3 manifest 1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730 and Engram tarball 26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/**`
  - `package-lock.json`
  - `PLAN.md` (inherited memory integration)
  - `tools/memory-mcp-l5/**` (inherited memory integration)
  - `spec/evidence/memory-mcp-l5/**` (inherited memory integration)
  - `Makefile` (BR024-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `ui/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] Already committed origin/main changes are inherited; check authored merge resolution against that parent.
- **Exception process**:
  - [x] BR024-EX1: conductor authorizes union of all three Makefile environment selectors, retaining memory and artifacts entries. Impact: qualification/cleanup routing; rollback selectors together. Check make -n for both environments.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Synchronization and reservation**
  - [x] Resume merge; union selectors; retain this branch plan with Inherited line.
  - [x] Set candidate, train constant and selected fixtures to 0.24.0-dev.1; move both reserved-next gates and vectors to 0.24.0, retaining old-line rejection.
  - [x] Registry ordering verified against latest 0.23.1 and main 0.23.2; root lock regenerated under flock, aligning inherited artifacts 0.2.4 workspace metadata; all 370 Track events retained from both parents; authored scope C2 passes against origin/main.
  - [ ] Commit merge after final resolution checks.
- [ ] **Lot 2 — Qualification**
  - [ ] Run reserved-next/packaging tests and memory qualification: mechanical, wiring, build, typecheck, lint, memory, common, grants, postgres; cleanup each step.
  - [ ] Preserve 23 blocked E9 Stage B cases; no five-profile acceptance claim.
- [ ] **Lot 3 — Handoff**
  - [ ] Push; open draft PR against feat/engram-e2-integration with reservation history.
  - [ ] Require pull_request ci.yml completed/success on exact head; append READY-REPIN with PR and full SHA.

## Feedback Loop
- [x] Conductor authorizes the blocked selector and version resolutions; no new content decision requested.
- [x] Mechanical integration of approved lots and explicit conductor resolutions; no new delegated implementation or consensus verdict claimed.

## AI Flaky tests
- [ ] Retry failed AI/e2e jobs once only when green on main; retain evidence.

## Orchestration Mode (AI-selected)
- [x] Multi-branch integration; serial integrator; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Library and qualification routing; no web, Chrome or VS Code interaction changed by repin.
