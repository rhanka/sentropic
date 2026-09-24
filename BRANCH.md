# Feature: Antigravity import refresh on current main

## Objective
- [x] Refresh imported credentials before required project discovery and persist only usable accounts.

## Scope / Guardrails
- [x] Branch `fix/antigravity-import-refresh-v2`; worktree `tmp/antigravity-import-v2`; base `75032fc85`.
- [x] Make-only, Docker-first; `ENV=test-antigravity-import-v2` always last.
- [x] Ports: `API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510`; verified free.
- [x] No push, PR, merge, publication, migration, or package version bump.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `api/src/services/provider-connections.ts`
  - `api/src/services/antigravity-provider-auth.ts`
  - `api/tests/**` (Antigravity/provider-connection tests only)
  - `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - All paths not explicitly allowed, including `Makefile`, `docker-compose*.yml`, `.github/workflows/**`, migrations.
- [x] **Conditional Paths**: none.
- [x] **Exception process**: stop and record a blocked item for any required forbidden change.

## Feedback Loop
- [x] B-01 | attention | owner: implementation | Refresh unknown/invalid expiry as well as expiry within 60 seconds; unknown freshness cannot establish a usable token.
- [x] B-02 | attention | owner: implementation | Preserve optional profile lookup and existing project normalization; require discovery and onboarding before storage.
- [x] B-03 | attention | owner: implementation | Skip harness event recorders because their writes fall outside the explicit allowed paths; mechanical branch/scope checks remain required.
- [x] B-04 | attention | owner: implementation | Concurrent initial `up-api-test` and `typecheck-api lint-api` collided in shared dependency installation (`ENOTEMPTY`/`ENOENT`); sequential startup retry passed, scoped tests passed; remaining gates run sequentially.
- [ ] B-05 | blocked | owner: conductor | First full API gate: smoke 13 passed; unit 1001 passed, 2 skipped, 1 failed (`track-event-owner-signature-port.test.ts:192`, cross-process test, 15000ms timeout). `make test-api-unit SCOPE=tests/unit/track-event-owner-signature-port.test.ts API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510 ENV=test-antigravity-import-v2` passed all 6 tests. Acceptance: complete full API gate after infrastructure recovery; no flaky acceptance or timeout change.
- [ ] B-06 | blocked | owner: conductor/infrastructure | Full API retry failed in `prepare-node-workspace`: Docker image commit `lease does not exist: not found` (ref `sha256:1760adee2503209cfd6c6579b7cf4a25b21f61bf758c350149e8f54cce903a70`). Before shutdown, API logs also reported missing generated `@sentropic/focus/dist/hono.js` following interrupted preparation. Scope: environment/build recovery, no source repair in this lot. Acceptance: healthy rebuilt stack and green exact full API command below.

## AI Flaky tests
- [x] No flaky acceptance authorized.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single implementation agent; no history transfer.

## UAT Management (in orchestration context)
- [x] API-only change; deterministic mocked provider tests cover import outcomes. Live credentials are not supplied.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read required rules/template and original commit; verify branch mechanically and inspect current import/storage.
- [x] **Lot 1 — Import correction**
  - [x] Refresh stale credentials with existing helper and persist returned tokens/expiry.
  - [x] Surface typed refresh/discovery/onboarding failures and explicit missing project failure.
- [x] **Lot 2 — Regression tests**
  - [x] Add `api/tests/unit/antigravity-import.test.ts`: expired/near/unknown/fresh expiry, stored token, refresh/discovery/onboarding failures, missing project.
  - [x] PASS (30 tests): `make test-api-unit SCOPE="tests/unit/antigravity-import.test.ts tests/unit/antigravity-provider-auth.test.ts tests/unit/antigravity-routing.test.ts" API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510 ENV=test-antigravity-import-v2`.
- [ ] **Lot 3 — Final validation**
  - [x] PASS: `make typecheck-api lint-api API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510 ENV=test-antigravity-import-v2` (lint: zero errors, 207 warnings).
  - [ ] FAIL twice: `make test-api API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510 ENV=test-antigravity-import-v2`; see B-05/B-06. Endpoint, queue, security, AI and limit stages were not reached.
  - [x] Review final diff and mechanical scope; commit specific files with plan checkboxes.
  - [x] PASS: `make down API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510 ENV=test-antigravity-import-v2`; `make ps API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510 ENV=test-antigravity-import-v2` confirms no remaining services.
