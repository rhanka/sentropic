# Feature: BR-39a Auth UI SDK

## Objective
Extract reusable Sentropic authentication screens and browser-side passkey helpers into a publishable Svelte package, `@sentropic/auth-ui`, so downstream apps can reuse login, registration, verification, and device-management flows through host-provided transports.

## Scope / Guardrails
- Scope limited to frontend authentication UI, browser passkey helpers, host adapter contracts, i18n labels, branding hooks, and thin Sentropic app wrappers when reached by later lots.
- Backend Hono routes, session persistence, WebAuthn verification, OTP delivery, credential storage, and API auth middleware are out of scope and owned by BR-39b.
- The package must be host-adapter driven: no direct `$lib/*`, app route, SvelteKit navigation, Sentropic workspace, or API-internal imports from package source.
- `@sentropic/auth-ui` must support app-specific API paths through injected transport methods, because Sentropic uses `/auth/*` while `spa-transpose-cv` currently uses `/admin/auth/*`.
- The package must support branding and product copy through labels, slots/snippets, and theme tokens, not hardcoded product names.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-auth-ui-sdk`.
- Automated test campaigns must run on dedicated environments, never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Package version bumps are mandatory for every non-private package whose `src/**` changes.
- First publish of brand-new `packages/auth-ui` requires the package bootstrap flow from `rules/workflow.md` Package Publication.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/auth-ui/package.json`
  - `packages/auth-ui/tsconfig.json`
  - `packages/auth-ui/src/**`
  - `packages/auth-ui/tests/**`
  - `packages/auth-ui/README.md`
  - `packages/auth-ui/LICENSE`
  - `package-lock.json`
  - `ui/package.json`
  - `ui/src/lib/services/webauthn-client.ts`
  - `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `packages/auth-hono/**`
  - `plan/39b-BRANCH_feat-auth-hono-kit.md`
  - `plan/NN-BRANCH_*.md` except `plan/39a-BRANCH_feat-auth-ui-sdk.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**` only if CI package publish wiring for the new package is missing and cannot be inherited from existing package jobs.
  - `ui/tailwind.config.*` only if package source scanning misses auth package classes, mirroring the BR-14a Tailwind package-source fix.
  - New `ui/src/lib/auth/**` wrappers only if existing route files cannot stay thin without a wrapper boundary.
  - Sentropic auth route rewiring files listed in the full branch plan, but not in this Worker A first slice unless Lot 1 is complete and conductor approves continuation.
- **Exception process**:
  - Declare exception ID `BR39a-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in `plan/39a-BRANCH_feat-auth-ui-sdk.md` if this branch plan is later updated by the conductor.

## Feedback Loop
- `BR39a-Q1`
  - Branch: `feat/auth-ui-sdk`
  - Owner: Worker A
  - Severity: medium
  - Status: attention
  - Repro steps: inspect `Makefile` for `typecheck-auth-ui`, `build-auth-ui`, and generic `test-packages` targets.
  - Expected: Lot 1 gates from `plan/39a-BRANCH_feat-auth-ui-sdk.md` exist as make targets.
  - Actual: only existing analogous package targets are `typecheck-chat-ui`, `build-chat-ui`, and `test-chat-ui`; no auth-ui-specific or generic package test target exists before Lot 1.
  - Evidence: `rg -n "typecheck-auth-ui|build-auth-ui|test-packages|test-chat-ui|typecheck-chat-ui" Makefile`; `make test-packages SCOPE=packages/auth-ui/tests/auth-contracts.test.ts ENV=test-feat-auth-ui-sdk` failed with `No rule to make target 'test-packages'`; `make typecheck-auth-ui ENV=test-feat-auth-ui-sdk` failed with `No rule to make target 'typecheck-auth-ui'`.
  - Nearest checks: `make typecheck-chat-ui ENV=test-feat-auth-ui-sdk` passed; `make test-chat-ui ENV=test-feat-auth-ui-sdk` passed with 19 files / 79 tests; `make lock-root ENV=test-feat-auth-ui-sdk` updated `package-lock.json` for the new workspace package; `make install-internal-packages ENV=test-feat-auth-ui-sdk` passed as a workspace lock sanity check.
  - Recommendation: keep `Makefile` untouched in this worker slice; add auth-ui-specific make targets in a conductor-approved follow-up or exception, then rerun `packages/auth-ui/tests/**`.

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
- Rationale: this branch delivers one frontend package and one later Sentropic app rewiring. Backend extraction is intentionally split into BR-39b.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only after package, UI, and auth E2E gates pass.
- Development worktree: `tmp/feat-auth-ui-sdk`.
- Branch ports: `API_PORT=9195`, `UI_PORT=5395`, `MAILDEV_UI_PORT=1295`.
- Test envs: `ENV=test-feat-auth-ui-sdk`, `ENV=e2e-feat-auth-ui-sdk`.
- Root UAT env: `ENV=dev` on `/home/antoinefa/src/sentropic`, same HEAD as the branch under qualification.

## Plan / Todo (lot-based)
- [ ] **Lot 0 - Baseline & constraints**
  - [x] Read `rules/MASTER.md`.
  - [x] Read `rules/workflow.md`.
  - [x] Read `rules/subagents.md`.
  - [x] Read `README.md`, `TODO.md`, and `PLAN.md`.
  - [x] Read `plan/39a-BRANCH_feat-auth-ui-sdk.md`.
  - [x] Read `plan/BRANCH_TEMPLATE.md`.
  - [x] Read `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md` and `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`.
  - [x] Confirm isolated worktree path `/home/antoinefa/src/sentropic/tmp/feat-auth-ui-sdk`.
  - [x] Confirm branch `feat/auth-ui-sdk`.
  - [x] Capture Makefile targets needed for `@sentropic/auth-ui`, UI, and E2E gates.
  - [x] Confirm command style with `API_PORT=9195`, `UI_PORT=5395`, `MAILDEV_UI_PORT=1295`, and concrete `ENV=...` value last.
  - [x] Confirm package publication requirements for a new `packages/auth-ui` package, including bootstrap publish and trusted publisher setup.
  - [x] Confirm scope boundaries and declare `BR39a-EXn` before touching conditional paths.
  - [x] Lot 0 commit: `make commit MSG="docs: create auth ui branch plan"`.

- [x] **Lot 1 - Package shell and contracts**
  - [x] Write focused package tests for transport contracts, label/branding defaults, and browser WebAuthn helper behavior before implementation.
  - [x] Create `packages/auth-ui` with `package.json`, `tsconfig.json`, `README.md`, `LICENSE`, and `src/index.ts`.
  - [x] Export transport contracts for email OTP/code, magic-link verify, passkey registration, passkey login, session issue/refresh/logout, and credential list/rename/revoke.
  - [x] Export `AuthUiLabels`, `AuthUiBranding`, `AuthUiNavigation`, `AuthUiSessionCallbacks`, and typed result/error shapes.
  - [x] Move browser-only WebAuthn support checks and start registration/authentication helpers behind package exports.
  - [x] Keep package code free of SvelteKit `$app/*`, Sentropic `$lib/*`, global session stores, and hardcoded API paths.
  - [x] Package README documents Lot 1 contract boundary, downstream path-configurable transport usage, and first-publish bootstrap note.
  - [x] Root workspace lockfile synced through `make lock-root ENV=test-feat-auth-ui-sdk`.
  - [ ] Lot gate:
    - [x] `make typecheck-auth-ui ENV=test-feat-auth-ui-sdk` or record missing target under `BR39a-Q1`.
    - [x] `make test-packages SCOPE=packages/auth-ui/tests/auth-contracts.test.ts ENV=test-feat-auth-ui-sdk` or record missing target under `BR39a-Q1`.
    - [x] Nearest safe existing package/UI make target when auth-ui package targets are missing.
  - [x] Lot 1 commit: `make commit MSG="feat: add auth ui package contracts"`.

- [ ] **Lot 2 - Reusable auth screens**
  - [ ] Add package components for `AuthLogin.svelte`, `AuthRegister.svelte`, `AuthMagicLinkVerify.svelte`, and `AuthDevices.svelte`.
  - [ ] Preserve Sentropic login behavior through package callbacks and injected transport.
  - [ ] Preserve registration behavior through package callbacks and injected transport.
  - [ ] Preserve magic-link verify behavior through host-provided token and redirect callback.
  - [ ] Preserve device-management behavior through injected credential transport.
  - [ ] Add stable slots/snippets or render hooks for logo, product name, secondary action, and alert rendering.
  - [ ] Lot gate:
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests/auth-login.test.ts ENV=test-feat-auth-ui-sdk`
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests/auth-register.test.ts ENV=test-feat-auth-ui-sdk`
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests/auth-devices.test.ts ENV=test-feat-auth-ui-sdk`

- [ ] **Lot 3 - Sentropic app rewiring**
  - [ ] Add Sentropic host transport that maps package calls to existing `/auth/*` endpoints through app-owned API helpers.
  - [ ] Rewire Sentropic auth route pages to render package components.
  - [ ] Keep Sentropic session store updates and navigation in app-owned callbacks.
  - [ ] Keep Sentropic i18n dictionaries app-owned and pass labels into the package.
  - [ ] Lot gate:
    - [ ] `make typecheck-ui ENV=test-feat-auth-ui-sdk`
    - [ ] `make lint-ui ENV=test-feat-auth-ui-sdk`
    - [ ] `make test-ui SCOPE=tests/stores/session.test.ts ENV=test-feat-auth-ui-sdk`
    - [ ] `make test-ui SCOPE=tests/utils/auth-ui.test.ts ENV=test-feat-auth-ui-sdk`

- [ ] **Lot 4 - Consumer integration proof without editing consumer repo**
  - [ ] Add a README section showing how `spa-transpose-cv` maps `/admin/auth/*` endpoints into the package transport.
  - [ ] Add a package-level fixture transport named `createExampleAdminAuthTransport` in tests or docs only.
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
