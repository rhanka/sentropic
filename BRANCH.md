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
- `acknowledge`: BRDP-EX5 (conductor-approved, O-D2 IRREVERSIBLE G1a) — reason: BR-47 budgets, tenant strategy, immutable pricing, durable holds, blocked attempts and nullable `cost_ledger` attribution for the real 429 emitter; impact: one additive control migration `0008_llm_admission` (5 new tables, 9 nullable `cost_ledger` columns, 3 CHECKs on those new columns), no drop/rename/type change/backfill; rollback: disable the host, preserve rows, no destructive down-migration (restore-based rollback is the schema-owner gate of §12.5).
- `attention`: Model-derived content columns (conductor + app-lane NUL→jsonb coordination) — inventory of EVERY new 0008 column; design rule applied: ids, refs, counts, prices and reason CODES only; one jsonb column total (`cost_ledger.attempts`); no NUL-safe jsonb type exists on `origin/main` at `488e78d33`, so it is a bare `jsonb(`; merge order with the sanitize lot is arbitrated by the conductor and that column must adopt the safe type when it lands.
  - `tenant_budget_strategy`: `id` text, `tenant_id` text, `funding_mode` text, `key_sourcing_mode` text, `mutualization_scope` text, `status` text, `anonymous_enabled` boolean, `created_at`/`updated_at`/`retired_at` timestamptz — LLM content: no (admin configuration ids and CHECK codes).
  - `budgets`: `id` text, `tenant_id` text, `workspace_id` text, `scope_kind` text, `scope_key` text, `period` text, `cap_micro_usd`/`reserved_micro_usd`/`spent_micro_usd` bigint, `reset_at`/`created_at`/`updated_at` timestamptz — LLM content: no (server-composed scope ids, integer micro-USD).
  - `model_pricing`: `id` text, `provider_id` text, `model_id` text, `input_micro_usd_per_mtok`/`output_micro_usd_per_mtok`/`cached_input_micro_usd_per_mtok`/`reasoning_micro_usd_per_mtok`/`image_micro_usd_per_unit`/`audio_micro_usd_per_unit`/`tool_call_micro_usd_per_unit`/`embedding_micro_usd_per_mtok`/`min_charge_micro_usd` bigint, `effective_from`/`effective_to`/`created_at` timestamptz — LLM content: no (admin pricing fixture, catalog ids).
  - `budget_holds`: `id` text, `request_id` text, `tenant_id` text, `workspace_id` text, `principal_kind` text, `principal_key` text, `budget_strategy_id` text, `budget_ids` text[], `quote_ref` text, `pricing_versions` text[], `liability_micro_usd` bigint, `status` text, `owner_ref` text, `fence` bigint, `dispatched_attempts` integer, `deadline_at`/`dispatch_started_at`/`settled_at`/`created_at`/`updated_at` timestamptz — LLM content: no (written before/around dispatch from server ids, the in-process quote digest and prices).
  - `blocked_attempts`: `id` text, `request_id` text, `tenant_id` text, `workspace_id` text, `principal_kind` text, `principal_key` text, `budget_strategy_id` text, `reason` text, `budget_id` text, `requested_model` text, `hold_id` text, `quote_ref` text, `liability_micro_usd` bigint, `reset_at`/`created_at` timestamptz — LLM content: no (`reason` is a CHECK code, never a message; `requested_model` is caller-supplied but only written after catalog validation by the quote, never model output).
  - `cost_ledger` new nullable columns: `principal_kind` text, `principal_key` text, `budget_strategy_id` text, `pricing_version` text, `result` text, `hold_id` text, `quote_ref` text, `reconciliation_state` text — LLM content: no (codes and refs).
  - `cost_ledger.attempts` jsonb — LLM content: no text by design; it holds per-attempt provider/model ids, pricing ids, integer token counts reported by the provider and micro-USD. jsonb is needed because a request has 1..8 attempts across mixed providers (spec §5 step 6, §12.5 "redacted attempts jsonb") and no child table is in the ratified shape; the B3c writer must build it from a closed allowlist of id/number fields, never spread provider raw usage (the pre-existing `usage_raw` column keeps that role).
- `blocked`: existing `api/tests/api/cluster-mesh-migration.test.ts` (outside EX5/EX8) selects control migrations with `/^000[78]_/` and throws `expected one cluster mesh migration, found 2` now that `0008_llm_admission.sql` exists (2 of 16 tests fail, reproduced with `make test-api-endpoints SCOPE=tests/api/cluster-mesh-migration.test.ts ...`); proposed one-line fix `/^000[78]_cluster_mesh/` (keeps the "single cluster-mesh migration" intent); requires a conductor scope extension of EX5 for that test file; not edited here.
- `blocked`: B0-A4 pricing single-writer location — the spec (§12.5, §12.7) assigns the checked insert to B2 but names no file inside EX5/EX8, and the brief forbids placing it under `api/src/services/llm-identity/`; no writer module was created. The concurrency protocol is proven in `api/tests/api/llm-admission-schema.test.ts` (test-local helper). Proposed home: `api/src/services/llm-metering/model-pricing-writer.ts` under B3c's EX9 (`api/src/services/llm-metering/**`), moving the tested protocol verbatim.
- `attention`: B0-A4 protocol detail — `SELECT ... FOR UPDATE` cannot lock an absent predecessor, so two first writes (or two writes after the same closed predecessor) are not serialized by row locks alone; the checked insert therefore also takes `pg_advisory_xact_lock(hashtext(provider_id), hashtext(model_id))` (core Postgres, no extension) before the predecessor lookup; the unique key remains the last-resort guard for equal `effective_from`.
- `attention`: owner mapping semantics (reversible) — the trusted `ownerScopeRef → owner_user_id` mapping is validated once at construction (malformed or duplicate refs refuse the configuration); a session principal whose computed scope maps to another user is refused, and a service principal whose scope appears in the mapping is refused (service principals never claim a user-owned seat). The DB owner-claim check of seat rows stays with the B4 resolver (D7).
- `attention`: eligibility (reversible, conservative) — a session user is eligible in a workspace only with an `approved` `tenant_memberships` row in the workspace tenant, an `active` tenant and a non-hidden workspace; any workspace role counts (parity with product `/gw`); service clients need a trusted `{clientId, tenantId, workspaceId}` binding whose workspace belongs to `service_clients.tenant_id`; DPoP-bound clients (`dpop_bound_access_tokens`) are refused without a `jkt`.
- `attention`: restore proof scope — the schema test restores by server-side `CREATE DATABASE ... TEMPLATE` clones of scratch databases on the test Postgres (pre-migration backup re-upgrade, migrated copy), not by `pg_dump`/`pg_restore` (no such binary in the api test container); the tier-dump `make db-backup-prod` → `db-restore` → `db-migrate` check of §12.5 remains the schema-owner execution gate before rollout.
- `attention`: cost_ledger CHECKs on the 3 new code columns (`principal_kind`, `result`, `reconciliation_state`) are added without `NOT VALID`, so the migration scans `control.cost_ledger` once under the ALTER lock (all existing values NULL, always valid); acceptable for the current ledger size, schema owner to confirm on the tier dump (§12.5 gate).
- `attention`: migration generated by `make db-generate-control` as `0008_massive_miek.sql`; the generated file was renamed to the spec name `0008_llm_admission.sql` and the journal `tag` updated to match (content unchanged, snapshot untouched).

## AI Flaky tests
- [x] Not applicable: deterministic DB and auth tests, no provider call.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (Lot D wave 2; conductor integration)
- Rationale: B2 is an api identity/control-schema lane parallel to B3b; B3c consumes it.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read spec §4, §5, §10 (B2), §12.5-§12.7 and `SPEC_EVOL_QUOTA_LEDGER.md` §2/§6.
  - [x] Verify branch, control journal ends at idx 7, no `0008*` control file, B1 host present.
  - [x] Confirm scope and exceptions BRDP-EX5 / BRDP-EX8.
- [x] **Lot 1 — G1a migration 0008 (BRDP-EX5)**
  - [x] `control-schema.ts`: `tenant_budget_strategy`, `budgets`, `model_pricing`, `budget_holds`, `blocked_attempts`, nullable `cost_ledger` attribution.
  - [x] Generated `0008_llm_admission.sql`, `_journal.json` idx 8, `0008_snapshot.json`.
- [x] **Lot 2 — Identity directory and caller auth (BRDP-EX8)**
  - [x] `caller-auth.ts`: service vs user principal resolution, trusted service bindings, trusted owner mapping, fail-closed directory errors.
  - [x] `directory.ts`: read-only resolution over memberships / service_clients.
- [ ] **Lot 3 — Tests**
  - [x] `api/tests/unit/llm-identity-directory.test.ts` (13 tests PASS)
  - [x] `api/tests/api/llm-admission-schema.test.ts` (expand-first shape, pricing concurrency, disposable upgrade + restore; 18 tests PASS twice)
  - [x] `api/tests/api/auth/service-auth-middleware.test.ts` (extend: real IdP token → gateway service bridge → caller identity; 8 tests PASS)
  - [ ] `apps/llm-gateway/tests/auth.test.ts`
- [ ] **Lot 4 — Gates**
  - [ ] `make typecheck-api lint-api API_PORT=9466 UI_PORT=5666 MAILDEV_UI_PORT=1566 ENV=test-llm-identity`
  - [ ] `make test-api-<suite> SCOPE=<file> ... ENV=test-llm-identity` for each new/changed file, then the affected api suites
  - [ ] `make typecheck-llm-gateway-process test-llm-gateway-process ... ENV=test-llm-identity`
  - [ ] `make scope-check`, `make down ...`, `make ps ...`
