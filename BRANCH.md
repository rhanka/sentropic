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
- [x] Lot 1 — Tests first: live-draft conformance (memory/Postgres), live service and frozen catalogue.
  - [x] Specify shared vault durability, CAS, cap, replay and expiry behaviors before implementation.
- [x] Lot 2 — Encrypted immutable drafts, atomic pointers/results, TTL tombstones, key rotation and collection; memory 9/9 and Postgres 11/11.
- [x] Lot 3 — Five tools, typed failures, source policy, exact snapshot commit and transport wiring.
  - [x] Five definitions appended after G0; service snapshot/recipe, A1 refusal and drift/reset tests pass 4/4.
- [ ] Lot 4 — Scoped tests, typecheck/lint, evidence and branch push.
  - [x] tests/live-drafts.test.ts and tests/live-drafts.integration.test.ts.
  - [x] tests/live-tools.test.ts, live-tools-races.test.ts, live-tools-pages.test.ts, live-tree.test.ts, live-body.test.ts and live-tools-transport.test.ts.
  - [x] tests/tools-list-snapshot.test.ts; deliberate 24 to 35 catalogue extension; all 24 original definitions unchanged.
  - [x] Scoped memory/transport/profile/GitPort verification: 269 tests pass; Postgres 11 pass; typecheck and changed-file lint pass.
  - [ ] Run make down-volumes ENV=test-live-tools and disk-hygiene when available.
