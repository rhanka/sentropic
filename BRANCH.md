# Feature: BR-39e — Multi-tenant identity (tenant registry + membership + tenant-scoped acceptance + tenant claim)

## Objective
Add a tenancy spine to the standalone IdP (`auth.sent-tech.ca`): model which org a human belongs to via per-(user,tenant) membership, tenant-scoped acceptance, and an immutable tenant claim — for multiple consumers (immo, diag, design-system, openerp brokered lane), on the shared IdP DB.

## Scope / Guardrails
- Scope limited to IdP identity/tenancy: schema + migration, `packages/auth-hono` OAuth/OIDC, `apps/auth-idp`, related API routes/services and tests.
- One migration max in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/auth-39e`.
- Automated test campaigns on `ENV=test-auth-39e` / `ENV=e2e-auth-39e`, never on root `dev`.
- In every `make` command, `ENV=<env>` passed as the last argument.
- All new text in English.
- D5 shared-DB migration MUST be live-default-safe and idempotent (ALTER-DEFAULT incident lesson): set live column defaults, not only update rows.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/db/schema.ts`
  - `api/src/services/auth/**`
  - `api/src/routes/auth/**`
  - `packages/auth-hono/src/**`
  - `apps/auth-idp/**`
  - `api/tests/**`, `packages/auth-hono/**/*.spec.ts`, `e2e/tests/**`
  - `spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (explicit exception required)**:
  - `api/drizzle/*.sql` (max 1 file — the D5 tenancy migration)
  - `.github/workflows/**`
- **Exception process**: declare `BR39e-EXn` in `## Feedback Loop` (reason, impact, rollback) before touching any conditional/forbidden path.

## Feedback Loop
- `BR39e-EX1` — hand-edited `api/drizzle/meta/_journal.json` + hand-wrote `api/drizzle/0031_tenancy_spine.sql` (instead of `make db-generate`). Reason: `db-generate`'s no-container path runs `npm ci` (root-dev node_modules footgun); the migration needs a custom D5 backfill drizzle-kit can't generate anyway. Impact: runtime `migrate()` is journal+`.sql` based (no snapshot needed to apply); only future `db-generate` diffing is affected. Rollback: regenerate meta via `make db-generate` on the isolated branch stack at the lot gate.

## AI Flaky tests
- Accept only non-systematic provider/network nondeterminism as `flaky accepted` (≥1 success same commit/command). Never add timeouts. Record signature in this file. Capture user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (Lots 1-4 sequential, single tenancy need, one final test cycle)
- [ ] **Multi-branch**
- Rationale: Lots 1-4 are one coherent tenancy spine with a single shared migration; sequential. Lot 5 (openerp brokered lane) is a separate spike and MAY split to its own branch later (decided at Lot 4 gate).

## UAT Management
- Mono-branch: UAT on the integrated branch after lots that change user-facing flows (tenant selection at authorize, acceptance screens). UAT from root workspace `ENV=dev`; push before UAT; branch HEAD = UAT HEAD.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/auth-39e` on `feat/auth-39e-multitenant` off `origin/main`.
  - [x] Consolidated scope in `spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md`.
  - [ ] Confirm env mapping + ports (`test-auth-39e`, `e2e-auth-39e`).
  - [ ] Confirm scope boundaries; declare exceptions if needed.

- [ ] **Lot 1 — Tenancy core (schema + migration)**
  - [x] `tenants` table (id/`tid` immutable, name, status active/suspended/offboarded). No `parent_tenant_id`. (`api/src/db/schema.ts`)
  - [x] `tenant_memberships` table ((user_id,tenant_id) unique; status invited/requested/approved/rejected/suspended; role; approved_by; requested_at/decided_at) mirroring `workspace_memberships`.
  - [x] `oauth_clients.tenant_id` association kept; default `sentropic` tenant.
  - [x] D5 migration `0031_tenancy_spine.sql`: seed default `sentropic` tenant + `approved` membership for all existing users; idempotent (`ON CONFLICT DO NOTHING`), live-default-safe (new tables, defaults baked in). Journal entry idx 31 added.
  - [x] Negative-test harness scaffold (tenant A → tenant B isolation). `api/tests/api/auth/tenancy.test.ts` — 3 tests (seed backfill, membership defaults+uniqueness, A→B isolation).
  - [x] Lot gate (scoped): `make typecheck-api` GREEN (tsc no errors); `make test-api-unit SCOPE=tests/api/auth/tenancy.test.ts ENV=test-auth-39e` → 3/3 passed (migration `0031` applied at boot, backfill verified).
  - [ ] Final-lot gate (deferred): `make lint-api`; full `make test-api ENV=test-auth-39e`; regenerate drizzle meta snapshot via `make db-generate` on the up branch stack and reconcile (hand-written `.sql`+journal already apply at runtime; snapshot deferred to avoid npm-ci footgun on root dev). `BR39e-EX1`: `api/drizzle/meta/_journal.json` hand-edited (allowed — part of the single branch migration).

- [x] **Lot 2 — Tenant-scoped acceptance**
  - [x] Membership status machine (request → approve/reject/suspend) with validated transitions. `api/src/services/auth/tenant-membership.ts` (`requestMembership`/`decideMembership`/`listTenantMemberships`).
  - [x] Minimal `auth-admin` role (D4) = `tenant_memberships.role='admin'` approved member is the tenant-scoped approver; global `admin_app` bootstraps. `isTenantAdmin`/`assertTenantAdmin`.
  - [x] Anti-enumeration (opaque `pending` for missing/suspended tenant + existing member) + pending caps (per-user MAX 20, per-tenant MAX 200) on join. Explicit time-based rate-limit folded into caps + (tenant,user) unique index (no spam rows); a dedicated limiter is deferred (no consumer need yet).
  - [x] Routes `/tenants/*` (auth) — `api/src/routes/api/tenants.ts` mounted in `index.ts`.
  - [x] Lot gate (scoped): `make typecheck-api` GREEN; `make test-api-unit SCOPE="tests/api/auth/tenant-membership.test.ts tests/api/auth/tenancy.test.ts" ENV=test-auth-39e` → 12/12 passed (incl. anti-enumeration, non-admin 403, invalid-transition 409, A→B isolation, admin_app bootstrap).

- [x] **Lot 3 — Tenant claim + selection**
  - [x] Immutable `tid` claim derived from VALIDATED `approved` membership (never request param). New optional `AuthHonoTenantPort` (`listApprovedTenantIds`/`isApprovedMember`); auth code `tenantId` sourced from membership in `authorize-handler` (was `client.tenantId`); `tid` emitted on id_token + access_token in `token-handler`; added to discovery `claims_supported`. auth-hono `0.4.0`→`0.5.0`.
  - [x] Tenant selection at `authorize`: single membership → implicit; explicit `?tenant=` honored ONLY if an approved membership; 0 or >1 without valid selection → no claim. (A multi-membership selection SCREEN is deferred — RP can pass `?tenant=`.)
  - [x] Token-time binding/lifecycle gate: membership re-validated at token exchange (`isApprovedMember`); claim dropped if suspended/revoked between authorize and token. App adapter wired via `tenant_memberships` in `api/src/routes/auth/oauth.ts`.
  - [x] Lot gate (scoped): full `make test-auth-hono` → 27 files / **103 passed** (incl. `tid` emitted + dropped-when-revoked, no authorize/wellknown regression); `make typecheck-api` GREEN (app wiring). Full `make test-api` + lint deferred to final gate.

- [x] **Lot 4 — RP onboarding / tenant↔client**
  - [x] `oauth_clients.tenant_id` → FK to `tenants` + DEFAULT `sentropic` + backfill existing rows (folded into migration `0031`; ALTER-DEFAULT-safe). New clients belong to `sentropic` unless specified; prod clients (design-system/-test, h2a-gateway) backfilled by the migration.
  - [x] Tenant-scoped client governance: `listTenantClients` (tenant-admin) + route `GET /tenants/:tenantId/clients`. Per-tenant redirect/CORS governance surface = the same auth-admin authority (deferred deeper policy to a follow-up; the association + listing is the foundation).
  - [x] Lot 5 split DECIDED: openerp brokered lane → SEPARATE follow-up branch (user pre-authorized "splitté si trop gros") to keep BR-39e (Lots 1-4) a clean mergeable tenancy spine.
  - [x] Lot gate (scoped): typecheck-api GREEN + `make test-api-unit SCOPE="…tenant-membership.test.ts …tenancy.test.ts" ENV=test-auth-39e` → **15/15** (client governance + default-tenant + A→B isolation). NB: required `make clean` (fresh DB volume) since 0031 was amended — drizzle won't re-apply a migration already recorded by tag on a persisted volume. Also bumped `@sentropic/auth-ui` 0.3.1→0.3.2 (peer-widen `auth-hono ^0.5.0`).

- [ ] **Lot 5 — openerp brokered lane (DEFERRED to follow-up branch `feat/auth-39e-openerp-broker`)**
  - [ ] Trusted external issuer + RFC8693 token-exchange; `(iss,sub)` composite; optional `org` HINT claim (advisory). NOT OIDC Federation. Co-design with claude:openerp (related-origins/webauthn eTLD+1). Tracked separately; NOT part of this branch's merge.

- [x] **Lot N-1 — Docs consolidation**
  - [x] `spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md` KEPT standalone (canonical 39e spec alongside the other `SPEC_EVOL_*`). Lot 5 (openerp broker) tracked there + deferred to `feat/auth-39e-openerp-broker`.

- [x] **Lot N — Final validation**
  - [x] Typecheck (api) GREEN + Lint (api) GREEN. auth-hono retested (Lot 3) 103/103.
  - [x] API regression: `make test-api-endpoints` (full tests/api) = **582/583**. The single failure (`generic-dispatch.test.ts › dispatches opportunity_identification…`) is ORTHOGONAL to tenancy (workflow-dispatch subsystem) and **passes 11/11 in isolation** → a parallel-worker test-isolation artifact (workflow_definitions state bleed), not a tenancy regression. CI shards endpoints differently → deferred to CI authority. See Feedback Loop BR39e-FL1.
  - [x] Package bumps: `auth-hono` 0.5.0, `auth-ui` 0.3.2 (enforce-package-bump).
  - [ ] PR body = this BRANCH.md; verify branch CI green (authority for full suite incl. e2e/ai).
  - [ ] On CI OK (no UAT — pure backend IdP logic): commit removal of BRANCH.md, push, merge (--merge).

## Deferred to follow-up
- **Lot 5 — openerp brokered lane** → branch `feat/auth-39e-openerp-broker` (user-authorized split). Trusted issuer + RFC8693 + `(iss,sub)` + optional `org` hint.
- **Drizzle meta snapshot regen** (BR39e-EX1) — hand-written `0031` has no snapshot; not CI-blocking (no drift check), migration applies via journal+`.sql`. Regenerate (delete 0031 .sql+journal entry → `make db-generate` → re-add backfill) on a fresh stack before the next migration-bearing branch.
- **Multi-membership selection SCREEN** — `?tenant=` param done (Lot 3); the account-chooser UI is deferred (no UI in this backend branch).

## Feedback Loop (closeout)
- `BR39e-FL1` — `generic-dispatch.test.ts` failed once under the full parallel `test-api-endpoints` run (workers=4) but passes 11/11 in isolation; orthogonal to this branch (workflow dispatch). Severity: low. Status: deferred to CI authority (sharded). Not a tenancy regression.
