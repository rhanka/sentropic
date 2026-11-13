# Feature: Bounded isolated data-plane qualification

## Objective
- [ ] Repair the qualification workload, cancellation, private fixtures and custody verification roles.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/sandbox-node-dpq`; branch: `fix/sandbox-node-data-plane-qual`; base: `origin/main`.
- [x] Make-only, Docker-first; `ENV=test-sandbox-dpq` last; no VM access and no merge.
- [x] Ports: API 9460, UI 5660, Maildev 1560; check availability before tests.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/sandbox-node/**`
  - `api/src/services/artifacts/live/**`
  - `api/tests/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No exceptions declared.

## Feedback Loop
- [x] Packet references merged #1022; fetched `origin/main` is `87485f912` (#1020). Use the actual origin/main ancestry.

## AI Flaky tests
- [x] No AI tests apply.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; independent code reviews after local validation.

## UAT Management (in orchestration context)
- [x] Real runsc qualification remains operator-owned; no VM access in this lane.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read mandatory rules, packet, template and qualification implementation; mechanical branch check passed.
- [ ] **Lot 1 — Workload and runtime readiness**
  - [x] Reproduce missing source parent permissions in `tests/bundle.test.ts`; failed before fix (0700), corrected to 0755.
  - [ ] Test actual generated qualification spec and long-lived HTTP/WS fixture.
  - [ ] Reject early launcher exit and unavailable port targets in `tests/runtime-adapter.test.ts`.
- [ ] **Lot 2 — Bounded execution and cleanup**
  - [ ] Test deadline, signal interruption, scope/sandbox exit, hanging probes and finalization.
  - [ ] Use private copied bases, remove relay directories and refuse stale qualification resources.
  - [ ] Apply private fixture handling to isolation qualification and its tests.
- [ ] **Lot 3 — Custody keys**
  - [ ] Separate custody verification/signing configuration and enforce cross-use refusal both ways.
  - [ ] Update node/API custody tests and operator installation instructions.
- [ ] **Lot 4 — Final validation**
  - [ ] Run scoped `make check-sandbox-node` with all ports, then relevant API checks.
  - [ ] Rebuild and verify archive through `docker-slot.sh`; record SHA-256 and internal sums.
  - [ ] Obtain independent code reviews and resolve findings.
  - [ ] Push, open PR using this file and verify green CI on exact head; do not merge.
  - [ ] Run `make down-volumes ENV=test-sandbox-dpq`.
  - [ ] Write French report and completion marker under `.tmp/rv/`.
