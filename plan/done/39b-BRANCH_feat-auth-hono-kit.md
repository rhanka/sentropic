# Feature: BR-39b Auth Hono Kit

## Objective
Extract the reusable Hono-side authentication routes and server contracts into a publishable package, `@sentropic/auth-hono`, after BR-39a proves the frontend contract. The package should let Sentropic-style apps mount email verification, passkey registration/login, sessions, and credential-management endpoints without copying the current API route/service implementation.

## Scope / Guardrails
- Scope limited to backend auth route factories, pure auth service contracts, session/token helpers, WebAuthn challenge verification, email OTP/magic-link verification, credential management, Hono middleware, and Sentropic API rewiring to consume the package.
- Frontend screens and browser WebAuthn helpers are out of scope and owned by BR-39a.
- The package must expose ports for user lookup, user creation/update, credential storage, challenge storage, session storage, email delivery, workspace bootstrap, and audit logging.
- The package must not import Sentropic Drizzle schema, Sentropic workspace services, or app-local DB clients directly.
- Sentropic API adapters implement package ports in `api/src/**`; the package owns contracts and reusable Hono route composition.
- `spa-transpose-cv` has an existing DB-less admin passkey flow; BR-39b must document whether that consumer can use storage-backed ports without requiring Sentropic's workspace model.
- One migration max in `api/drizzle/*.sql` if Sentropic adapter changes require schema updates; no migration is expected for the first extraction.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-auth-hono-kit`.
- Automated test campaigns must run on dedicated environments, never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification.
- In every `make` command, the concrete branch environment value must be passed as the last argument.
- All new text in English.
- Package version bumps are mandatory for every non-private package whose `src/**` changes.
- First publish of brand-new `packages/auth-hono` requires the package bootstrap flow from `rules/workflow.md` Package Publication.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `plan/39b-BRANCH_feat-auth-hono-kit.md`
  - `packages/auth-hono/package.json`
  - `packages/auth-hono/src/**`
  - `packages/auth-hono/tests/**`
  - `packages/auth-hono/README.md`
  - `packages/auth-hono/LICENSE`
  - `package-lock.json`
  - `api/package.json`
  - `api/src/routes/auth/index.ts`
  - `api/src/routes/auth/login.ts`
  - `api/src/routes/auth/register.ts`
  - `api/src/routes/auth/session.ts`
  - `api/src/routes/auth/credentials.ts`
  - `api/src/routes/auth/email.ts`
  - `api/src/routes/auth/magic-link.ts`
  - `api/src/services/challenge-manager.ts`
  - `api/src/services/email-verification.ts`
  - `api/src/services/magic-link.ts`
  - `api/src/services/session-manager.ts`
  - `api/src/services/webauthn-authentication.ts`
  - `api/src/services/webauthn-registration.ts`
  - `api/src/services/webauthn-config.ts`
  - `api/src/services/workspace-service.ts`
  - `api/src/middleware/auth.ts`
  - `api/tests/api/auth/authentication.test.ts`
  - `api/tests/api/auth/credentials.test.ts`
  - `api/tests/api/auth/magic-link.test.ts`
  - `api/tests/api/auth/registration.test.ts`
  - `api/tests/api/auth/session.test.ts`
  - `api/tests/unit/auth/admin-registration.test.ts`
  - `api/tests/unit/auth/challenge-manager.test.ts`
  - `api/tests/unit/auth/magic-link.test.ts`
  - `api/tests/unit/auth/session-manager.test.ts`
  - `api/tests/unit/auth/webauthn-authentication.test.ts`
  - `api/tests/unit/auth/webauthn-config.test.ts`
  - `api/tests/unit/auth/webauthn-registration.test.ts`
  - `api/tests/utils/auth-helper.ts`
  - `e2e/tests/02-auth-simple.spec.ts`
  - `e2e/tests/02-auth-routes.spec.ts`
  - `e2e/tests/02-auth-workflow.spec.ts`
  - `e2e/tests/02-auth-webauthn.spec.ts`
  - `e2e/tests/02-auth-devices.spec.ts`
  - `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` except this branch file
  - `plan/39a-BRANCH_feat-auth-ui-sdk.md`
  - `packages/auth-ui/**`
  - `ui/src/routes/auth/**`
  - `ui/src/lib/services/webauthn-client.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file, only if adapter extraction requires a schema change)
  - `.github/workflows/**` only if CI package publish wiring for the new package is missing and cannot be inherited from existing package jobs.
  - New `api/src/services/auth/**` adapter modules if existing flat service files cannot keep package wiring understandable.
  - `packages/contracts/src/**` only if shared auth context types must be transverse across future packages.
- **Exception process**:
  - Declare exception ID `BR39b-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- No open blockers at registration time.
- Dependency note: launch after BR-39a lands or after its transport contract is stable enough for backend route shapes to freeze.
- Consumer note from `../spa-transpose-cv`: the current admin flow is Hono-style, DB-less/file-backed for passkeys, and uses `/admin/auth/*`. BR-39b should preserve route-prefix configurability and avoid mandatory workspace coupling.
- Architecture notes already verified on main:
  - Sentropic auth Hono routers live in `api/src/routes/auth/**`.
  - Session validation and token creation live in `api/src/services/session-manager.ts`.
  - WebAuthn challenge, registration, and authentication services live in `api/src/services/challenge-manager.ts`, `webauthn-registration.ts`, and `webauthn-authentication.ts`.
  - Hono auth middleware lives in `api/src/middleware/auth.ts` and currently couples session validation to workspace bootstrap.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: this branch delivers one backend package plus one Sentropic API adapter layer. Splitting route factories from adapters would freeze the wrong boundary before tests exercise them together.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only after package, API, and auth E2E gates pass.
- Development worktree: `tmp/feat-auth-hono-kit`.
- Branch ports: `API_PORT=9196`, `UI_PORT=5396`, `MAILDEV_UI_PORT=1296`.
- Test envs: `ENV=test-feat-auth-hono-kit`, `ENV=e2e-feat-auth-hono-kit`.
- Root UAT env: `ENV=dev` on `/home/antoinefa/src/sentropic`, same HEAD as the branch under qualification.

## Plan / Todo (lot-based)
- [ ] **Lot 0 - Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `README.md`, `TODO.md`, `PLAN.md`, this branch file, `plan/39a-BRANCH_feat-auth-ui-sdk.md`, and `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`.
  - [ ] Confirm BR-39a is merged or its transport contract is stable enough to avoid backend/UI route drift.
  - [ ] Create isolated worktree `tmp/feat-auth-hono-kit` from `main`.
  - [ ] Copy `.env` into the worktree only if local service execution is needed; override branch ports and never use root `ENV=dev` for tests.
  - [ ] Capture Makefile targets needed for `@sentropic/auth-hono`, API, and E2E gates.
  - [ ] Confirm command style with `API_PORT=9196`, `UI_PORT=5396`, `MAILDEV_UI_PORT=1296`, and the concrete `ENV=...` value last.
  - [ ] Confirm package publication requirements for a new `packages/auth-hono` package, including bootstrap publish and trusted publisher setup.
  - [ ] Confirm scope boundaries and declare `BR39b-EXn` before touching conditional paths.

- [ ] **Lot 1 - Package contracts and route factory**
  - [ ] Create `packages/auth-hono` with `package.json`, `tsconfig.json`, `README.md`, `LICENSE`, and `src/index.ts`.
  - [ ] Define pure port interfaces for users, credentials, challenges, sessions, email verification, magic links, cookies, logger, clock, and random IDs.
  - [ ] Define route-factory options for route prefix, cookie names, RP ID/origins, session duration, email-code policy, and account-status mapping.
  - [ ] Export a `createAuthRouter(options)` Hono factory that mounts registration, login, session, credentials, magic-link, email, and health routes.
  - [ ] Export `createRequireAuth(options)` and `createOptionalAuth(options)` middleware factories that do not assume Sentropic workspaces.
  - [ ] Lot gate:
    - [ ] `make typecheck-auth-hono ENV=test-feat-auth-hono-kit`
    - [ ] `make test-packages SCOPE=packages/auth-hono/tests/contracts.test.ts ENV=test-feat-auth-hono-kit`
    - [ ] `make test-packages SCOPE=packages/auth-hono/tests/router-factory.test.ts ENV=test-feat-auth-hono-kit`

- [ ] **Lot 2 - WebAuthn, email, and session services**
  - [ ] Move reusable WebAuthn registration option generation and verification logic into package services with injected credential and challenge ports.
  - [ ] Move reusable WebAuthn authentication option generation and verification logic into package services with discoverable-credential support.
  - [ ] Move reusable email-code and magic-link validation flows into package services with injected delivery and token-storage ports.
  - [ ] Move reusable JWT/session issue, validate, refresh, revoke, and revoke-all logic into package services with injected session storage and secret providers.
  - [ ] Preserve deterministic error codes and HTTP status mapping for invalid request, expired challenge, duplicate credential, unverified email, disabled account, and invalid session paths.
  - [ ] Lot gate:
    - [ ] `make test-packages SCOPE=packages/auth-hono/tests/webauthn-registration.test.ts ENV=test-feat-auth-hono-kit`
    - [ ] `make test-packages SCOPE=packages/auth-hono/tests/webauthn-authentication.test.ts ENV=test-feat-auth-hono-kit`
    - [ ] `make test-packages SCOPE=packages/auth-hono/tests/email-verification.test.ts ENV=test-feat-auth-hono-kit`
    - [ ] `make test-packages SCOPE=packages/auth-hono/tests/session-manager.test.ts ENV=test-feat-auth-hono-kit`

- [ ] **Lot 3 - Sentropic API adapters**
  - [ ] Implement Sentropic adapters for users, credentials, challenges, sessions, email verification, magic links, cookies, logger, clock, and random IDs using the existing Drizzle schema and services.
  - [ ] Rewire `api/src/routes/auth/index.ts` to mount `createAuthRouter` with Sentropic adapters.
  - [ ] Keep existing route paths and response shapes stable for the Sentropic UI and auth E2E tests.
  - [ ] Rewire `api/src/middleware/auth.ts` to use package session validation while keeping Sentropic workspace selection and hidden-workspace rules app-owned.
  - [ ] Remove duplicated app-local route/service logic only after equivalent package tests and API tests pass; no dual auth paths.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=test-feat-auth-hono-kit`
    - [ ] `make lint-api API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=test-feat-auth-hono-kit`
    - [ ] `make test-api SCOPE=tests/unit/auth/session-manager.test.ts API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=test-feat-auth-hono-kit`
    - [ ] `make test-api SCOPE=tests/unit/auth/webauthn-registration.test.ts API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=test-feat-auth-hono-kit`
    - [ ] `make test-api SCOPE=tests/unit/auth/webauthn-authentication.test.ts API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=test-feat-auth-hono-kit`

- [ ] **Lot 4 - Consumer adapter proof without editing consumer repo**
  - [ ] Add README documentation for mounting the package at `/admin/auth` with DB-less/file-backed ports matching the `spa-transpose-cv` admin flow.
  - [ ] Add package tests for a memory/file-like port set that simulates OTP, passkey registration, passkey login, and session validation without Sentropic workspaces.
  - [ ] Document when a downstream app should use only BR-39a UI transport versus both BR-39a and BR-39b backend route factory.
  - [ ] Lot gate:
    - [ ] `make test-packages SCOPE=packages/auth-hono/tests/example-admin-file-store.test.ts ENV=test-feat-auth-hono-kit`
    - [ ] `make build-auth-hono ENV=test-feat-auth-hono-kit`

- [ ] **Lot N-2 - UAT**
  - [ ] Web app setup:
    - [ ] Push branch before UAT.
    - [ ] Confirm root workspace is commit-identical to branch HEAD.
    - [ ] Run user UAT from root with `API_PORT=8787`, `UI_PORT=5173`, `MAILDEV_UI_PORT=1080`, `ENV=dev`.
  - [ ] Web app evolution tests:
    - [ ] Complete passkey login with an existing account and verify session cookie plus JSON token response.
    - [ ] Register a new account with email code verification and passkey registration.
    - [ ] Verify magic-link login still creates a session.
    - [ ] Refresh a session, revoke current session, and revoke all sessions.
    - [ ] Rename and revoke a credential from `/auth/devices`.
  - [ ] Web app non-regression tests:
    - [ ] Existing protected API routes still receive `c.get('user')` with workspace context.
    - [ ] Existing Chrome extension token exchange still works.
    - [ ] Existing account-disabled and approval-expired behavior still maps roles correctly.

- [ ] **Lot N-1 - Docs consolidation**
  - [ ] Update `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` with the `@sentropic/auth-hono` package boundary.
  - [ ] Update `packages/auth-hono/README.md` with Sentropic and `spa-transpose-cv` mounting examples.
  - [ ] Document bootstrap publish and trusted publisher setup for `@sentropic/auth-hono`.

- [ ] **Lot N - Final validation**
  - [ ] Typecheck and lint:
    - [ ] `make typecheck-auth-hono ENV=test-feat-auth-hono-kit`
    - [ ] `make typecheck-api API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=test-feat-auth-hono-kit`
    - [ ] `make lint-api API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=test-feat-auth-hono-kit`
  - [ ] Retest packages:
    - [ ] `make test-packages SCOPE=packages/auth-hono/tests ENV=test-feat-auth-hono-kit`
  - [ ] Retest API:
    - [ ] `make test-api API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=test-feat-auth-hono-kit`
  - [ ] Retest E2E:
    - [ ] `make build-api build-ui-image API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=e2e-feat-auth-hono-kit`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-simple.spec.ts API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=e2e-feat-auth-hono-kit`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-routes.spec.ts API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=e2e-feat-auth-hono-kit`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-workflow.spec.ts API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=e2e-feat-auth-hono-kit`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-webauthn.spec.ts API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=e2e-feat-auth-hono-kit`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-devices.spec.ts API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296 ENV=e2e-feat-auth-hono-kit`
  - [ ] Bump affected package versions for every touched package `src/**`.
  - [ ] Complete first-publish bootstrap documentation for `@sentropic/auth-hono`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
