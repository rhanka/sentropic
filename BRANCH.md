# Feature: ARCH-11 G1c — S2S OBO mint + enrollment table + consent tenant enforcement

## Objective
Ship the G1c slice of ARCH-11 (spec §2.1/§2.2/§4.2.5-6/§5): a soft-ref DB-backed
`connector_tenant_enrollments` table + resolver, an on-behalf-of (OBO) `tid` mint on the
`client_credentials` grant, and tenant-keyed consent lookups — ALL flag-gated on G1b's
`TENANT_RESOLUTION_MODE` so the DEFAULT (`shadow`/`alias`) path is byte-identical to today
(no `tid`, no rejection, single-org consent unchanged); enforcement lives ONLY in `strict`.

## Scope / Guardrails
- Scope limited to: the enrollment control table + api-side resolver, the auth-hono S2S OBO mint,
  the auth-hono consent-port tenant threading, and the api-side consent adapter enforcement.
- One migration max in `api/drizzle/control/*.sql` (control stream; G1a already used `api/drizzle/*.sql`).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) — never test there.
- Branch development in isolated worktree `tmp/arch11-g1c`.
- Automated test campaigns run on `ENV=arch11-g1c` (API) — never on root `dev`.
- `ENV=<env>` passed LAST in every `make` command. Ports: `API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1220`.
- All new text in English.
- **DEFAULT mode = `shadow`/`alias` → NO behavior change. Strict-only enforcement. No prod action.**
- `packages/auth-hono` is a PUBLISHED prod package (the IdP): bump version, keep the default path byte-identical.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/drizzle/control/0004_arch11_connector_enrollments.sql` (the ONE migration)
  - `api/drizzle/control/meta/_journal.json` (journal entry for the migration)
  - `api/src/db/control-schema.ts` (add the `connector_tenant_enrollments` table def)
  - `api/src/services/tenancy/enrollment-store.ts` (new — DB-backed resolver)
  - `api/src/services/auth/service-tenant-adapter.ts` (new — OBO port impl, mode-gated)
  - `api/src/services/auth/consent-store-adapter.ts` (tenant-keyed lookups, mode-gated)
  - `api/src/routes/auth/oauth.ts` (wire the new `serviceTenant` port)
  - `packages/auth-hono/src/ports.ts` (optional `serviceTenant` OBO port + consent `tenantId` params)
  - `packages/auth-hono/src/oauth/token-handler.ts` (OBO `tenant` param + `tid` emission)
  - `packages/auth-hono/src/oauth/authorize-handler.ts` (thread authorize tenant into `hasCoveringGrant`)
  - `packages/auth-hono/src/oauth/consent-decision-handler.ts` (pass sealed tenant to `saveGrant`)
  - `packages/auth-hono/package.json` (version bump)
  - `api/tests/api/tenancy/**`, `api/tests/api/auth/**` (new tests)
  - `packages/auth-hono/tests/**` (new/updated tests)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `packages/mcp-platform/**` (BR-42l MCP-lane territory — `authz.ts` `authorizedTenants` DB-backing + `tenantOfDomainHint`)
  - `ui/**`, other `packages/**` except `packages/auth-hono/**`
  - `api/drizzle/*.sql` (G1a's public stream — untouched)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - snapshot regen `api/drizzle/control/meta/000N_snapshot.json` — NOT done (follows the 0003 hand-written precedent; snapshot drift is pre-existing, out of scope).
- **Exception process**: declare `BR-G1c-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `BR-G1c-EX1` (cross-lane, `attention`): the DB-backed `authorizedTenants` resolver lives api-side
  (`enrollment-store.ts`). Wiring it INTO `packages/mcp-platform/src/authz.ts` (`InMemoryTenantRegistry`
  → a Drizzle `EnrollmentStore`) and the `tenantOfDomainHint` cross-check (spec EX2) are the MCP lane's
  active BR-42l territory and are DELIBERATELY NOT touched here. G1c ships the table + api resolver + OBO;
  the mcp-platform DB-backing is a follow-up coordination with the MCP lane. Status: `attention` (not blocking G1c).
- `BR-G1c-N1` (`acknowledge`): consent tenant threading requires an ADDITIVE optional `tenantId` on the
  auth-hono `getGrant`/`saveGrant` port + threading the already-derived authorize tenant into
  `hasCoveringGrant`/`saveGrant`. This is spec §4.2.5 and stays within Allowed Paths (`packages/auth-hono/**`).
  Byte-identical under default: the api adapter ignores `tenantId` unless mode==`strict`.
- `BR-G1c-N2` (`acknowledge`): the migration is the CONTROL stream (`api/drizzle/control/0004_*.sql`) — G1a's
  ONE public-stream migration was `0038`; "one migration max" is per-stream, this is the control stream. Hand-written
  + manual journal entry, matching the `0003_arch11_grandfather_rekey` precedent (snapshot intentionally not regenerated).
- `BR-G1c-EX2` (`attention`, required peer-range bump): the `auth-hono` minor bump 0.12.0 → 0.13.0 falls OUTSIDE
  `@sentropic/auth-ui@0.7.0`'s peer range (capped `^0.12.0`), breaking `install-internal-packages` (workspace ERESOLVE).
  Reason: a minor bump of a depended-upon package mechanically requires widening dependents' peer ranges — the
  established pattern (auth-ui's range already lists every prior auth-hono minor 0.3–0.12). Impact: minimal —
  `packages/auth-ui/package.json` peer range gains `|| ^0.13.0` + patch bump 0.7.0 → 0.7.1 (NO `src/**` change; the
  `enforce-package-bump` gate is unaffected). auth-ui is consumed only by `ui` via `file:` link (no package cascade).
  Rollback: revert the two package.json lines. This is the only touch OUTSIDE `packages/auth-hono/**`; flagged for architect.

## AI Flaky tests
- No AI generation surface touched. AI-flaky allowlist not exercised. N/A.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal slice (G1c) on one isolated worktree; no independent CI needed.

## UAT Management (in orchestration context)
- No UI surface. UAT = architect review of the diff + the strict-mode enforcement tests. No browser UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `workflow.md`, `subagents.md`, `testing.md`, spec §2.1/§2.2/§4.2.5-6/§5.
  - [x] Ground against code: `token-handler.ts:294`, `state-store-types.ts:78`, `consent-store-adapter.ts`,
        `control-schema.ts`, `resolve-tenant.ts` (G1b), `authz.ts` (mcp-platform, read-only), `authorize-handler.ts`.
  - [x] Confirm worktree `tmp/arch11-g1c` on `feat/arch11-g1c-obo-consent-enforce`.
  - [x] Env mapping: `ENV=arch11-g1c API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1220`; ports free (`make ps-all`).
  - [x] Confirm scope/guardrails; declare `BR-G1c-EX1` cross-lane flag.

- [ ] **Lot 1 — Enrollment table + DB-backed resolver**
  - [ ] Add `connectorTenantEnrollments` table to `api/src/db/control-schema.ts` (soft refs, PK
        `(principal_sub, connector_instance_id, tenant_id)`, `status` CHECK `active|suspended`, timestamps, 2 indexes).
  - [ ] Hand-write `api/drizzle/control/0004_arch11_connector_enrollments.sql` (additive `CREATE TABLE IF NOT EXISTS`,
        DEFAULT-safe, NO cross-namespace FK) + add journal entry idx 4 to `api/drizzle/control/meta/_journal.json`.
  - [ ] Add `api/src/services/tenancy/enrollment-store.ts`:
        `authorizedTenants(principalSub, connectorInstanceId)` (§2.1: active enrollment rows for that connector
        UNION the client's fixed `service_clients.tenant_id` singleton — single-org resolves WITHOUT a row, §1.6 fix);
        `activeEnrollmentTenantsForPrincipal(principalSub)` (client-level, all connectors — for the OBO mint).
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=arch11-g1c` + `make lint-api ENV=arch11-g1c`
    - [ ] **API tests** NEW `api/tests/api/tenancy/arch11-enrollment-store.test.ts`: single-org resolves via fixed tenant
          (no row); active rows included, suspended excluded; NON-VACUOUS ≥2-org (fixed org-A + enrolled org-B → {A,B},
          org-C excluded); per-connector scoping.
      - [ ] Scoped: `make test-api SCOPE=tests/api/tenancy/arch11-enrollment-store.test.ts ENV=arch11-g1c`

- [ ] **Lot 2 — S2S OBO mint (`tid`), strict-gated**
  - [ ] `packages/auth-hono/src/ports.ts`: add `AuthHonoServiceTenantPort.resolveOboTenant({clientId, fixedTenantId,
        requestedTenant})` → `{tid: string|null}` | `{error:'invalid_target', description}`; add optional `serviceTenant?` to `AuthHonoPorts`.
  - [ ] `packages/auth-hono/src/oauth/token-handler.ts`: in `handleClientCredentials`, read `tenant` form param, call
        `serviceTenant.resolveOboTenant` (when present); `error` → 400 `invalid_target`; pass resolved `tid` into
        `issueServiceToken`, which signs `...(tid ? { tid } : {})`. Port ABSENT or `{tid:null}` → byte-identical (no tid).
  - [ ] `api/src/services/auth/service-tenant-adapter.ts` (new): `resolveOboTenant` mode-gated — `alias`/`shadow` →
        `{tid:null}` (byte-identical, no DB read); `strict` → union(fixed, active enrollments via `enrollment-store`);
        size 0 → `invalid_target`; size 1 → omitted binds fixed, supplied must equal else `invalid_target`; size >1 →
        `tenant` mandatory (absent → `invalid_target` fail-closed), out-of-set → `invalid_target`. Audit every mint
        `{client_id, requested_tenant, resolved_tid, outcome}` (§2.2).
  - [ ] `api/src/routes/auth/oauth.ts`: wire `serviceTenant: createServiceTenantAdapter()` into `createSentropicOAuthPorts`.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=arch11-g1c` + `make lint-api ENV=arch11-g1c`
    - [ ] **auth-hono tests** NEW `packages/auth-hono/tests/oauth-service-obo.test.ts`: no `serviceTenant` port → no tid,
          no rejection; port returns `{tid:null}` → no tid; `{tid:'org-a'}` → tid emitted; `{error}` → 400 `invalid_target`.
    - [ ] **API tests** NEW `api/tests/api/auth/arch11-service-obo.test.ts`: shadow default → client_credentials mint has NO
          tid even with `tenant=` param (byte-identical); strict single-org → omitted binds fixed, wrong supplied → 400;
          strict multi-org (enrolled org-A+org-B) → `tenant=org-A` → tid=org-A, missing tenant → 400 fail-closed,
          `tenant=org-C` → 400. NON-VACUOUS ≥2-org.
      - [ ] Scoped: `make test-api SCOPE=tests/api/auth/arch11-service-obo.test.ts ENV=arch11-g1c`

- [ ] **Lot 3 — Consent tenant enforcement, strict-gated**
  - [ ] `packages/auth-hono/src/ports.ts`: add optional `tenantId?: string` to `getGrant`/`saveGrant` (additive, back-compat).
  - [ ] `packages/auth-hono/src/oauth/authorize-handler.ts`: extract the tenant-derivation (currently inline in
        `sealContinuation`) into a helper `deriveAuthorizeTenantId(c, ports, clientTenantId, userId)`; call it before the two
        `hasCoveringGrant` sites (main + resume) and pass the tenant to `getGrant`. Byte-identical when no tenant port.
  - [ ] `packages/auth-hono/src/oauth/consent-decision-handler.ts`: pass `payload.tenantId ?? undefined` to `saveGrant`.
  - [ ] `api/src/services/auth/consent-store-adapter.ts`: mode-gated — `getGrant`/`saveGrant` filter/write the `tenant_id`
        leg ONLY under `strict` with a supplied `tenantId`; otherwise unchanged (`(user_id, client_id)` read, `tenant_id`
        omitted → DEFAULT `'sentropic'`, byte-identical to today).
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=arch11-g1c` + `make lint-api ENV=arch11-g1c`
    - [ ] **auth-hono tests** extend consent test: assert `tenantId` threaded to `getGrant`/`saveGrant`; a memory store
          keyed by `(user, client, tenant)` proves org-B authorize does NOT reuse org-A's grant (same user, two orgs).
    - [ ] **API tests** NEW `api/tests/api/auth/arch11-consent-tenant-enforce.test.ts`: shadow → full authorize→approve→
          re-authorize skip is byte-identical + single `'sentropic'` row; strict + same user in org-A & org-B → grant in org-A,
          org-B authorize (`?tenant=org-b`) RE-SHOWS consent, two distinct rows. NON-VACUOUS §1.5.
      - [ ] Scoped: `make test-api SCOPE=tests/api/auth/arch11-consent-tenant-enforce.test.ts ENV=arch11-g1c`
      - [ ] Non-reg: `make test-api SCOPE=tests/api/auth/oauth-consent-persistence.test.ts ENV=arch11-g1c` (default path unchanged)

- [ ] **Lot 4 — Final validation**
  - [ ] Bump `packages/auth-hono/package.json` 0.12.0 → 0.13.0 (minor: additive OBO + consent tenant threading).
  - [ ] `make typecheck-api ENV=arch11-g1c` + `make lint-api ENV=arch11-g1c`
  - [ ] Full `make test-api ENV=arch11-g1c` green (no regressions; default path byte-identical proven).
  - [ ] `make down ENV=arch11-g1c` — no remaining services.
  - [ ] Report to architect (no PR/merge — architect reviews first).

## Notes
- E2E / UI tests: N/A (no `ui/**` / browser surface; api + published-lib only).
- Default byte-identical proof: `oauth-consent-persistence.test.ts` (unchanged, shadow) + the shadow assertions in the
  new OBO/consent tests + the no-`serviceTenant`-port auth-hono test.
