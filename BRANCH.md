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
  - `api/src/db/schema.ts`
  - `api/drizzle/control/0022_oauth_consent_optional_tenant.sql`
  - `api/drizzle/control/meta/_journal.json`
  - `api/tests/api/auth/oauth-consent-optional-tenant.test.ts`
  - `api/tests/api/tenancy/arch11-tenant-data.test.ts`
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
- [ ] None.

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
  - [x] `oauth_clients.require_tenant` (NOT NULL DEFAULT true; immo-mcp set false); `oauth_consents.tenant_id` nullable, no default, unique key NULLS NOT DISTINCT.
  - [x] Refresh-family triggers: consent invalidation matches the tenant with IS NOT DISTINCT FROM; client tightening of `require_tenant` revokes the client's families.
- [ ] **Lot 3 — Consent store**
  - [ ] Tenant-less key for a tenant-optional client: app row tenant NULL, CM authority row with its own consent id under the client's active registry tenant; tenant-bound clients keep the no-op.
- [ ] **Lot 4 — Validation**
  - [ ] `make typecheck-api` and `make lint-api`.
  - [ ] Scoped API tests: `oauth-consent-optional-tenant`, `cm-oauth-consent`, `oauth-refresh.integration`, `arch11-tenant-data`, `oauth-consent-persistence`, `arch11-consent-tenant-enforce`, `oauth-state-adapter.refresh`.
  - [ ] Opus read-only review in `.h2a/reviews/t1-oauth-consent-optional-tid-opus.md`; s-archi review before the train merges.
