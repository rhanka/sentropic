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
- (none yet)

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
  - [ ] `tenants` table (id/`tid` immutable, name, status active/suspended/offboarded). No `parent_tenant_id`.
  - [ ] `tenant_memberships` table ((user_id,tenant_id) unique; status invited/requested/approved/rejected/suspended; role; approved_by; requested_at/decided_at) mirroring `workspace_memberships`.
  - [ ] `oauth_clients.tenant_id` association kept; default `sentropic` tenant.
  - [ ] D5 migration: seed default `sentropic` tenant + `approved` membership for all existing users; live-default-safe + idempotent.
  - [ ] Negative-test harness scaffold (tenant A → tenant B isolation).
  - [ ] Lot gate: `make typecheck-api` + `make lint-api`; API tests (`api/tests/**` tenancy schema/migration); `make test-api ENV=test-auth-39e`.

- [ ] **Lot 2 — Tenant-scoped acceptance**
  - [ ] Membership status machine (request → approve/reject/suspend).
  - [ ] Minimal `auth-admin` role (D4); tenant-scoped approver authority.
  - [ ] Pending cap + rate-limit + anti-enumeration on join/acceptance.
  - [ ] Lot gate: typecheck/lint; API tests (acceptance flow, anti-enumeration, A→B negatives); `make test-api ENV=test-auth-39e`.

- [ ] **Lot 3 — Tenant claim + selection**
  - [ ] Immutable `tid` claim derived from VALIDATED `approved` membership (never request param).
  - [ ] Tenant selection at `authorize` for multi-membership users; single membership implicit.
  - [ ] Bind tokens to client_id + tenant + membership status + iss + aud + session; lifecycle gates on authorize/token/userinfo/introspect.
  - [ ] Lot gate: typecheck/lint; API tests (claim derivation, selection, token binding, lifecycle); UI/E2E if authorize UI changes; `make test-api ENV=test-auth-39e`.

- [ ] **Lot 4 — RP onboarding / tenant↔client**
  - [ ] Tenant-scoped client governance (redirect/CORS per tenant); design-system clients → `sentropic` tenant.
  - [ ] Decide Lot 5 split here (separate branch or in-line spike).
  - [ ] Lot gate: typecheck/lint; API tests; `make test-api ENV=test-auth-39e`.

- [ ] **Lot 5 — openerp brokered lane (spike, may split)**
  - [ ] Trusted external issuer + RFC8693 token-exchange; `(iss,sub)` composite; optional `org` HINT claim (advisory).
  - [ ] NOT OIDC Federation. Co-design with claude:openerp (related-origins/webauthn eTLD+1 question).
  - [ ] Lot gate: typecheck/lint; API tests; `make test-api ENV=test-auth-39e`.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Integrate `spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md` into canonical specs (or keep standalone); delete the working spec if folded.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (api + auth-hono).
  - [ ] Retest API (cf Lot 1) + E2E groups (cf ci.yml split).
  - [ ] AI flaky run + signatures; user sign-off if any accepted.
  - [ ] Bump affected `packages/auth-hono/package.json` (CI `enforce-package-bump`).
  - [ ] PR body = this BRANCH.md; verify branch CI green.
  - [ ] On UAT + CI OK: commit removal of BRANCH.md, push, merge.
