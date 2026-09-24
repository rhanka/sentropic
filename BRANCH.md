# Feature: Antigravity import refresh on current main

## Objective
- [ ] Refresh imported credentials before required project discovery and persist only usable accounts.

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
- [ ] **Lot 2 — Regression tests**
  - [ ] Add `api/tests/unit/antigravity-import.test.ts`: expired/near/unknown/fresh expiry, stored token, refresh/discovery/onboarding failures, missing project.
  - [ ] Run scoped tests including `api/tests/unit/antigravity-provider-auth.test.ts`.
- [ ] **Lot 3 — Final validation**
  - [ ] API suite gate, API typecheck and lint.
  - [ ] Review final diff and mechanical scope; commit specific files with plan checkboxes.
  - [ ] Stop isolated environment and verify no services remain.
