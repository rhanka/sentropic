# Feature: App control-plane tables + service (BR-45 / ARCH-01 impl)

## Objective
Realize the app control-plane model from SPEC_EVOL_APP_CATALOG §2 Q2 (decided D1=B/D2=B/D7=A): add the `control` tables `app_templates` (family-versioned; published rows IMMUTABLE; `family_id`+`blueprint_schema_version`, NO desired/observed), `app_instances` (pin a published template@version + a SEPARATE `provisioning`/`active`/`suspended`/`retired` status state machine), `app_instance_hostnames` (hostname PK — one host→one instance, DB-guaranteed), `app_workspace_bindings` (M:N workspace↔instance) — working names, framed naming D0 owner-validate at merge — + an `AppControlPlane` service (template lifecycle, instance create + status transitions, hostname add, workspace-binding upsert; all guards ATOMIC per the Codex review). Mirrors the BR-59/BR-60 control-schema pattern. EXPLICITLY OUT: the catalog projection (`kind:'app'` — BR-46 contract delta), any `@sentropic/contracts` `TenantContext` mutation (BR-46 D0), deployment execution + runtime-health/`observed` filling (ARCH-17), tenant re-key (ARCH-11; this branch uses composite tenant columns, grandfather-compatible, no re-key).

## Scope / Guardrails
- Scope limited to the `control` schema + a new app-control-plane service; no product-schema change.
- ONE migration in `api/drizzle/control/*.sql` (generated via `make db-generate-control`).
- Make-only workflow; no direct Docker commands.
- Root `ENV=dev` reserved for the user; tests on `ENV=test-app-control-plane`.
- `ENV=<env>` LAST arg of every `make` command.
- Ports (branch nn=45, slot 0): API `9225`, UI `5425`, Maildev UI `1325`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/db/control-schema.ts` (additive: 4 new tables next to eventOutbox/objectTypeDefinitions)
  - `api/src/services/app-control-plane/**` (new service)
  - `api/tests/unit/app-control-plane.test.ts` (CI-covered `unit` suite)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/contracts/**` (TenantContext mutation = BR-46 D0)
  - `api/src/services/catalog/**` (the `kind:'app'` projection waits for BR-46 policy)
  - `api/src/db/schema.ts` (product schema — app control-plane lives in `control`)
- **Conditional Paths (allowed only with explicit BR45-EXn exception)**:
  - `api/drizzle/control/*.sql` + `api/drizzle/control/meta/**` (ONE migration via `make db-generate-control` — declared BR45-EX1)

## Feedback Loop
- `acknowledge` (BR45-RESET — built from a STALE spec, reset + reworked): the first impl read SPEC_EVOL_APP_CATALOG from the main working-tree (on a different branch) and built the WRONG 3-table model (generic `resource_bindings`, `environment dev|preprod|prod`, no instance status, no hostnames). `git reset --hard` + reworked against the AUTHORITATIVE worktree spec §2 Q2 (4 tables: templates `family_id`/no-desired-observed, instances `prod|preview|local`+`provisioning|active|suspended|retired`, hostnames PK, workspace-bindings M:N). Lesson recorded in memory (read specs from the worktree). Codex 5.5-xhigh review folded: atomic lifecycle/instance-create (tx+FOR UPDATE)/binding-upsert, real SemVer, deprecate-only-from-published.
- `BR45-EX1` (Conditional-path exception, MANDATORY): touches `api/drizzle/control/0002_*.sql` + `api/drizzle/control/meta/{0002_snapshot.json,_journal.json}` — the ONE control migration for the 4 new tables, generated via `make db-generate-control` (mirrors the BR-59/BR-60 control-migration precedent). Rationale: the tables require a migration; impact: control-schema-only, additive; rollback: drop the migration file + revert the journal/snapshot.
- `BR45-REV2` (Codex re-review, applied): `(family_id, version)` made UNIQUE (instance pin addresses by it); `allowed_workspace_types` → `text[]` (spec §2 Q2, was jsonb); `bindWorkspace` now verifies the instance exists (no orphan bindings). Prior fixes confirmed (atomic guards / real SemVer / env / lifecycle).
- `attention` (BR45-D0-NAMES — framed D0, HOLD merge): durable table names `control.app_templates`/`app_instances`/`resource_bindings` are a D0 (SPEC_EVOL_APP_CATALOG §5 — "owner-validate at IMPL"). This branch BUILDS with the study's working names but the MERGE must wait for owner validation (escalate conductor→rhanka; I do not sign D0). Names are confined to the schema file + the migration for a cheap rename if the owner picks different.
- `acknowledge` (tenant approach — decided): composite tenant columns now (`tenant_id` = IdP tenant slug/`tid`; `workspace_id?` = product scope), grandfather-compatible, NO re-key. `identity_tenant_id` is left for the ARCH-11 backfill (added as a nullable column now per the decided gradual path, populated later — no flag-day).
- `acknowledge` (consensus): SPEC_EVOL_APP_CATALOG is double-consensus (Opus 4.8 + Codex 5.5-xhigh CONVERGED). Impl-time: light Codex review of the concrete schema before commit (mirrors BR-52/BR-70 discipline).

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism (≥1 success same commit+command); never add timeouts; analyze vs `main`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (one cohesive control-plane addition; single final test cycle)
- [ ] **Multi-branch**
- Rationale: schema + service + tests are one foundations unit, no independent sub-workstream.

## UAT Management (in orchestration context)
- No UI surface → no interactive UAT; validation is API unit tests (the tables/service have no route wiring in this branch; consumed by tests until BR-46 projection + BR-53 auth land).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read SPEC_EVOL_APP_CATALOG + SPEC_EVOL_APP_TEMPLATE_LIFECYCLE; confirm decided D1=B/D2=B/D7=A + tenant composite-cols + naming D0.
  - [x] Confirm control-schema pattern (controlSchema.table; eventOutbox/objectTypeDefinitions precedents).
  - [x] Worktree `tmp/app-control-plane` from `origin/main`; `cp ../../.env .env`.

- [ ] **Lot 1 — control tables + migration**
  - [ ] `control-schema.ts`: `appTemplates` (id, app_slug, version, owner_tenant_id, identity_tenant_id?, status draft|published|deprecated, blueprint jsonb, manifest_ref, capabilities jsonb, policy_defaults jsonb, desired jsonb, observed jsonb, created_by, created_at, updated_at) — unique (app_slug, version); CHECK status IN set; index (owner_tenant_id).
  - [ ] `appInstances` (id, template_id, template_version pinned, tenant_id, identity_tenant_id?, workspace_id?, environment, public_host, route_mounts jsonb, deployment_ref, desired jsonb, observed jsonb, created_at, updated_at) — index (template_id), (tenant_id); CHECK environment in set.
  - [ ] `resourceBindings` (id, tenant_id, identity_tenant_id?, resource_kind, resource_id, workspace_id?, binding_role, policy jsonb, desired jsonb, observed jsonb, created_at, updated_at) — index (tenant_id, resource_kind, resource_id); CHECK binding_role/resource_kind in set.
  - [ ] Generate migration: `make db-generate-control` → fix `CREATE SCHEMA IF NOT EXISTS` idempotency if regenerated (BR-60 lesson); commit `_snapshot.json` too.
  - [ ] Lot gate: `make typecheck-api lint-api ENV=test-app-control-plane`.

- [ ] **Lot 2 — AppControlPlane service + tests**
  - [ ] `app-control-plane/app-control-plane.ts`: port + Pg adapter — template CRUD (create draft / publish [draft→published, immutable] / deprecate), instance create (pins template_id+version, rejects non-published template), binding upsert; validation (semver version, app_slug shape, status transitions draft→published→deprecated only, instance pins an EXISTING published template_version); projection-status fields (validation status + projection revision + last_projected_at on the template `observed`). Anti-pollution caps mirror BR-59 (MAX per scope).
  - [ ] `app-control-plane/index.ts` singleton.
  - [ ] **API tests** (`api/tests/unit/app-control-plane.test.ts`): template create/publish-immutability/deprecate transitions + invalid-transition reject; instance pins published version (reject draft/unknown); binding upsert; unique (app_slug,version); status CHECK; composite tenant columns round-trip.
  - [ ] Lot gate: `make typecheck-api lint-api test-api-unit SCOPE=tests/unit/app-control-plane.test.ts ENV=test-app-control-plane`.
  - [ ] Impl-time Codex 5.5-xhigh review of the concrete schema + service before commit.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (api).
  - [ ] `make test-api-unit SCOPE=tests/unit/app-control-plane.test.ts ENV=test-app-control-plane` + CI green.
  - [ ] PR with `BRANCH.md` body; CI green.
  - [ ] **HOLD merge for owner D0 naming validation** (escalate conductor→rhanka when h2a up); on owner GO + CI green: remove BRANCH.md, push, merge (D2 preprod-only).
