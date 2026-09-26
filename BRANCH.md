# Feature: LLM identity directory and G1a budget admission migration — Lot D B2

## Objective
- [ ] Deliver Lot D B2 per `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` §4 (D4), §5 (D5), §10 (B2), §12.5-§12.7: identity directory + caller-auth port over existing stores (G1b deferred, no identity table) and the single O-D2-ratified G1a control migration `0008_llm_admission`.

## Scope / Guardrails
- [x] Branch `feat/llm-identity-admission`, worktree `tmp/llm-identity-admission`, from `origin/main` (B1 landed; train mesh 0.22.0 / gateway 0.19.0 / cluster-mesh 0.13.0 published).
- [x] Make-only checks; Docker-first; no Python; English text; `ENV=test-llm-identity` last; never `ENV=dev` or `clean-all`.
- [x] Ports on every make that starts services: API `9466`, UI `5666`, Maildev UI `1566`; `REGISTRY=local` for image targets.
- [x] Migrations run only on the disposable Postgres of `ENV=test-llm-identity` and on scratch databases created by the schema test; never on a shared/dev database.
- [x] Selective staging and separate `make commit`; checkboxes updated in each atomic commit, approximately 150 lines maximum (generated drizzle snapshot excepted).
- [x] HARD STOP: no push, no PR, no merge, no publication; the conductor reviews the 0008 SQL and snapshot before any PR.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `apps/llm-gateway/tests/auth.test.ts`
  - `api/src/services/llm-identity/directory.ts` (BRDP-EX8)
  - `api/src/services/llm-identity/caller-auth.ts` (BRDP-EX8)
  - `api/tests/unit/llm-identity-directory.test.ts` (BRDP-EX8)
  - `api/tests/api/llm-admission-schema.test.ts` (BRDP-EX8)
  - `api/tests/api/auth/service-auth-middleware.test.ts` (BRDP-EX8, extend)
  - `api/src/db/control-schema.ts` (BRDP-EX5)
  - `api/drizzle/control/0008_llm_admission.sql` (BRDP-EX5, the only migration)
  - `api/drizzle/control/meta/_journal.json`, `api/drizzle/control/meta/0008_snapshot.json` (BRDP-EX5, generated)
  - `api/tests/api/cluster-mesh-migration.test.ts` (BRDP-EX12, one line only)
  - `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` (fix round 1: §12.5 inventory line and §12.7 B0-A4 text only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `plan/**`
  - `deploy/**`
  - `api/src/db/schema.ts`
  - `api/drizzle/*.sql` (public stream)
  - `api/src/routes/**`
  - `packages/**`
  - any path not listed in Allowed Paths
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none beyond BRDP-EX5 / BRDP-EX8 (already listed above)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `acknowledge`: BRDP-EX8 (conductor-approved) — reason: product-lane identity directory and caller-auth services for the gateway plus their tests; reads `workspace_memberships`, `tenant_memberships`, `workspaces`, `tenants`, `service_clients` only (G1b deferred); impact: new modules, no data change, no route wiring (B3c wires them); rollback: remove the new modules and tests, no data impact.
- `acknowledge`: BRDP-EX5 (conductor-approved, O-D2 IRREVERSIBLE G1a) — reason: BR-47 budgets, tenant strategy, immutable pricing, durable holds, blocked attempts and nullable `cost_ledger` attribution for the real 429 emitter; impact: one additive control migration `0008_llm_admission` (5 new tables, 1 FK between two new tables, 9 nullable `cost_ledger` columns, 3 NOT VALID CHECKs on those new columns, no VALIDATE in 0008 (deferred maintenance migration), 3 column comments), no drop/rename/type change/backfill; rollback: disable the host, preserve rows, no destructive down-migration (restore-based rollback is the schema-owner gate of §12.5).
- `attention`: Model-derived content columns (conductor + app-lane NUL→jsonb coordination) — inventory of EVERY new 0008 column; design rule applied: ids, refs, counts, prices and reason CODES only; one jsonb column total (`cost_ledger.attempts`); no NUL-safe jsonb type exists on `origin/main` at `488e78d33`, so it is a bare `jsonb(`; merge order with the sanitize lot is arbitrated by the conductor and that column must adopt the safe type when it lands.
  - `tenant_budget_strategy`: `id` text, `tenant_id` text, `funding_mode` text, `key_sourcing_mode` text, `mutualization_scope` text, `status` text, `anonymous_enabled` boolean, `created_at`/`updated_at`/`retired_at` timestamptz — LLM content: no (admin configuration ids and CHECK codes).
  - `budgets`: `id` text, `tenant_id` text, `workspace_id` text, `scope_kind` text, `scope_key` text, `period` text, `cap_micro_usd`/`reserved_micro_usd`/`spent_micro_usd` bigint, `reset_at`/`created_at`/`updated_at` timestamptz — LLM content: no (server-composed scope ids, integer micro-USD).
  - `model_pricing`: `id` text, `provider_id` text, `model_id` text, `input_micro_usd_per_mtok`/`output_micro_usd_per_mtok`/`cached_input_micro_usd_per_mtok`/`reasoning_micro_usd_per_mtok`/`image_micro_usd_per_unit`/`audio_micro_usd_per_unit`/`tool_call_micro_usd_per_unit`/`embedding_micro_usd_per_mtok`/`min_charge_micro_usd` bigint, `effective_from`/`effective_to`/`created_at` timestamptz — LLM content: no (admin pricing fixture, catalog ids).
  - `budget_holds`: `id` text, `request_id` text, `tenant_id` text, `workspace_id` text, `principal_kind` text, `principal_key` text, `budget_strategy_id` text, `budget_ids` text[], `quote_ref` text, `pricing_versions` text[], `liability_micro_usd` bigint, `status` text, `owner_ref` text, `fence` bigint, `dispatched_attempts` integer, `deadline_at`/`dispatch_started_at`/`settled_at`/`created_at`/`updated_at` timestamptz — LLM content: no (written before/around dispatch from server ids, the in-process quote digest and prices).
  - `blocked_attempts`: `id` text, `request_id` text, `tenant_id` text, `workspace_id` text, `principal_kind` text, `principal_key` text, `budget_strategy_id` text, `reason` text, `budget_id` text, `requested_model` text, `hold_id` text, `quote_ref` text, `liability_micro_usd` bigint, `reset_at`/`created_at` timestamptz — LLM content: no (`reason` is a CHECK code, never a message; `requested_model` is caller-supplied but only written after catalog validation by the quote, never model output).
  - `cost_ledger` new nullable columns: `principal_kind` text, `principal_key` text, `budget_strategy_id` text, `pricing_version` text, `result` text, `hold_id` text, `quote_ref` text, `reconciliation_state` text — LLM content: no (codes and refs).
  - `cost_ledger.attempts` jsonb — LLM content: no text by design; it holds per-attempt provider/model ids, pricing ids, integer token counts reported by the provider and micro-USD. jsonb is needed because a request has 1..8 attempts across mixed providers (spec §5 step 6, §12.5 "redacted attempts jsonb") and no child table is in the ratified shape; the B3c writer must build it from a closed allowlist of id/number fields, never spread provider raw usage (the pre-existing `usage_raw` column keeps that role).
- `acknowledge`: BRDP-EX12 (conductor-approved scope extension, ID proposed here, conductor may renumber) — reason: `api/tests/api/cluster-mesh-migration.test.ts` selected control migrations with `/^000[78]_/` and threw `expected one cluster mesh migration, found 2` once `0008_llm_admission.sql` existed; impact: one line, regex `/^\d+_cluster_mesh/` (muse F1: a `[78]` range would re-break on the next cluster-mesh migration); the empty-match guard already exists: `readClusterMeshMigration` throws unless exactly one file matches (`if (files.length !== 1) throw`, line 22) and the SG7 test pins `expect(files).toEqual(['0007_cluster_mesh_r13.sql'])` (line 122), so the filter can never pass empty; rollback: revert the line.
- `acknowledge`: B0-A4 pricing single-writer location — conductor decision: the writer goes to B3c `api/src/services/llm-metering/model-pricing-writer.ts` (EX9), moving the protocol proven by the test-local helper of `api/tests/api/llm-admission-schema.test.ts` verbatim; no writer module in B2.
- `acknowledge`: B0-A4 protocol (conductor-accepted deviation, spec §12.7 amended) — unique `(provider_id, model_id, effective_from)` + `pg_advisory_xact_lock(hashtext(provider_id), hashtext(model_id))` in the single-writer transaction before the `FOR UPDATE` predecessor lookup; `FOR UPDATE` cannot lock an absent predecessor (the negative-control test proves both overlapping writes commit without the lock); core Postgres, no extension.
- `attention`: muse F7 — non-overlap is a single-writer discipline, not a DB constraint: a direct SQL write with a different `effective_from` can bypass it (only an equal `effective_from` is caught by the unique key); B3c moves the protocol verbatim into `model-pricing-writer.ts`; a GiST exclusion stays a later migration only if bypass-write audits demand it.
- `attention`: muse F4 — `cost_ledger.quote_ref` is an addition beyond the original §12.5 list of 8 ledger columns, covered by the §12.2 overrun rule (settlement row carries `holdRef` and `quoteRef`); §12.5 inventory line updated in the spec.
- `attention`: foreign keys (schema-owner item 2), decided column by column:
  - `budget_holds.budget_strategy_id` → FK `tenant_budget_strategy(id)` ON DELETE RESTRICT (both tables new, strategies are retired never deleted, every hold stays attributable); tested: unknown strategy refused, deletion of a referenced strategy refused.
  - `budget_holds.budget_ids` (text[]): no FK possible on an array; integrity by the admission transaction that locks those buckets.
  - `blocked_attempts.budget_strategy_id`, `budget_id`, `hold_id`: no FK — audit rows must survive any later cleanup of strategies/buckets/holds, and refusals such as `no_strategy` / `missing_bucket` reference absent rows by design.
  - `cost_ledger.hold_id`, `budget_strategy_id`, `pricing_version`: no FK — append-only ledger, no deletion coupling with holds (a future hold retention/reaper purge must never cascade into or be blocked by the ledger); a FK on the existing ledger would also add a lock on an existing table.
- `attention`: `principal_key` (schema-owner item 3) — `cost_ledger`, `budget_holds`, `blocked_attempts` carry an opaque principal id or keyed hash only, never an e-mail, raw IP or other personal data in clear; written as `COMMENT ON COLUMN` in 0008 (tested via `col_description`) and in `control-schema.ts` comments; the writer-side test belongs to B3c; follow-up outside 0008: retention policy for `blocked_attempts` (ARCH-15).
- `attention`: 0008 hand edits (drizzle-kit 0.28 cannot emit `NOT VALID`, `VALIDATE CONSTRAINT` or column comments) — after `make db-generate-control` (FK added in `control-schema.ts`, snapshot/journal regenerated, generated `0008_sturdy_wiccan.sql` renamed to `0008_llm_admission.sql`, journal tag updated), the SQL was edited only to (a) append `NOT VALID` to the 3 `cost_ledger` CHECKs, (b) add the 3 `COMMENT ON COLUMN` (plus one SQL comment line); the `VALIDATE CONSTRAINT` statements added in fix round 1 were removed by conductor decision option (b). The snapshot stays consistent: it records the same 3 CHECKs (validated state is not modelled) and drizzle does not track comments.
- `acknowledge`: conductor decision option (b), schema owner — the 3 `cost_ledger` CHECKs stay `NOT VALID` in 0008 and 0008 has NO `VALIDATE CONSTRAINT`: drizzle's migrator applies all pending migrations in ONE transaction (verified in `drizzle-orm/pg-core/dialect.cjs`, `session.transaction`), so a validate would scan under the exclusive lock already held by `ADD COLUMN` / `ADD CONSTRAINT`. Formal validation will be done by a later maintenance migration (also recorded in spec §12.5). Tested: `convalidated = false` for the 3 CHECKs; NEW non-conforming inserts and updates (`result='bogus'`, `principal_kind='x'`, `reconciliation_state='x'`) are refused with 23514 despite `NOT VALID`; a conforming insert is accepted and existing historical rows are untouched. Replay tested: runner re-run is a journal no-op; a raw re-execution of 0008 fails on the first `ADD COLUMN` (42701, constraints have no `IF NOT EXISTS`) inside a rolled-back transaction and leaves the schema unchanged.
- `deferred` / `attention` (Owner: k8s lane pilots the common method; owner decision via conductor): Proper sentropic DB backup to industrialize, aligned with the common immo/radar method (prod → preprod copy + migration at each release, daily backup), at the end of immo wave 2; one-off preprod pg_dump + verified restore is a hard gate before merging this branch (0008 applies at API boot on preprod).
- `attention`: deployment gate — the §12.5 tier-dump check with a real `pg_dump`/`pg_restore` container (`make db-backup-prod` → `db-restore` → `db-migrate` on a disposable env) remains mandatory before rollout (schema owner).
- `attention`: owner mapping semantics (reversible) — the trusted `ownerScopeRef → owner_user_id` mapping is validated once at construction (malformed or duplicate refs refuse the configuration); a session principal whose computed scope maps to another user is refused, and a service principal whose scope appears in the mapping is refused (service principals never claim a user-owned seat). The DB owner-claim check of seat rows stays with the B4 resolver (D7).
- `attention`: eligibility (reversible, conservative) — a session user is eligible in a workspace only with an `approved` `tenant_memberships` row in the workspace tenant, an `active` tenant and a non-hidden workspace; any workspace role counts (parity with product `/gw`); service clients need a trusted `{clientId, tenantId, workspaceId}` binding whose workspace belongs to `service_clients.tenant_id`; DPoP-bound clients (`dpop_bound_access_tokens`) are refused without a `jkt`.
- `attention`: restore proof scope — the schema test restores by server-side `CREATE DATABASE ... TEMPLATE` clones of scratch databases on the test Postgres (pre-migration backup re-upgrade, migrated copy), not by `pg_dump`/`pg_restore` (no such binary in the api test container); the tier-dump `make db-backup-prod` → `db-restore` → `db-migrate` check of §12.5 remains the schema-owner execution gate before rollout.
- `acknowledge`: superseded — the 3 `cost_ledger` CHECKs are `NOT VALID` without validate in 0008 (option (b) item above).

## AI Flaky tests
- [x] Not applicable: deterministic DB and auth tests, no provider call.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (Lot D wave 2; conductor integration)
- Rationale: B2 is an api identity/control-schema lane parallel to B3b; B3c consumes it.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read spec §4, §5, §10 (B2), §12.5-§12.7 and `SPEC_EVOL_QUOTA_LEDGER.md` §2/§6.
  - [x] Verify branch, control journal ends at idx 7, no `0008*` control file, B1 host present.
  - [x] Confirm scope and exceptions BRDP-EX5 / BRDP-EX8.
- [x] **Lot 1 — G1a migration 0008 (BRDP-EX5)**
  - [x] `control-schema.ts`: `tenant_budget_strategy`, `budgets`, `model_pricing`, `budget_holds`, `blocked_attempts`, nullable `cost_ledger` attribution.
  - [x] Generated `0008_llm_admission.sql`, `_journal.json` idx 8, `0008_snapshot.json`.
- [x] **Lot 2 — Identity directory and caller auth (BRDP-EX8)**
  - [x] `caller-auth.ts`: service vs user principal resolution, trusted service bindings, trusted owner mapping, fail-closed directory errors.
  - [x] `directory.ts`: read-only resolution over memberships / service_clients.
- [x] **Lot 3 — Tests**
  - [x] `api/tests/unit/llm-identity-directory.test.ts` (13 tests PASS)
  - [x] `api/tests/api/llm-admission-schema.test.ts` (expand-first shape, pricing concurrency, disposable upgrade + restore; 18 tests PASS twice)
  - [x] `api/tests/api/auth/service-auth-middleware.test.ts` (extend: real IdP token → gateway service bridge → caller identity; 8 tests PASS)
  - [x] `apps/llm-gateway/tests/auth.test.ts` (host: service DPoP/replay/URL, issuer/audience/expiry/scope, revoked/null/wrong tenant, forged headers/body, session memberships, DB outage 503; 12 tests PASS)
- [x] **Lot 4 — Gates**
  - [x] `make typecheck-api lint-api API_PORT=9466 UI_PORT=5666 MAILDEV_UI_PORT=1566 ENV=test-llm-identity` PASS (lint 0 errors, pre-existing warnings only)
  - [x] Scoped runs PASS: unit `llm-identity-directory` 13, endpoints `llm-admission-schema` 18 (twice), endpoints `auth/service-auth-middleware` 8
  - [x] Affected suites: `make test-api-unit` PASS (113 files, 993 tests, 2 skipped); `make test-api-endpoints` 118/119 files, 930/932 tests — the 2 failures are `cluster-mesh-migration.test.ts` (see `blocked` item above)
  - [x] `make typecheck-llm-gateway-process lint-llm-gateway-process test-llm-gateway-process ... ENV=test-llm-identity` PASS (5 files, 56 tests)
  - [x] `make scope-check` PASS C2 (clean tree); committed range `merge-base..HEAD` limited to Allowed Paths
  - [x] `make down API_PORT=9466 UI_PORT=5666 MAILDEV_UI_PORT=1566 ENV=test-llm-identity` done; `make ps` with the same ports/ENV lists no container
- [x] **Lot 6 — Conductor option (b): NOT VALID without VALIDATE**
  - [x] 0008: 3 `VALIDATE CONSTRAINT` removed; spec §12.5 and this file record the later maintenance migration
  - [x] Test: `convalidated = false`; new non-conforming inserts/updates refused (23514); history untouched; replay updated
  - [x] Fresh disposable DB (`make clean` + `up-api-test`, ENV=test-llm-identity): `llm-admission-schema` 20/20 twice, `cluster-mesh-migration` 16/16, `service-auth-middleware` 8/8, `llm-identity-directory` 13/13; full `make test-api-endpoints` 119/119 files, 934/934
  - [x] §12.5 rehearsal on real preprod dump (sha256 `39dd0a84…e353ec`, ENV=verify-preprod-0008, ports 9470/5670/1570): `db-restore` clean; 84 tables / 182 rows before; `db-migrate` 17.6 s cold (no-op rerun 2.5 s); control migrations 8→9, 5 new empty tables, 3 ledger CHECKs `convalidated=false`, FK present, public migrations 42 unchanged, every pre-existing table count identical; API boot health 200; stack and volume removed
- [x] **Lot 5 — Fix round 1 (schema-owner review + muse)**
  - [x] 0008: NOT VALID CHECKs (VALIDATE removed, option (b): later maintenance migration), RESTRICT FK `budget_holds.budget_strategy_id`, `principal_key` comments; regenerated snapshot/journal
  - [x] Tests: shape, validated CHECKs, comments, FK restrict, replay/idempotence
  - [x] BRDP-EX12 one-line regex `/^\d+_cluster_mesh/`; spec §12.5/§12.7 edits
  - [x] Gates re-run on a fresh disposable DB (`make clean ... ENV=test-llm-identity` volume reset, then `up-api-test`): `llm-admission-schema` 20/20 twice, `cluster-mesh-migration` 16/16, `service-auth-middleware` 8/8, `llm-identity-directory` 13/13; `make test-api-unit` 113 files / 993 passed, 2 skipped; `make test-api-endpoints` 119/119 files, 934/934; `typecheck-api` + `lint-api` (0 errors); gateway host typecheck/lint/test 5 files / 56; `scope-check` PASS C2; `make down` + `make ps` empty
