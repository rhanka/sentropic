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
- [ ] **Lot 2 — Identity directory and caller auth (BRDP-EX8)**
  - [ ] `caller-auth.ts`: service vs user principal resolution, trusted service bindings, trusted owner mapping, fail-closed directory errors.
  - [ ] `directory.ts`: read-only resolution over memberships / service_clients.
- [ ] **Lot 3 — Tests**
  - [ ] `api/tests/unit/llm-identity-directory.test.ts`
  - [ ] `api/tests/api/llm-admission-schema.test.ts` (expand-first shape, pricing concurrency, disposable upgrade + restore)
  - [ ] `api/tests/api/auth/service-auth-middleware.test.ts` (extend)
  - [ ] `apps/llm-gateway/tests/auth.test.ts`
- [ ] **Lot 4 — Gates**
  - [ ] `make typecheck-api lint-api API_PORT=9466 UI_PORT=5666 MAILDEV_UI_PORT=1566 ENV=test-llm-identity`
  - [ ] `make test-api-<suite> SCOPE=<file> ... ENV=test-llm-identity` for each new/changed file, then the affected api suites
  - [ ] `make typecheck-llm-gateway-process test-llm-gateway-process ... ENV=test-llm-identity`
  - [ ] `make scope-check`, `make down ...`, `make ps ...`
