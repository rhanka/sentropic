# Feature: One-click magic-link sign-in with continuation for keynote-feedbacks

## Objective
Add a per-client `magic_link_sign_in` policy flag (default false) and end-to-end server-side continuation support for one-click e-mail magic-link sign-in on `auth.sent-tech.ca`, while forwarding `continue` and `login_hint` on register links and guarding `/auth/magic-link/verify` with a one-click confirm button against mail scanners.

## Scope / Guardrails
- Scope limited to `packages/auth-hono`, `packages/auth-ui`, `apps/auth-idp`, `api`, and `deploy/k8s/overlays/preprod/idp-identity-sync/client-postcondition.sql`.
- One migration max in `api/drizzle/*.sql` (`0049_oauth_clients_magic_link_sign_in.sql`).
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/idp-magic-link` (`fix/idp-magic-link-keynote`).
- Automated test campaigns run on dedicated environment (`ENV=idp-magic`), never on root `dev`.
- In every `make` command, `ENV=idp-magic` must be passed as the last argument.
- All new text in English (French UI copy in existing i18n label presets).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/auth-hono/package.json`
  - `packages/auth-hono/src/**`
  - `packages/auth-hono/tests/**`
  - `packages/auth-ui/package.json`
  - `packages/auth-ui/src/**`
  - `packages/auth-ui/tests/**`
  - `apps/auth-idp/**`
  - `api/src/**`
  - `api/tests/**`
  - `api/drizzle/0049_oauth_clients_magic_link_sign_in.sql`
  - `api/drizzle/meta/**`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/client-postcondition.sql`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `deploy/k8s/**`
- **Exception process**:
  - `BR-ML-EX1`: Add `api/drizzle/0049_oauth_clients_magic_link_sign_in.sql` (1 file) to add `oauth_clients.magic_link_sign_in` (default false) and `magic_link_continuations` for server-side continuation storage; update `deploy/k8s/overlays/preprod/idp-identity-sync/client-postcondition.sql` so tier-local `magic_link_sign_in` is excluded from prod->preprod exact-row comparison like `required_acr` and `allowed_user_ids`. Reversible by dropping the column/table and reverting the postcondition line.

## Feedback Loop
- `BR-ML-EX1` (`acknowledge`): One migration file `api/drizzle/0049_oauth_clients_magic_link_sign_in.sql` and `client-postcondition.sql` update required for per-client `magic_link_sign_in` flag and server-side magic-link continuations.

## AI Flaky tests
- None expected; all targeted tests are deterministic.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: Single urgent bugfix/feature branch in isolated worktree `tmp/idp-magic-link`.

## UAT Management (in orchestration context)
- [ ] Screen-driven IdP smoke (`make smoke-idp-screens`) verified in `tmp/idp-magic-link` with `ENV=idp-magic`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Create isolated worktree `tmp/idp-magic-link` on branch `fix/idp-magic-link-keynote`.
  - [x] Allocate `ENV=idp-magic` with ports `API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295`.
  - [x] Confirm scope boundaries (`BR-ML-EX1`) in `BRANCH.md`.

- [x] **Lot 1 — Schema, OAuth client policy flag & server-side continuation store**
  - [x] Add `magic_link_sign_in` (`oauth_clients`) and `magic_link_continuations` in `api/src/db/schema.ts` and `api/drizzle/0049_oauth_clients_magic_link_sign_in.sql`.
  - [x] Exclude tier-local `magic_link_sign_in` in `deploy/k8s/overlays/preprod/idp-identity-sync/client-postcondition.sql`.
  - [x] Add `magicLinkSignIn` to `OauthClientRecord`, `oauth-state-adapter.ts`, and `oauth-register-client.ts` (`OAUTH_CLIENT_MAGIC_LINK_SIGN_IN`).
  - [x] Add `GET /login-policy` in `@sentropic/auth-hono` and `api/src/routes/namespaces/oauth*`.
  - [x] Store and consume validated `continue` / `returnUrl` server-side in `cm-magic-link.ts` + `magic-link-continuation.ts` + `challenge-purge.ts`.
  - [x] Bump `@sentropic/auth-hono` (`0.18.2`).

- [x] **Lot 2 — Auth UI components & IdP screens**
  - [x] Add `requestMagicLink` transport method and `magicLinkSignIn` primary form mode in `packages/auth-ui` (`AuthLogin.svelte`, labels EN/FR, contracts).
  - [x] Require one-click confirm button in `AuthMagicLinkVerify.svelte` before calling `verifyMagicLink`, forwarding `continueUrl` via `onRedirect`.
  - [x] Bump `@sentropic/auth-ui` (`0.9.2`).
  - [x] Update `apps/auth-idp/web` login, register, and magic-link/verify pages to query `login-policy`, forward `continue`/`login_hint` on register/login links, and redirect to `continueUrl` on verify.

- [x] **Lot 3 — Tests & validation**
  - [x] Add/update unit tests in `packages/auth-hono/tests/`, `packages/auth-ui/tests/`, and `api/tests/unit/`.
  - [x] Add/update API integration tests in `api/tests/api/auth/`.
  - [x] Extend `apps/auth-idp/screen-smoke.ts` with continuation & confirm-button assertions (verified in CI `smoke-idp-screens`).
  - [x] Typechecks, `lint-api`, auth unit/endpoint/rate-limit tests verified in Docker (`ENV=idp-magic`).

- [ ] **Lot 4 — PR, CI & cleanup**
  - [ ] Create/update PR on GitHub with English description, prod steps, and deploy path.
  - [ ] Remove `BRANCH.md` in final commit, push, and watch `gh pr checks --watch` until green.
