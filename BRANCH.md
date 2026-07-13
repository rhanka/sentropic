# Feature: ARCH-11 G1a — Tenant DATA reconciliation (DEFAULT-safe, no behavior change)

## Objective
Add the durable `workspace → tenant` edge and tenantize consent/service-client/grandfather columns as a DEFAULT-safe, rolling-deploy-safe DATA migration (spec §4.1 = G1a), with NO behavior change and NO `resolveTenant` code seam (that is G1b). Model real multi-org from day one (schema supports many orgs; current rows populate to the bootstrap org `sentropic`).

## Scope / Guardrails
- Scope limited to `api/**` DATA: one public migration + one control migration, schema typedefs, and API tests.
- One migration file max in `api/drizzle/*.sql` (public stream) — this branch adds exactly one (`0038_arch11_tenant_data.sql`). The `control` stream (`api/drizzle/control/*.sql`) is a SEPARATE migrator stream (applied after public in `run-migrations.ts`); it gets exactly one file (`0003_arch11_grandfather_rekey.sql`), matching the repo's existing dual-stream convention.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`); must remain stable.
- Branch development happens in isolated worktree `tmp/arch11-g1a` only.
- Automated tests run on dedicated env `ENV=arch11-g1a`, never on root `dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- NON-PROD only: never run against prod; never change `TENANT_RESOLUTION_MODE` / strict enforcement.
- All new text in English.

## Environment Mapping (this branch)
- `ENV=arch11-g1a`, `API_PORT=9210`, `UI_PORT=5410`, `MAILDEV_UI_PORT=1210` (verified free via `make ps-all`; unrelated `br39e-lot5` stack on 8792 does not conflict).
- Compose isolation: `COMPOSE_PROJECT_NAME=ENV` ⇒ isolated `arch11-g1a_pg_data` volume; `make clean ENV=arch11-g1a` removes only this branch's volume.
- Migrations applied on api boot (`api/src/index.ts` → `runMigrations()`), so a first `up-api-test ENV=arch11-g1a` on a fresh volume applies 0000..0038 (public) + control 0000..0003 from scratch (the fresh-DB test).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/db/schema.ts`
  - `api/src/db/control-schema.ts`
  - `api/drizzle/0038_arch11_tenant_data.sql`
  - `api/drizzle/meta/_journal.json`
  - `api/drizzle/control/0003_arch11_grandfather_rekey.sql`
  - `api/drizzle/control/meta/_journal.json`
  - `api/tests/api/tenancy/**` (new tests)
  - `api/src/services/auth/consent-store-adapter.ts` (BR-G1a-EX1 — minimal ON CONFLICT compat, see Feedback Loop)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/**`
  - `packages/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/src/**` beyond the two schema files (blocked — G1a is DATA only; no alias rewiring, no `resolveTenant`).
  - `.github/workflows/**`
- **Exception process**: declare `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- **BR-G1a-EX1** (`attention`, scope exception) — Path: `api/src/services/auth/consent-store-adapter.ts` (1 target-list line).
  - Reason: re-keying `oauth_consents` unique index to `(user_id, client_id, tenant_id)` (§1.5, packet-mandated) removes the `(user_id, client_id)` unique index that `saveGrant`'s `onConflictDoUpdate({ target: [userId, clientId] })` relied on. PROVEN regression: `insert ... on conflict ("user_id","client_id")` → `there is no unique or exclusion constraint matching the ON CONFLICT specification`; `api/tests/api/auth/oauth-consent-persistence.test.ts` returned 500 (was 200).
  - Impact: minimal, behavior-preserving — the insert omits `tenant_id` so it takes DEFAULT `'sentropic'`; ON CONFLICT target now matches the composite index. Single-org behavior identical. This is NOT the G1c real-tenant threading of `getGrant`/`saveGrant`/`hasCoveringGrant` (still keyed on `(user,client)` in reads).
  - Rollback: revert the one-line target change; but then the index re-key must also be reverted (they are coupled).
  - **ARCHITECT RATIFIED 2026-07-13 = option (b) TWO-PHASE** (rolling-safe, matches ARCH-11's whole ethos): G1a ADDS the `(user_id, client_id, tenant_id)` composite index but KEEPS the old `(user_id, client_id)` index (migration `0038` no longer drops it) — so during a rolling deploy, old pods (`ON CONFLICT (user,client)`) and new pods (composite) both find a valid index, no break window. The adapter targets the composite (works because the composite exists). **G1c** drops the old index — which is exactly when multi-org consent (and thus the cross-tenant bypass closure) actually opens; until then the stricter old index correctly keeps consent single-org. Test `arch11-tenant-data.test.ts:148` updated to the (b) posture (both indexes present; same-(user,client) cross-tenant insert REJECTED in G1a, deferred to G1c). No maintenance window / deploy-ordering dependency needed.

## AI Flaky tests
- Not applicable: this branch touches no AI code paths. No AI test in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal DATA lot; single final test cycle)
- [ ] **Multi-branch**
- Rationale: One isolated, self-contained DATA change; no independent sub-workstreams.

## UAT Management (in orchestration context)
- No UI/E2E surface. UAT is not applicable to this DATA-only branch; the architect reviews before merge.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/data.md`.
  - [x] Read `spec/SPEC_EVOL_ARCH11_TENANT_RECONCILIATION.md` (§1.5, §2.1, §4.1, §5) and ground on `api/src/db/schema.ts` + `api/src/db/control-schema.ts`.
  - [x] Confirm isolated worktree `tmp/arch11-g1a` on `feat/arch11-g1a-tenant-data`.
  - [x] Define env mapping + ports (9210/5410/1210); verify free (`make ps-all`).
  - [x] Confirm scope/guardrails; migration mechanics (hand-written SQL + journal entry; recent migrations 0033-0037 ship without drizzle snapshots).

- [ ] **Lot 1 — Schema typedefs + migrations (DEFAULT-safe)**
  - [ ] `schema.ts`: `workspaces.tenant_id text NOT NULL DEFAULT 'sentropic' REFERENCES tenants(id)` + `workspaces_tenant_id_idx`.
  - [ ] `schema.ts`: `oauth_consents.tenant_id text NOT NULL DEFAULT 'sentropic'`; re-key unique index to `(user_id, client_id, tenant_id)`.
  - [ ] `schema.ts`: `service_clients.tenant_id` gains `DEFAULT 'sentropic'` (stays nullable).
  - [ ] `control-schema.ts`: `app_instances.tenant_id` + `app_workspace_bindings.tenant_id` gain `DEFAULT 'sentropic'` (stay NOT NULL).
  - [ ] Public migration `api/drizzle/0038_arch11_tenant_data.sql`:
    - [ ] Bootstrap `tenants` row `sentropic` (idempotent `ON CONFLICT DO NOTHING`).
    - [ ] `workspaces.tenant_id` fast-default `ADD COLUMN ... DEFAULT 'sentropic' NOT NULL` + FK + index (PG ≥11 fast-default, no rewrite).
    - [ ] Re-backfill `tenant_memberships` (`approved`/`member`) for all existing users (idempotent).
    - [ ] `oauth_consents.tenant_id` STAGED: `ADD COLUMN` nullable → per-row backfill (user's approved tenant; single-org → `sentropic`) → `SET DEFAULT` → `SET NOT NULL`.
    - [ ] Swap consent unique index `(user_id, client_id)` → `(user_id, client_id, tenant_id)` (closes §1.5 cross-tenant consent gap).
    - [ ] `service_clients`: `UPDATE ... SET tenant_id='sentropic' WHERE NULL` + `SET DEFAULT 'sentropic'`.
    - [ ] Add journal entry idx 38.
  - [ ] Control migration `api/drizzle/control/0003_arch11_grandfather_rekey.sql`:
    - [ ] `app_instances`: `SET DEFAULT 'sentropic'`; backfill `identity_tenant_id` (real tenant via bound workspace / fallback `sentropic`); re-key `tenant_id` only where it holds a non-tenant (alias) value.
    - [ ] `app_workspace_bindings`: `SET DEFAULT 'sentropic'`; backfill `identity_tenant_id` from the bound workspace's real tenant; re-key `tenant_id` alias values.
    - [ ] `object_type_definitions`: re-key `tenant_id` alias values (tenant-scoped rows only; global `null` untouched; no default).
    - [ ] Add control journal entry idx 3.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=arch11-g1a` + `make lint-api ENV=arch11-g1a`
    - [ ] `make up-api-test API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1210 ENV=arch11-g1a` (fresh volume ⇒ proves migration applies cleanly on a fresh DB).

- [ ] **Lot 2 — API tests (`api/tests/api/tenancy/arch11-tenant-data.test.ts`)**
  - [ ] Migration applied: `workspaces.tenant_id` exists, NOT NULL, FK to `tenants`, default `sentropic`; `sentropic` tenant row present.
  - [ ] DEFAULT-safe (old-semantic insert): insert a `workspaces` row WITHOUT `tenant_id` (old-pod semantics) ⇒ row persists with `tenant_id='sentropic'` (no NOT NULL violation).
  - [ ] DEFAULT-safe (consent): insert an `oauth_consents` row WITHOUT `tenant_id` ⇒ persists with `tenant_id='sentropic'`.
  - [ ] Backfill: an existing (pre-migration-shaped) workspace/consent maps to `sentropic`; every existing user has an `approved` `sentropic` `tenant_memberships` row.
  - [ ] Consent unique index is `(user_id, client_id, tenant_id)`: same `(user,client)` under two DIFFERENT tenants coexist; same `(user,client,tenant)` triple conflicts (upsert target).
  - [ ] Grandfather columns reconciled: `app_instances`/`app_workspace_bindings` `tenant_id` have `DEFAULT 'sentropic'`; a binding's `identity_tenant_id` backfills to its workspace's real tenant.
  - [ ] **NON-VACUOUS multi-org isolation**: seed ≥2 real orgs (`tenants` orgA/orgB), a workspace per org, `tenant_memberships`, and per-tenant consents; assert row-level isolation on the new columns — a query filtered by orgB never returns orgA's workspace/consent rows, and orgA's consent does NOT satisfy the `(user,client,tenant)` key for orgB.
  - [ ] Scoped run: `make test-api-endpoints SCOPE=tests/api/tenancy/arch11-tenant-data.test.ts ENV=arch11-g1a`.
  - [ ] Sub-lot gate: `make test-api-endpoints ENV=arch11-g1a` (regression: existing auth/consent/workspace tests still green with the new NOT-NULL-with-default columns).

- [ ] **Lot 3 — Final validation**
  - [ ] `make typecheck-api ENV=arch11-g1a` + `make lint-api ENV=arch11-g1a`
  - [ ] `make test-api-unit ENV=arch11-g1a` + `make test-api-endpoints ENV=arch11-g1a` (+ `test-api-outbox`/`test-api-object-registry` if control columns touched).
  - [ ] Teardown: `make clean ENV=arch11-g1a` (removes only this branch's volume).
  - [ ] Report to architect (no PR/merge — architect reviews first).

## Deferred to G1b/G1c/G1d
- `resolveTenant` seam + alias-site rewiring + shadow/strict flag (§4.2/§4.3) → G1b.
- `connector_tenant_enrollments` table + S2S OBO mint + tenantized consent LOOKUPS + `pg-comment-store` filter (§2.1/§2.2/§4.2) → G1c.
- Broker `resource_grants` + UBO/outbox JSONB re-key + multi-org egress (§4.1.7/§7) → G1d.
- `@sentropic/contracts` major bump for the tenantId semantic change (§4.5) → gated on ARCH-12, with G1b.
