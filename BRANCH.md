# Feature: BR-39r L3 — OIDC Evolution 1 (end_session_endpoint + prompt=select_account + discovery)

## Objective
Add additive OIDC RP-Initiated Logout (`end_session_endpoint`), `prompt=select_account` (plus the shared `prompt=login` resume-gap fix), and the matching discovery fields to `@sentropic/auth-hono`, additive-MINOR bump 0.8.0 -> 0.9.0.

## Scope / Guardrails
- Scope limited to `@sentropic/auth-hono` OAuth handlers + host wiring + discovery + tests.
- No DB migration (C1 reuses existing `client.redirectUris`).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/br39r-l3`.
- Automated test campaigns run on `ENV=test-idprpl3`, never on root `dev`.
- `ENV=<env>` must be the last argument in all `make` commands.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/auth-hono/src/oauth/**`
  - `packages/auth-hono/src/index.ts`
  - `packages/auth-hono/package.json`
  - `packages/auth-hono/tests/**`
  - `api/src/routes/auth/oauth.ts`
  - `api/tests/api/auth/**`
  - `apps/auth-idp/web/src/routes/auth/login/+page.svelte` (ONLY if C2 loop-prevention truly needs it)
  - `BRANCH.md`
  - `plan/BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `BR39r-L3-EX1` (scope exception): widen `packages/auth-ui/package.json` `@sentropic/auth-hono` peerDependency range to include `^0.9.0`, and sync `package-lock.json`. Reason: the 0.8.0->0.9.0 bump makes the workspace npm install fail with ERESOLVE because auth-ui's peer range is capped at `^0.8.0`; this blocks `typecheck-api`/`lint-api`/`test-api` (all depend on workspace install). auth-ui does NOT import auth-hono in `src/` (pure peer-range declaration). Impact: peer-range widen only, no behavior change. Rollback: revert the one-line range + lockfile. Precedent: EVERY prior auth-hono minor bump did the identical same-PR widen (BR39l-EX3 ^0.6.0, EX6 ^0.4.0, ^0.7.0, ^0.8.0 in commit 1c30b39d9). Paths: `packages/auth-ui/package.json`, `package-lock.json`.
- `attention` C2 loop-prevention finding: `apps/auth-idp/web/.../login/+page.svelte` + `packages/auth-ui/.../AuthLogin.svelte` ALWAYS render the login form on mount; `onLoggedIn` (the `continue` resume trigger) fires ONLY after a fresh passkey assertion (`verifyPasskeyAuthentication`) which mints a NEW session id. No auto-resume from an existing cookie exists. Therefore NO login-page edit is required for the forced-reauth flow.

## AI Flaky tests
- none in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single additive capability in one package + host wiring; one CI cycle suffices.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch only. No UI surface change in this branch; Playwright logout-leg deferred (unit/app tests cover the security paths).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `/tmp/br39r-l3-design-final.md`, `/tmp/br39r-study-358.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm worktree `tmp/br39r-l3` on branch `feat/idp-oidc-rp-l3`.
  - [x] Define env mapping: `ENV=test-idprpl3`, `API_PORT=9301`, `UI_PORT=5301`, `MAILDEV_UI_PORT=1131`.
  - [x] Confirm scope boundaries.

- [x] **Lot 1 — Discovery (D) + golden tests + version bump**
  - [x] Add `end_session_endpoint` + `prompt_values_supported` to `wellknown-handler.ts` (keys sorted).
  - [x] Update `packages/auth-hono/tests/oauth-wellknown.test.ts`.
  - [x] Update `api/tests/api/auth/oauth-wellknown.test.ts`.
  - [x] Bump `packages/auth-hono/package.json` 0.8.0 -> 0.9.0.
  - [ ] Lot gate: `make typecheck-api ENV=test-idprpl3` + `make lint-api ENV=test-idprpl3` (final lot).

- [x] **Lot 2 — end_session (A) + C1 redirect validation + host wiring**
  - [x] Extract `validateRedirectUri` into a shared helper (redirect-utils); reuse in authorize + end_session.
  - [x] New `packages/auth-hono/src/oauth/end-session-handler.ts` (RP-initiated logout, CSRF-guarded, C1 validated redirect).
  - [x] Register route in `packages/auth-hono/src/oauth/router.ts`; export from `packages/auth-hono/src/index.ts`.
  - [x] Wire `GET /oauth/end_session` in `api/src/routes/auth/oauth.ts`.
  - [x] **API tests**
    - [x] New `packages/auth-hono/tests/oauth-end-session.test.ts` (8 tests green).
    - [x] Reachability assertion in `api/tests/api/auth/oauth-wellknown.test.ts`.
    - [x] Sub-lot gate: `make test-auth-hono SCOPE=tests/oauth-end-session.test.ts ENV=test-idprpl3` (8/8 pass).

- [x] **Lot 3 — prompt=select_account + login resume-gap (C2)**
  - [x] Add `forceReauth?` + `forceReauthSessionId?` to `OAuthContinuationState` (`state-codec.ts`).
  - [x] Parse `prompt` as a space-delimited Set in `authorize-handler.ts`; force-reauth for `login` OR `select_account`; `none` exclusivity errors.
  - [x] Seal `forceReauth`/`forceReauthSessionId`; close resume-gap at `resumeLoginContinuation`.
  - [x] **API tests**
    - [x] New `packages/auth-hono/tests/oauth-authorize-select-account.test.ts` (5 tests green).
    - [x] Sub-lot gate: `make test-auth-hono SCOPE=tests/oauth-authorize-select-account.test.ts ENV=test-idprpl3` (5/5 pass).

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-api ENV=test-idprpl3` + `make lint-api ENV=test-idprpl3`.
  - [ ] `make test-auth-hono ENV=test-idprpl3` (full package suite).
  - [ ] `make test-api SCOPE=tests/api/auth/oauth-wellknown.test.ts ENV=test-idprpl3` (host discovery).
  - [ ] `packages/auth-hono/package.json` bumped to 0.9.0 (CI `enforce-package-bump`).
  - [ ] `make down ENV=test-idprpl3`.

## Deferred
- Dedicated optional `postLogoutRedirectUris` client field (logout landing distinct from OAuth callbacks): NOT this PR. C1 reuses `client.redirectUris` (additive-minimal, no migration). Follow-up to a future BR-39r/39x branch if a client ever needs a distinct logout landing. Owner: 39etc auth lane, date: 2026-06-23.
- Playwright screen-smoke logout leg: deferred to keep L3 tight; unit/app tests cover the security paths.
