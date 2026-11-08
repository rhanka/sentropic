# Feature: Persist remote live rows on Postgres

## Objective
- [x] `createPostgresRemoteLiveRows.update` maps `RemoteRows` `{ next, result }` to `lockedRow` `{ value, result }`, as `createPostgresBuildJobStore` does, so remote live writes (draft seal and pages, package fences, session invitation state, forge binding admit) are persisted instead of silently dropped (preprod 08/11: seal 204 then reconcile 409 `draft_not_staged`, `control.artifact_host_kv` empty; diagnosis `.tmp/rv/draft-not-staged.md`).
- [x] `lockedRow` `work` return type is strict (`value: V | undefined`, non-optional key), so a mismatched shape fails to compile.

## Scope / Guardrails
- [x] Branch fix/remote-live-rows-persist from origin/main c22163106; worktree tmp/worktrees/fix-remote-live-rows; ENV=test-fix-remote-rows; ports API 9187, UI 5387, Maildev 1287.
- [x] Make only; no Python; no attribution trailers; no CI skip or rerun; never ENV=dev.
- [x] No package source change, so no package version bump; api image delivery and preprod repin stay with the repin lane.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/postgres.ts`
  - `api/tests/api/artifacts-live-remote-rows.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `ui/**`
  - `deploy/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] No scope exception required.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no AI test in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one owner-priority fix PR, one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Adapter fix**
  - [x] `postgres.ts`: `createPostgresRemoteLiveRows.update` returns `{ value: next, result }`; `lockedRow` `work` returns `{ value: V | undefined; result: T }`.
- [x] **Lot 2 — Real Postgres regression test**
  - [x] `api/tests/api/artifacts-live-remote-rows.test.ts` on a fresh migrated database: update persists `next` and a fresh pool reads it; a no-op change keeps the row and creates none when absent; a throwing change rolls back; a seal is read back by `drafts.current` (reconcile path); package fences, session and invitation state are persisted.
- [ ] **Lot 3 — Final validation**
  - [ ] `docker-slot.sh make typecheck-api ENV=test-fix-remote-rows` and `docker-slot.sh make lint-api ENV=test-fix-remote-rows`.
  - [ ] `docker-slot.sh make test-api-endpoints SCOPE=tests/api/artifacts-live-remote-rows.test.ts API_PORT=9187 UI_PORT=5387 MAILDEV_UI_PORT=1287 ENV=test-fix-remote-rows`.
  - [ ] PR, CI green on the exact head, review in `.h2a/reviews/`, merge by s-conductor.
