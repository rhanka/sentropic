# Feature: A4 import keeps valid login sessions

## Objective
- [x] Owner 2026-11-07 22:15 (S, partial revert of decision B bf3064b60 for sessions ONLY): the A4 import carries every live, non-revoked `user_sessions` login into the cm_identity session stores with the same id, expiry and token binding, so existing cookies stay valid after the cutover.
- [x] Email codes, email tickets, WebAuthn challenges and magic links stay invalidated; expired or remotely revoked logins are dropped and counted.

## Scope / Guardrails
- [x] Branch fix/a4-preserve-sessions from origin/main c754d639d; worktree tmp/worktrees/a4-preserve-sessions; ENV=test-a4-sessions (API_PORT=9645 UI_PORT=5845 MAILDEV_UI_PORT=1745).
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] Fail closed: remote snapshot divergence and unknown source shapes still refuse the import.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/identity/cm-import-*.ts`
  - `api/src/services/identity/cm-cutover-import.ts`
  - `api/src/scripts/cm-preprod-state.ts`
  - `api/tests/unit/auth/cm-*.test.ts`
  - `api/tests/utils/cm-cutover-test-config.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `deploy/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (none planned)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `acknowledge`: owner answer « S+L … tu te debrouilles dans tous les cas » (owner-authorization.md 22:15) scopes the revert to login sessions only.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one small identity import change with its tests; one PR, one CI.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read cm-import-source.ts, cm-cutover-import.ts, cm-import-continuations.ts, the decision B diff and the CM login_session importer.
  - [x] Confirm the pre-A4 session JWT claims (userId, sessionId, role, login, tokenUse) verify under the CM token custodian.
- [x] **Lot 1 — Carry live sessions**
  - [x] `mapA4CarriedLogin` (hash-bound mapping): live and not remotely revoked, else dropped.
  - [x] `mapA4IdentitySource` imports carried logins as `login_session` rows; `a4InvalidatedProofCounts` counts only dropped logins.
  - [x] `cm-preprod-state` inspection applies the same carry decision.
  - [x] Tests: live legacy session imported with exact binding and usable claims (rehearsal and cutover); expired and revoked dropped and counted; proofs stay invalidated.
  - [x] Lot gate (31/31; 105/105 on all cm-cutover/import/preprod unit tests): `make test-api-unit SCOPE="tests/unit/auth/cm-cutover-migration.test.ts tests/unit/auth/cm-import-continuations.test.ts tests/unit/auth/cm-import-mapping.test.ts" ENV=test-a4-sessions`
  - [x] Lot gate (0 errors): `make typecheck-api ENV=test-a4-sessions` and `make lint-api ENV=test-a4-sessions`
- [ ] **Lot 2 — PR**
  - [ ] PR « fix(identity): keep valid sessions across the A4 import », CI green on the exact head, GLM review.
