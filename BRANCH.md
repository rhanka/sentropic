# Feature: Multi-account document connector accounts

## Objective
Enable multiple distinct connector accounts per workspace, user, and provider, subject to a globally admin-configurable maximum with a default of five.

## Scope / Guardrails
- Scope limited to the API plane for `document_connector_accounts` and its Google Drive account lifecycle.
- One migration in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Work only in `tmp/connector-accounts-multi`.
- Automated test campaigns use `ENV=test-connector-accounts-multi`, never `ENV=dev`.
- Every Make command passes `ENV` last.
- Preserve encrypted token custody and existing Google Drive route behavior.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/drizzle/0040_connector_accounts_multi_account.sql`
  - `api/drizzle/meta/**`
  - `api/src/config/env.ts`
  - `api/src/db/schema.ts`
  - `api/src/routes/api/settings.ts`
  - `api/src/services/google-drive-connector-accounts.ts`
  - `api/src/services/settings.ts`
  - `api/tests/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/drizzle/control/**`
  - `api/src/services/tenancy/**`
  - `packages/**`
  - `gateway/**`
  - `mesh/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (one public migration only)
- **Exception process**:
  - Declare exceptions in `## Feedback Loop` before touching conditional paths.

## Feedback Loop
- BRCA-EX1 `acknowledge`: add one public migration at `api/drizzle/0040_connector_accounts_multi_account.sql` to change the provider check and account identity unique constraint. Impact: existing rows remain valid; rollback is a down migration restoring the previous constraint. Owner-directed in task statement.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [x] Verify `feat/connector-accounts-multi-account` with `harness check branch`.
  - [x] Read project rules, connector, settings, and ARCH-11 boundaries.
  - [x] Declare BRCA-EX1 before the migration.
- [ ] **Lot 1 — Database account identity**
  - [ ] Add `0040_connector_accounts_multi_account.sql` and update Drizzle metadata.
  - [ ] Change the `documentConnectorAccounts` unique index to include `accountSubject`.
  - [ ] Validate migration generation and schema metadata consistency.
- [ ] **Lot 2 — Account lifecycle and configured limit**
  - [ ] Add global default and environment fallback for `connector_accounts_max_per_provider`.
  - [ ] Add admin settings GET/PUT for the connector-account maximum using the existing settings route gate.
  - [ ] List connector accounts, preserve reconnect upsert behavior, and reject only a new subject at the configured limit.
  - [ ] Preserve token encryption and existing most-recent Google Drive account behavior.
- [ ] **Lot 3 — API tests and validation**
  - [ ] Update `api/tests/unit/google-drive-connector-accounts.test.ts` for multiple accounts, reconnect, and typed limit failure.
  - [ ] Add or update focused settings-route tests for admin read/update and effective limit changes.
  - [ ] Verify Gmail is accepted by the table schema/migration test coverage.
  - [ ] Run focused API tests, `make typecheck-api`, `make lint-api`, and migration generation validation with `ENV=test-connector-accounts-multi`.
- [ ] **Lot 4 — Final validation**
  - [ ] Run required API typecheck and focused connector-account/settings tests.
  - [ ] Run `make scope-check` before every commit.
  - [ ] Stop the isolated environment with `make down ENV=test-connector-accounts-multi`.
