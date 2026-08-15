# Feature: Data socle activation — BR-60-act (outbox real consumer canary) + BR-59-act (registry first caller)

## Objective
Activate the already-built data socle infra with its FIRST REAL production consumers, per
`.tmp/engage/data-socle-dossier.md` (GO-WITH-CHANGES, independent opus 4.8 review applied):
- BR-60-act: make the outbox the single emission path for the `organizations` channel (canary,
  feature-flagged, reversible) by wiring the existing SSE surface as consumer and retiring the
  bespoke NOTIFY for that channel behind the flag.
- BR-59-act: retrofit `initiatives`/`opportunity` to generate its route zod schema from the
  `object_type_definitions` registry — the registry's first production caller.
- BR-61 and BR-65 stay HOLD (no signed consumer) — untouched in this branch.
- Track reconciliation (review M1): document that BR-60's 2026-06-12 `done` predates its own
  titled scope ("replace bespoke NOTIFY"); this branch does not re-claim `done`, it records
  BR-60-act as the completion slice.

## Scope / Guardrails
- Scope limited to: `api/src/services/outbox/**`, `api/src/routes/api/organizations.ts`,
  `api/src/routes/api/streams.ts` (read-only verification only, no channel-name change),
  `api/src/routes/api/initiatives.ts`, `api/src/services/object-registry/**`,
  `packages/ubo-contracts/**` (read-only unless a generator utility is added), `api/tests/**`
  (new/updated tests only), `.track/**` (append-only event via CLI, not manual edit).
- One migration max in `api/drizzle/*.sql` (only if a flag/column genuinely requires it — default:
  NO migration, env-var flag only).
- Make-only workflow, no direct Docker commands.
- No merge, no deploy, no prod rollout. Canary flag defaults OFF.
- Root workspace reserved for user dev/UAT; branch dev happens in this worktree.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/outbox/**`
  - `api/src/routes/api/organizations.ts`
  - `api/src/routes/api/initiatives.ts`
  - `api/src/services/object-registry/**`
  - `api/src/index.ts` (boot-time idempotent registration calls only, mirroring the existing outbox-dispatcher-autostart pattern)
  - `api/src/services/queue-manager.ts` (dual-write cleanup only if in scope of the canary)
  - `api/tests/**` (new/updated only)
  - `spec/SPEC_EVOL_EVENT_SPINE.md`, `spec/SPEC_EVOL_DATA_ARCHITECTURE.md` (status notes only)
  - `plan/PLAN.md` status line for BR-60/BR-59 (append status, no rewrite)
  - `BRANCH.md` (this file)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/src/routes/api/streams.ts` (read-only reference; channel contract must not change)
  - BR-61 / BR-65 surfaces: no `business_objects` table, no `ObjectResolverPort`, no Parquet/DuckDB export
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file) — only if the canary flag needs persisted config (default: no)
  - `.github/workflows/**` — not expected
- **Exception process**:
  - Declare exception ID `BR60-EXn` / `BR59-EXn` in `## Feedback Loop` before touching any
    conditional/forbidden path, with reason, impact, rollback.

## Feedback Loop
(none yet)

## AI Flaky tests
(none yet — record here if any appear during `make test-api-ai`)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single build agent, single test cycle)
- Rationale: two small, orthogonal activation lots on infra already built and reviewed;
  no need for parallel sub-branches.

## UAT Management (in orchestration context)
- Mono-branch: no UI-facing change (canary flag OFF by default, SSE wire format preserved);
  UAT is deferred to the owner review of the PR (draft) + independent blind review, not to a
  live UAT session in this build pass.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `.tmp/engage/data-socle-dossier.md` + `.tmp/engage/data-socle-review-opus.md`.
  - [x] Confirm worktree is on `feat/data-activate-br60-br59` (base `origin/main`).
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/conductor.md`.
  - [x] Confirm track state matches dossier (BR-60/BR-59 `done` 2026-06-12/13; decision
        `01KXSECAAF7YPFX5FR87J83G5H` still `decision.created`, no resolution event).
  - [x] Confirm scope boundaries above.

- [x] **Lot 1 — BR-60-act: outbox canary for the `organizations` channel**
  - [x] Add a reversible feature flag (env var, default OFF, following the
        `OUTBOX_DISPATCHER_AUTOSTART` convention) gating outbox-only emission for `organizations`.
  - [x] When flag ON: `organizations.ts` mutation co-writes via `OutboxWriter` only (same
        transaction); bespoke `NOTIFY` is not executed for that path (no dual-write). All 5
        mutation sites (POST /, POST /draft, POST /:id/enrich, PUT /:id, DELETE /:id) route
        through the single `writeOrganizationMutation` helper.
  - [x] When flag OFF (default): behavior unchanged (bespoke NOTIFY only), zero prod impact.
  - [x] Verify SSE bridge (`streams.ts`) receives the outbox-dispatched event unchanged
        (read-only verification: channel `organization_events` + `{ organization_id }` payload
        shape preserved, matches `emitOrganizationSnapshot`'s snapshot-on-wake read).
  - [ ] Track note (review M1/F5): append a track note (CLI, not manual `.track` edit)
        referencing BR-60 `01KTSFJHBFRT0HHAB9B8PW7926` that BR-60-act is the completion slice
        of the titled "replace bespoke NOTIFY" scope, and that the 2026-06-12 `done` predates it.
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] **API tests**
      - [ ] `api/tests/api/organizations.spec.ts` — extend with canary-ON / canary-OFF cases
      - [ ] `api/tests/outbox/*.spec.ts` (new or extended) — outbox-only path emits exactly once,
            no dual NOTIFY when flag ON
      - [ ] Negative cross-workspace test: an org mutation in workspace A must not leak an
            outbox-dispatched SSE event to a workspace B subscriber (extend existing
            cross-workspace isolation tests if present, else add one)
      - [ ] Scoped run: `make test-api-<suite> SCOPE=tests/... ENV=test-data-activate-br60-br59`
      - [ ] Sub-lot gate: `make test-api ENV=test-data-activate-br60-br59`

- [x] **Lot 2 — BR-59-act: registry-generated zod for `opportunity`**
  - [x] Register `opportunity` object type (shape-mined from the prior hand-written
        `initiativeInput` zod) via `PgObjectTypeRegistry`, idempotently at boot
        (`ensureOpportunityTypeRegistered` in `index.ts`) — warn-only validation ladder (DD2a,
        status stays `draft`), no enforce flip.
  - [x] Generate the initiatives route zod schema FROM the registry JSON Schema (DD2a=B, one
        direction: registry → zod) via a purpose-built, type-level `generateZodFromJsonSchema`
        (`json-schema-to-zod.ts`) — `OPPORTUNITY_JSON_SCHEMA` is the single source of truth
        consumed both by registration and by the route validator.
  - [x] Wire format unchanged: `initiativeInput`'s generated zod is structurally equivalent to
        the prior hand-written schema (same required/optional fields, same nested shapes).
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] **API tests**
      - [ ] `api/tests/object-registry/object-type-registry.test.ts` — extend for `opportunity`
            registration + generated-schema round-trip
      - [ ] `api/tests/api/initiatives.spec.ts` — extend: generated zod accepts/rejects the same
            cases as before (regression), plus a case proving the registry is the source of truth
      - [ ] Negative cross-workspace test: initiatives read/write must remain workspace-scoped
            after the retrofit (extend existing isolation test if present)
      - [ ] Sub-lot gate: `make test-api ENV=test-data-activate-br60-br59`

- [ ] **Lot 3 — Final validation**
  - [ ] Typecheck & Lint (api)
  - [ ] Retest API (full `make test-api ENV=test-data-activate-br60-br59`)
  - [ ] Bump `packages/ubo-contracts/package.json` version if `src/**` changed (CI
        `enforce-package-bump`); otherwise none touched.
  - [ ] Create/update PR (DRAFT) using this file as PR body.
  - [ ] Push branch; do NOT merge.
  - [ ] Request independent blind opus 4.8 review; report to h2a inbox
        (`claude:sentropic-drumbeat:21fe3355ad7d`, `claude:s-conductor:b57acabac2af`) with
        commits/PR/tests/remaining work; write
        `.tmp/engage/data-activate-build-report.md`.
