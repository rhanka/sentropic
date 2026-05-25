# Feature: BR-39a Auth UI SDK

## Objective
Extract the reusable Sentropic authentication screens and browser-side passkey helpers into a publishable Svelte package, `@sentropic/auth-ui`, so downstream apps such as `spa-transpose-cv` can reuse the same login, registration, verification, and device-management experience without copying Sentropic app pages.

## Scope / Guardrails
- Scope limited to frontend authentication UI, browser passkey helpers, host adapter contracts, i18n labels, and Sentropic web-app rewiring to consume the package.
- Backend Hono routes, session persistence, WebAuthn verification, OTP delivery, and credential storage are out of scope and owned by BR-39b.
- The package must be host-adapter driven: no direct `$lib/*`, app route, SvelteKit navigation, Sentropic workspace, or API-internal imports from package source.
- `@sentropic/auth-ui` must support app-specific API paths through injected transport methods, because Sentropic uses `/auth/*` while `spa-transpose-cv` currently uses `/admin/auth/*`.
- The package must support branding and product copy through labels, slots/snippets, and theme tokens, not hardcoded product names.
- One migration max in `api/drizzle/*.sql` is not expected and is out of scope unless a documented exception is approved.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-auth-ui-sdk`.
- Automated test campaigns must run on dedicated environments, never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification.
- In every `make` command, the concrete branch environment value must be passed as the last argument.
- All new text in English.
- Package version bumps are mandatory for every non-private package whose `src/**` changes.
- First publish of brand-new `packages/auth-ui` requires the package bootstrap flow from `rules/workflow.md` Package Publication.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `plan/39a-BRANCH_feat-auth-ui-sdk.md`
  - `packages/auth-ui/package.json`
  - `packages/auth-ui/src/**`
  - `packages/auth-ui/tests/**`
  - `packages/auth-ui/README.md`
  - `packages/auth-ui/LICENSE`
  - `package-lock.json`
  - `ui/package.json`
  - `ui/src/routes/auth/login/+page.svelte`
  - `ui/src/routes/auth/register/+page.svelte`
  - `ui/src/routes/auth/magic-link/verify/+page.svelte`
  - `ui/src/routes/auth/devices/+page.svelte`
  - `ui/src/lib/services/webauthn-client.ts`
  - `ui/src/lib/stores/session.ts`
  - `ui/src/lib/core/auth-bridge.ts`
  - `ui/src/lib/utils/api.ts`
  - `ui/src/locales/en.json`
  - `ui/src/locales/fr.json`
  - `ui/tests/stores/session.test.ts`
  - `ui/tests/utils/auth-ui.test.ts`
  - `ui/tests/utils/webauthn-client.test.ts`
  - `e2e/tests/02-auth-simple.spec.ts`
  - `e2e/tests/02-auth-routes.spec.ts`
  - `e2e/tests/02-auth-workflow.spec.ts`
  - `e2e/tests/02-auth-webauthn.spec.ts`
  - `e2e/tests/02-auth-devices.spec.ts`
  - `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md`
  - `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` except this branch file
  - `plan/39b-BRANCH_feat-auth-hono-kit.md`
  - `api/src/routes/auth/**`
  - `api/src/services/*auth*.ts`
  - `api/src/services/session-manager.ts`
  - `api/src/middleware/auth.ts`
  - `api/src/db/schema.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**` only if CI package publish wiring for the new package is missing and cannot be inherited from existing package jobs.
  - `ui/tailwind.config.*` only if package source scanning misses auth package classes, mirroring the BR-14a Tailwind package-source fix.
  - New `ui/src/lib/auth/**` wrappers only if existing route files cannot stay thin without a wrapper boundary.
- **Exception process**:
  - Declare exception ID `BR39a-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- No open blockers at registration time.
- Consumer note from `../spa-transpose-cv`: the app is a TypeScript/Svelte workspace with admin OTP and passkey flows under `/admin/auth/*`, currently duplicating browser WebAuthn helpers and auth copy. BR-39a must keep transports path-configurable so that consumer can reuse the screens before BR-39b exists.
- Architecture notes already verified on main:
  - Sentropic auth screens live in `ui/src/routes/auth/{login,register,magic-link/verify,devices}/+page.svelte`.
  - Browser passkey helpers live in `ui/src/lib/services/webauthn-client.ts`.
  - Session state is app-owned in `ui/src/lib/stores/session.ts`.
  - `@sentropic/chat-ui` already uses package exports for Svelte components and host adapters; BR-39a should follow that package style.

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
- Rationale: this branch delivers one frontend package and one Sentropic app rewiring. Backend extraction is intentionally split into BR-39b.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only after package, UI, and auth E2E gates pass.
- Development worktree: `tmp/feat-auth-ui-sdk`.
- Branch ports: `API_PORT=9195`, `UI_PORT=5395`, `MAILDEV_UI_PORT=1295`.
- Test envs: `ENV=test-feat-auth-ui-sdk`, `ENV=e2e-feat-auth-ui-sdk`.
- Root UAT env: `ENV=dev` on `/home/antoinefa/src/sentropic`, same HEAD as the branch under qualification.

## Plan / Todo (lot-based)
- [ ] **Lot 0 - Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `README.md`, `TODO.md`, `PLAN.md`, this branch file, `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md`, and `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`.
  - [ ] Create isolated worktree `tmp/feat-auth-ui-sdk` from `main`.
  - [ ] Copy `.env` into the worktree only if local service execution is needed; override branch ports and never use root `ENV=dev` for tests.
  - [ ] Capture Makefile targets needed for `@sentropic/auth-ui`, UI, and E2E gates.
  - [ ] Confirm command style with `API_PORT=9195`, `UI_PORT=5395`, `MAILDEV_UI_PORT=1295`, and the concrete `ENV=...` value last.
  - [ ] Confirm package publication requirements for a new `packages/auth-ui` package, including bootstrap publish and trusted publisher setup.
  - [ ] Confirm scope boundaries and declare `BR39a-EXn` before touching conditional paths.

- [ ] **Lot 1 - Package shell and contracts**
  - [ ] Create `packages/auth-ui` with `package.json`, `tsconfig.json`, `README.md`, `LICENSE`, and `src/index.ts`.
  - [ ] Export transport contracts for email OTP/code, magic-link verify, passkey registration, passkey login, session issue/refresh/logout, and credential list/rename/revoke.
  - [ ] Export `AuthUiLabels`, `AuthUiBranding`, `AuthUiNavigation`, `AuthUiSessionCallbacks`, and typed result/error shapes.
  - [ ] Move browser-only WebAuthn support checks and start registration/authentication helpers behind package exports.
  - [ ] Keep package code free of SvelteKit `$app/*`, Sentropic `$lib/*`, global session stores, and hardcoded API paths.
  - [ ] Lot gate:
    - [ ] `make typecheck-auth-ui ENV=test-feat-auth-ui-sdk`
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests/auth-contracts.test.ts ENV=test-feat-auth-ui-sdk`

- [ ] **Lot 2 - Reusable auth screens**
  - [ ] Add package components for `AuthLogin.svelte`, `AuthRegister.svelte`, `AuthMagicLinkVerify.svelte`, and `AuthDevices.svelte`.
  - [ ] Preserve Sentropic login behavior: discoverable passkey login, lost-device path, return URL redirect callback, and session callback.
  - [ ] Preserve registration behavior: email entry, six-digit code inputs with paste and auto-submit, passkey registration, success callback, and recoverable WebAuthn errors.
  - [ ] Preserve magic-link verify behavior through a host-provided token and redirect callback.
  - [ ] Preserve device-management behavior: list credentials, rename device, revoke device, empty state, and add-device link callback.
  - [ ] Add stable slots/snippets or render hooks for logo, product name, secondary action, and alert rendering without nesting app-owned cards inside package cards.
  - [ ] Lot gate:
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests/auth-login.test.ts ENV=test-feat-auth-ui-sdk`
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests/auth-register.test.ts ENV=test-feat-auth-ui-sdk`
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests/auth-devices.test.ts ENV=test-feat-auth-ui-sdk`

- [ ] **Lot 3 - Sentropic app rewiring**
  - [ ] Add Sentropic host transport that maps package calls to existing `/auth/*` endpoints through `ui/src/lib/utils/api.ts`.
  - [ ] Rewire `ui/src/routes/auth/login/+page.svelte` to render package `AuthLogin`.
  - [ ] Rewire `ui/src/routes/auth/register/+page.svelte` to render package `AuthRegister`.
  - [ ] Rewire `ui/src/routes/auth/magic-link/verify/+page.svelte` to render package `AuthMagicLinkVerify`.
  - [ ] Rewire `ui/src/routes/auth/devices/+page.svelte` to render package `AuthDevices`.
  - [ ] Keep Sentropic session store updates and navigation in app-owned callbacks.
  - [ ] Keep Sentropic i18n dictionaries app-owned and pass labels into the package.
  - [ ] Lot gate:
    - [ ] `make typecheck-ui ENV=test-feat-auth-ui-sdk`
    - [ ] `make lint-ui ENV=test-feat-auth-ui-sdk`
    - [ ] `make test-ui SCOPE=tests/stores/session.test.ts ENV=test-feat-auth-ui-sdk`
    - [ ] `make test-ui SCOPE=tests/utils/auth-ui.test.ts ENV=test-feat-auth-ui-sdk`

- [ ] **Lot 4 - Consumer integration proof without editing consumer repo**
  - [ ] Add a README section showing how `spa-transpose-cv` maps `/admin/auth/email/otp`, `/admin/auth/email/verify`, `/admin/auth/passkey/register/options`, `/admin/auth/passkey/register/verify`, `/admin/auth/passkey/login/options`, and `/admin/auth/passkey/login/verify` into the package transport.
  - [ ] Add a package-level fixture transport named `createExampleAdminAuthTransport` in tests or docs only; do not import `../spa-transpose-cv`.
  - [ ] Document how downstream apps supply brand assets, French labels, and post-login redirects.
  - [ ] Document that BR-39b will remove backend duplication later but is not required to adopt the UI package.
  - [ ] Lot gate:
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests/example-admin-transport.test.ts ENV=test-feat-auth-ui-sdk`
    - [ ] `make build-auth-ui ENV=test-feat-auth-ui-sdk`

- [ ] **Lot N-2 - UAT**
  - [ ] Web app setup:
    - [ ] Push branch before UAT.
    - [ ] Confirm root workspace is commit-identical to branch HEAD.
    - [ ] Run user UAT from root with `API_PORT=8787`, `UI_PORT=5173`, `MAILDEV_UI_PORT=1080`, `ENV=dev`.
  - [ ] Web app evolution tests:
    - [ ] Open `/auth/login` and verify visual parity with the current Sentropic login screen.
    - [ ] Complete passkey login with an existing account and verify redirect to `/neutral` or `returnUrl`.
    - [ ] Open `/auth/register`, request email code, paste a six-digit code, register passkey, and verify session creation.
    - [ ] Open `/auth/magic-link/verify?token=token-from-test-fixture` and verify success and redirect behavior.
    - [ ] Open `/auth/devices`, rename a credential, revoke a test credential, and verify list refresh.
  - [ ] Web app non-regression tests:
    - [ ] Existing protected routes still redirect unauthenticated users to login.
    - [ ] Existing session restore/logout behavior still works.
    - [ ] Existing Chrome extension token exchange remains unchanged.

- [ ] **Lot N-1 - Docs consolidation**
  - [ ] Update `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` with the `@sentropic/auth-ui` package boundary.
  - [ ] Update `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md` only if shared UI package rules need cross-reference.
  - [ ] Keep a consumer note for `spa-transpose-cv` in `packages/auth-ui/README.md`; do not edit sibling repositories from this branch.

- [ ] **Lot N - Final validation**
  - [ ] Typecheck and lint:
    - [ ] `make typecheck-auth-ui ENV=test-feat-auth-ui-sdk`
    - [ ] `make typecheck-ui ENV=test-feat-auth-ui-sdk`
    - [ ] `make lint-ui ENV=test-feat-auth-ui-sdk`
  - [ ] Retest packages:
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests ENV=test-feat-auth-ui-sdk`
  - [ ] Retest UI:
    - [ ] `make test-ui ENV=test-feat-auth-ui-sdk`
  - [ ] Retest E2E:
    - [ ] `make build-api build-ui-image API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=e2e-feat-auth-ui-sdk`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-simple.spec.ts API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=e2e-feat-auth-ui-sdk`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-routes.spec.ts API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=e2e-feat-auth-ui-sdk`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-workflow.spec.ts API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=e2e-feat-auth-ui-sdk`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-webauthn.spec.ts API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=e2e-feat-auth-ui-sdk`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-devices.spec.ts API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295 ENV=e2e-feat-auth-ui-sdk`
  - [ ] Bump affected package versions for every touched package `src/**`.
  - [ ] Complete first-publish bootstrap documentation for `@sentropic/auth-ui`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
