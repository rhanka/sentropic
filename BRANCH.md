# Feature: A-LIVE tools and encrypted retained drafts

## Objective
- [ ] Deliver AL-T and AL-D from frozen G0 v3 / A-LIVE v2, including Immo R1–R5.

## Scope / Guardrails
- [x] Wagon for train/artifacts-0.2.18; push branch only; no PR or version/lock changes.
- [x] Worktree tmp/worktrees/live-tools; ENV=test-live-tools; API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590.
- [x] Existing images only; no local image builds, Python, secret output or clean-all.
- [x] Commits through make commit, fewer than 150 lines, selective staging and scope check.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; scope=lock maintenance; rollback=restore the previously qualified lock.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/migrations/**`
  - `packages/artifacts/docs/live-tools.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `**/package*.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Record rationale, impact and rollback before any conditional change.

## Feedback Loop
- [x] Track import belongs to the train's designated writer; this branch is its mergeable source artifact.
- [x] Approved frozen contracts replace a new design cycle; AL-P/AL-I integration remains with their lanes.

## AI Flaky tests
- [x] No AI-dependent tests in this lane.

## Orchestration Mode (AI-selected)
- [x] Mono-branch wagon; integration lane merges it into the train.

## UAT Management (in orchestration context)
- [ ] Train qualifies owner edit/HMR/commit/idle publication with AL-P/AL-I; this lane qualifies server contracts.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read binding contracts, create isolated worktree and mechanically check branch.
- [ ] Lot 1 — Tests first: live-draft conformance (memory/Postgres), live service and frozen catalogue.
  - [x] Specify shared vault durability, CAS, cap, replay and expiry behaviors before implementation.
- [x] Lot 2 — Encrypted immutable drafts, atomic pointers/results and TTL tombstones; memory 5/5 and Postgres 6/6.
- [ ] Lot 3 — Five tools, typed failures, source policy, exact snapshot commit and transport wiring.
  - [x] Five definitions appended after G0; service snapshot/recipe, A1 refusal and drift/reset tests pass 4/4.
- [ ] Lot 4 — Scoped tests, typecheck/lint, evidence and branch push.
  - [ ] tests/live-drafts.test.ts and tests/live-drafts.integration.test.ts.
  - [ ] tests/live-tools.test.ts and tests/live-tools-transport.test.ts.
  - [ ] tests/tools-list-snapshot.test.ts; deliberate 24 to 35 catalogue extension.
  - [ ] Run make down-volumes ENV=test-live-tools and disk-hygiene when available.
