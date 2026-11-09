# Feature: OAuth consent with an optional tenant (A1, T1 prod A4 prerequisite)

## Objective
- [ ] Store an OAuth consent by (user, client) with an OPTIONAL tenant, so a user with no approved sentropic membership can keep an offline consent for a tenant-optional client (immo-mcp connector), while tenant-bound clients (sentropic MCP, h2a-cli) keep requiring an approved membership (s-archi verdict A1, `.tmp/rv/app-plan-archi-verdict.md`).

## Scope / Guardrails
- [x] Branch fix/oauth-consent-optional-tid from origin/main c22163106; worktree tmp/worktrees/t1-oauth-consent-optional-tid; ENV=test-t1a-consent; API_PORT=9271 UI_PORT=5471 MAILDEV_UI_PORT=1371.
- [x] Make only; no Python; no attribution trailers; never ENV=dev; wagon pushes its branch only (no PR, no version bump, no lock regeneration).
- [x] One control migration; no public `api/drizzle/*.sql` migration (the consent triggers live in the control stream, applied after `public`).
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/auth/consent-store-adapter.ts`
  - `api/src/services/auth/oauth-consent-key.ts`
  - `api/src/services/artifacts/credentials.ts`
  - `api/src/db/schema.ts`
  - `api/drizzle/control/0022_oauth_consent_optional_tenant.sql`
  - `api/drizzle/control/meta/_journal.json`
  - `api/tests/api/auth/oauth-consent-optional-tenant.test.ts`
  - `api/tests/api/auth/oauth-consent-tenantless-rekey.test.ts`
  - `api/tests/utils/oauth-consent-flow.ts`
  - `api/tests/api/tenancy/arch11-tenant-data.test.ts`
  - `spec/DATA_MODEL.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `ui/**`
  - `deploy/**`
  - `packages/**`
  - `api/src/services/identity/cm-import-*.ts` (hashed by `a4MappingAssetSha256`)
  - `api/drizzle/control/0015_app_cm_identity_cutover.sql`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [ ] `attention` (s-archi ratification): tenant-optional set = immo-mcp, radar-immobilier, radar-immobilier-preprod, design-system; tenant-bound = sentropic-mcp, h2a-cli and every other or future client (`require_tenant` default true). Opus r1 finding 2.
- [ ] `attention` (s-archi ruling): the tenant-less CM authority row carries the client's registry tenant (`sentropic`); the artifacts host excludes the tenant-less consent id explicitly. Opus r1 finding 4.
- [ ] `deferred` (follow-up wagon, `deploy/**` forbidden here): `idp-identity-sync/import-preprod.sql` compares `tenant_id` with `=` (NULL-unsafe); the client sync and `oauth-register-client.ts` do not carry `require_tenant`. Opus r1 finding 6.
- [ ] `attention` (T3 runbook): auth-idp runs no migration and its client read lists `require_tenant`; control 0022 must be applied by the api before auth-idp serves. Opus r1 finding 7.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable so far.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**
- Rationale: T1 wagon; the train lane merges every wagon into one train branch with one PR and one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Tests first**
  - [x] `api/tests/api/auth/oauth-consent-optional-tenant.test.ts`: non-member + tenant-optional client gets a tenant-less offline consent, a refresh token and refreshes without `tid`; tenant-bound client refuses a non-member (no consent row, no CM authority); member tenant-keyed grant kept apart from a later tenant-less grant; consent withdrawal and client tightening revoke the tenant-less refresh family.
  - [x] `api/tests/api/tenancy/arch11-tenant-data.test.ts`: an insert without tenant is tenant-less (no default) and unique per (user, client).
- [x] **Lot 2 — Schema and control migration**
  - [x] `oauth_clients.require_tenant` (NOT NULL DEFAULT true; the tenant-optional set above set false); `oauth_consents.tenant_id` nullable, no default, unique key NULLS NOT DISTINCT.
  - [x] A1-REKEY: a non-member tenant-keyed grant of a tenant-optional client with live CM authority moves to the tenant-less key (offline evidence, grant time and NULL-tenant families kept); the tenant-keyed CM authority is revoked.
  - [x] Refresh-family triggers: consent invalidation matches the tenant with IS NOT DISTINCT FROM; making a client tenant-bound or re-homing it revokes the client's families.
- [x] **Lot 3 — Consent store**
  - [x] Tenant-less key for a tenant-optional client: app row tenant NULL, CM authority row with its own consent id under the client's active registry tenant; tenant-bound clients keep the no-op.
  - [x] `revokeCmOAuthConsent` withdraws the tenant-less key when no tenant is given; the artifacts host never accepts the tenant-less CM consent id.
- [ ] **Lot 4 — Validation**
  - [ ] `make typecheck-api` and `make lint-api`.
  - [ ] Scoped API tests: `oauth-consent-optional-tenant`, `oauth-consent-tenantless-rekey`, `cm-oauth-consent`, `oauth-refresh.integration`, `arch11-tenant-data`, `oauth-consent-persistence`, `arch11-consent-tenant-enforce`, `oauth-state-adapter.refresh`, `artifacts-host-credentials`.
  - [x] Opus read-only review r1 `.h2a/reviews/t1-oauth-consent-optional-tid-opus.md` on bc68edbbf: REQUEST_CHANGES (2 MAJOR, 5 MINOR, 3 NIT); findings 1, 2, 3, 5, 8, 9, 10 fixed, 4 partly fixed, 4/6/7 in the Feedback Loop.
  - [ ] Argon review r2 (resume lane: Opus quota out); s-archi review before the train merges.
