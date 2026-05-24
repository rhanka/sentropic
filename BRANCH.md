# Feature: BR-39b Auth Hono Kit

## Objective
Extract the reusable Hono-side authentication routes and server contracts into a publishable package, `@sentropic/auth-hono`, after BR-39a freezes the frontend transport contract. The package should let Sentropic-style apps mount email verification, passkey registration/login, sessions, and credential-management endpoints without copying the current API route/service implementation.

## Scope / Guardrails
- Scope limited to backend auth route factories, pure auth service contracts, session/token helpers, WebAuthn challenge verification, email OTP/magic-link verification, credential management, Hono middleware, and Sentropic API rewiring to consume the package.
- BR-39b Lot 0 / Worker B scope is documentation and read-only backend extraction inventory only; implementation source files remain read-only in this pass.
- Frontend screens and browser WebAuthn helpers are out of scope and owned by BR-39a.
- The package must expose ports for user lookup, user creation/update, credential storage, challenge storage, session storage, email delivery, workspace bootstrap, audit logging, clock, random IDs, cookie serialization, token signing, and token hashing.
- The package must not import Sentropic Drizzle schema, Sentropic workspace services, or app-local DB clients directly.
- Sentropic API adapters implement package ports in `api/src/**`; the package owns contracts and reusable Hono route composition.
- `spa-transpose-cv` has an existing DB-less admin passkey flow; BR-39b must document whether that consumer can use storage-backed ports without requiring Sentropic's workspace model.
- One migration max in `api/drizzle/*.sql` if Sentropic adapter changes require schema updates; no migration is expected for the first extraction.
- Make-only workflow, no direct Docker/npm/node commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-auth-hono-kit`.
- Automated test campaigns must run on dedicated environments, never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification.
- In every `make` command, the concrete branch environment value must be passed as the last argument.
- Branch ports: `API_PORT=9196`, `UI_PORT=5396`, `MAILDEV_UI_PORT=1296`.
- Test envs: `ENV=test-feat-auth-hono-kit` for non-E2E package/API checks and `ENV=e2e-feat-auth-hono-kit` for E2E checks.
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
  - `ui/**`
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
- `BR39b-Q1`
  - Branch: BR-39b `feat/auth-hono-kit`
  - Owner: Conductor / BR-39a implementer
  - Severity: blocking for Lot 1+
  - Status: blocked
  - Repro steps: in `tmp/feat-auth-hono-kit`, `packages/auth-ui` is absent and no exported auth transport contract is visible in `packages/**` or `ui/src/routes/auth/**`; `PLAN.md` and `plan/39b-BRANCH_feat-auth-hono-kit.md` state BR-39b depends on BR-39a.
  - Expected: BR-39a exports stable auth transport request/result/error types for email OTP/code, magic-link verify, passkey registration, passkey login, session issue/refresh/logout, and credential list/rename/revoke.
  - Actual: backend route factories would have to freeze response and error shapes without the UI package contract.
  - Evidence: read-only inspection found `packages/auth-ui` missing; existing backend endpoints are app-local under `api/src/routes/auth/**`.
  - Recommendation: do not start BR-39b route-factory implementation until BR-39a lands or publishes a frozen contract. After BR-39a lands, align `@sentropic/auth-hono` route schemas and tests to that transport contract before moving reusable service logic.
- `BR39b-INV1`
  - Branch: BR-39b `feat/auth-hono-kit`
  - Owner: Worker B
  - Severity: attention
  - Status: documented
  - Repro steps: read-only inventory of `api/src/routes/auth/**`, `api/src/services/{challenge-manager,email-verification,magic-link,session-manager,webauthn-authentication,webauthn-registration,webauthn-config,workspace-service}.ts`, `api/src/middleware/auth.ts`, and auth tests.
  - Expected: current backend surface maps cleanly to reusable route factories plus app-owned adapters.
  - Actual: current routes mix reusable auth ceremony logic with Sentropic-specific DB, workspace bootstrap, account-status, role, mail copy, and cookie details.
  - Evidence:
    - Router mount: `api/src/app.ts` mounts `authRouter` at `/api/v1/auth`; `api/src/routes/auth/index.ts` mounts `/register`, `/login`, `/session`, `/credentials`, `/magic-link`, `/email`, and `/health`.
    - Registration: `api/src/routes/auth/register.ts` owns `/options` and `/verify`, calls WebAuthn registration, email validation tokens, user lookup/create, first-admin role detection, workspace bootstrap, and session creation.
    - Login: `api/src/routes/auth/login.ts` owns `/options` and `/verify`, supports discoverable credentials, validates challenges, verifies passkeys, checks email/account status, avoids workspace autocreation on login, and creates sessions.
    - Session: `api/src/routes/auth/session.ts` owns get/refresh/extension-token/logout/logout-all/list, with cookie or bearer token extraction and Chrome extension token exchange.
    - Credentials: `api/src/routes/auth/credentials.ts` owns list/rename/revoke devices and uses session validation plus credential ownership checks.
    - Email OTP: `api/src/routes/auth/email.ts` owns `/verify-request` and `/verify-code`, backed by `emailVerificationCodes` and Nodemailer/Maildev delivery.
    - Magic link: `api/src/routes/auth/magic-link.ts` owns `/request` and `/verify`, creates/fetches users, marks email verified via magic link service, activates devices, and creates sessions.
    - Middleware: `api/src/middleware/auth.ts` owns `requireAuth` and `optionalAuth`, but currently couples session validation to workspace resolution, stale workspace recovery, hidden-workspace checks, and Hono `ContextVariableMap`.
    - Storage tables: reusable port candidates map to `users`, `webauthn_credentials`, `user_sessions`, `webauthn_challenges`, `magic_links`, and `email_verification_codes` in `api/src/db/schema.ts`.
  - Recommendation: package should own route composition, WebAuthn/email/session ceremonies, cookie/token helpers, and middleware factories; Sentropic adapters should own Drizzle tables, workspace bootstrap, account-status policy, product email copy, and app-specific rate limiting.
- No `BR39b-EXn` scope exceptions declared in Lot 0.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Lot 0 status: no AI flaky tests run; no runtime tests applicable to documentation-only scoping.

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
- [x] **Lot 0 - Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `README.md`, `TODO.md`, `PLAN.md`, `plan/39b-BRANCH_feat-auth-hono-kit.md`, `plan/39a-BRANCH_feat-auth-ui-sdk.md`, `plan/BRANCH_TEMPLATE.md`, and `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`.
  - [x] Confirm BR-39a status and record `BR39b-Q1`: BR-39a is not merged/stable in this worktree because `packages/auth-ui` and exported auth transport contracts are absent.
  - [x] Confirm isolated worktree `tmp/feat-auth-hono-kit` on branch `feat/auth-hono-kit`.
  - [x] Confirm `.env` copy is not needed for this documentation-only Lot 0; no services were started.
  - [x] Capture Makefile targets needed for later gates: existing `typecheck-api`, `lint-api`, `test-api`, `build-api`, `build-ui-image`, `test-e2e`, `commit`; new `typecheck-auth-hono`, `build-auth-hono`, `test-auth-hono` or equivalent package targets are not present yet and belong to Lot 1 implementation.
  - [x] Confirm command style with `API_PORT=9196`, `UI_PORT=5396`, `MAILDEV_UI_PORT=1296`, and concrete `ENV=...` last.
  - [x] Confirm package publication requirements for a new `packages/auth-hono` package, including package versioning, bootstrap publish, and trusted publisher setup.
  - [x] Confirm scope boundaries and declare no `BR39b-EXn` exceptions.
  - [x] Record read-only backend extraction inventory in `BR39b-INV1`.
  - [x] Validate Lot 0 as documentation-only with `git diff --check`.

- [ ] **Lot 1 - Package contracts and route factory**
  - [ ] Wait for `BR39b-Q1` resolution before freezing route schemas.
  - [ ] Create `packages/auth-hono` with `package.json`, `tsconfig.json`, `README.md`, `LICENSE`, and `src/index.ts`.
  - [ ] Define pure port interfaces for users, credentials, challenges, sessions, email verification, magic links, cookies, logger, clock, random IDs, token signing, and token hashing.
  - [ ] Define route-factory options for route prefix, cookie names, RP ID/origins, session duration, email-code policy, account-status mapping, route-path overrides, and response/error shape policy aligned with BR-39a.
  - [ ] Export a `createAuthRouter(options)` Hono factory that mounts registration, login, session, credentials, magic-link, email, and health routes.
  - [ ] Export `createRequireAuth(options)` and `createOptionalAuth(options)` middleware factories that do not assume Sentropic workspaces.
  - [ ] Lot gate:
    - [ ] `make typecheck-auth-hono ENV=test-feat-auth-hono-kit`
    - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/contracts.test.ts ENV=test-feat-auth-hono-kit`
    - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/router-factory.test.ts ENV=test-feat-auth-hono-kit`

- [ ] **Lot 2 - WebAuthn, email, and session services**
  - [ ] Move reusable WebAuthn registration option generation and verification logic into package services with injected credential and challenge ports.
  - [ ] Move reusable WebAuthn authentication option generation and verification logic into package services with discoverable-credential support.
  - [ ] Move reusable email-code and magic-link validation flows into package services with injected delivery and token-storage ports.
  - [ ] Move reusable JWT/session issue, validate, refresh, revoke, and revoke-all logic into package services with injected session storage and secret providers.
  - [ ] Preserve deterministic error codes and HTTP status mapping for invalid request, expired challenge, duplicate credential, unverified email, disabled account, and invalid session paths.
  - [ ] Lot gate:
    - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/webauthn-registration.test.ts ENV=test-feat-auth-hono-kit`
    - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/webauthn-authentication.test.ts ENV=test-feat-auth-hono-kit`
    - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/email-verification.test.ts ENV=test-feat-auth-hono-kit`
    - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/session-manager.test.ts ENV=test-feat-auth-hono-kit`

- [ ] **Lot 3 - Sentropic API adapters**
  - [ ] Implement Sentropic adapters for users, credentials, challenges, sessions, email verification, magic links, cookies, logger, clock, random IDs, token signing, and token hashing using the existing Drizzle schema and services.
  - [ ] Rewire `api/src/routes/auth/index.ts` to mount `createAuthRouter` with Sentropic adapters.
  - [ ] Keep existing route paths and response shapes stable for the Sentropic UI and auth E2E tests.
  - [ ] Rewire `api/src/middleware/auth.ts` to use package session validation while keeping Sentropic workspace selection and hidden-workspace rules app-owned.
  - [ ] Keep rate limiting in `api/src/app.ts` app-owned unless a later approved exception says otherwise.
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
    - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/example-admin-file-store.test.ts ENV=test-feat-auth-hono-kit`
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
    - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests ENV=test-feat-auth-hono-kit`
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
