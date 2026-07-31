# Feature: Gmail Read-Only Connector Connection

## Objective
Deliver L3 of `SPEC_EVOL_CONNECTOR_HOST`: a separate Gmail `gmail.readonly` OAuth connection and connector-host mount that reuses the existing Google OAuth security primitives without altering the Drive grant.

## Scope / Guardrails
- Scope limited to `api/**` and `BRANCH.md`.
- No schema or migration changes; migration 0040 already permits `provider='gmail'` rows.
- Consume but do not modify `packages/connector-host/**`, `packages/mcp-platform/**`, or `packages/mcp-connector-google/**`.
- Do not modify `api/src/services/secret-crypto.ts` or Google Drive OAuth behavior; only additive exports may expose its existing helpers.
- Gmail uses the existing Google client secret resolver and state sealer, with `OAUTH_SIGNING_KEK` before `JWT_SECRET` through the existing Drive state helpers.
- Gmail must create, load, update, and disconnect only `provider='gmail'` connector-account rows; Drive rows and grants remain untouched.
- Make-only workflow, no direct Docker commands.
- Automated tests use `API_PORT=9080 UI_PORT=5280 MAILDEV_UI_PORT=1180 ENV=cam`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/src/services/secret-crypto.ts`
  - `api/drizzle/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BR483-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `BR483-ACK1` — Architect ratified provider-parametrized OAuth ownership for the integration lane. The separate Gmail authorization must reuse the Drive client-secret resolver and signed-state helpers, not create credentials, scopes, or sealers.

## AI Flaky tests
- [ ] No AI test is in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one bounded API integration lane with one final validation cycle.

## UAT Management (in orchestration context)
- [x] No UI surface changes; OAuth browser UAT is deferred until the configured Google client has the Gmail callback URI.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Verify `feat/gmail-readonly-connection` with `harness check branch`.
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `SPEC_EVOL_CONNECTOR_HOST.md` §§6, 7, and 10, the Drive OAuth/account/route/host seams, and unit-test conventions.
  - [x] Confirm migration 0040 already permits Gmail rows and no migration is needed.
  - [x] Define the dedicated validation environment: API `9080`, UI `5280`, Maildev `1180`, `ENV=cam`.

- [ ] **Lot 1 — Separate Gmail OAuth and connector-account lifecycle**
- [x] Add Gmail provider/scope OAuth helpers that read the shared Google client secret only through exported `resolveClientSecret` and use `createGoogleDriveOAuthState`/`verifyGoogleDriveOAuthState` unchanged.
- [x] Parameterize connector-account creation, connection lookup, error, token validation, and disconnect by provider with Google Drive as the default.
  - [ ] Prove the Gmail path stores an encrypted `provider='gmail'` row without mutating a Drive row.
  - [ ] Lot gate: `make scope-check`.

- [ ] **Lot 2 — Gmail API routes and deny-by-default host mount**
- [x] Add `POST /api/v1/gmail/oauth/start`, `GET /api/v1/gmail/oauth/callback`, `GET /api/v1/gmail/connection`, and `POST /api/v1/gmail/disconnect` with the authenticated session/workspace guard.
- [x] Add `createGmailConnectorHost()` using `gmailLiveAdapter`, `provider='gmail'`, `googleOAuthAccessToken`, and only `messages.get`, `threads.get`, `messages.list`, and `labels.list`.
  - [ ] Preserve `connector_secret_unavailable` and `connector_secret_unreadable` through the existing secret-port contract.
  - [ ] Lot gate: `make scope-check`.

- [ ] **Lot 3 — Hermetic Gmail proof and validation**
  - [ ] Add `api/tests/unit/gmail-oauth.test.ts` for exact Gmail scope, real-secret state HMAC, production refusal, and separate encrypted account rows.
  - [ ] Add `api/tests/unit/gmail-connector-host.test.ts` for allowed Gmail reads, deny-as-missing writes, both secret codes, and name-only audit events.
  - [ ] Run `make test-api-unit SCOPE=tests/unit/gmail-oauth.test.ts API_PORT=9080 UI_PORT=5280 MAILDEV_UI_PORT=1180 ENV=cam`.
  - [ ] Run `make test-api-unit SCOPE=tests/unit/gmail-connector-host.test.ts API_PORT=9080 UI_PORT=5280 MAILDEV_UI_PORT=1180 ENV=cam`.
  - [ ] Run `make typecheck-lint-api API_PORT=9080 UI_PORT=5280 MAILDEV_UI_PORT=1180 ENV=cam`.
  - [ ] Confirm `make scope-check` and a clean worktree after each commit.
