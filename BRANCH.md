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
(none — this section is for `make test-api-ai`; not applicable, no AI-generation tests touched)

## Non-AI flaky observation (recorded for transparency, non-blocking)
- Command: `make test-api-outbox ENV=test-data-activate-br60-br59 ...` (full suite, 8 files)
- File: `api/tests/outbox/producer-organization-events-canary-on.test.ts`, test "dispatches the
  outbox row and preserves cross-workspace SSE isolation"
- Signature: intermittent SSE-collection-window miss under full-suite concurrent load (shares the
  1500ms `collectFor` window with the pre-existing `api/tests/api/streams.test.ts` cross-workspace
  pattern it mirrors).
- Evidence of non-systematic nature: failed once across a full-suite run, then passed 4/4
  subsequent runs (1 full-suite rerun + 3 scoped isolated reruns), same commit, same command.
- Root cause: real-clock SSE delivery timing under concurrent Postgres LISTEN/NOTIFY load from
  sibling outbox test files in the same single-worker vitest process — not a logic defect (the
  underlying dispatch path is proven correct by the isolated passes and by the pre-existing,
  unmodified `producer-job-events.test.ts` using the same `OutboxDispatcher`/`PgEventBus`).
- Impact if unrelated: accepted per non-systematic nondeterminism rule. Not amended with an
  additive timeout on this pass; flagged for the independent review as a robustness follow-up.

## Environment note (session-scoped, not a code issue)
- `make up-api-test` does NOT apply `docker-compose.test.yml` (the file that sets
  `OUTBOX_DISPATCHER_AUTOSTART=false` for hermetic outbox testing) — only `make up-api-test-ci`
  does. Using `up-api-test` for outbox-suite testing causes the container's own background
  dispatcher to race the tests' explicit dispatch calls. Use `up-api-test-ci` for this branch's
  test runs. This is pre-existing Makefile behavior, not modified in this branch (Makefile is a
  forbidden path here).
- This worktree also hit a recurring `EACCES` on `api/node_modules/.vite` (root-owned, created by
  `docker compose exec`'s default-root user during test runs) blocking host-UID `npm ci`. Fixed by
  piping a cleanup command into `make sh-api` (root-default `docker compose run`) each time it
  recurred. Not a code issue; not modified in this branch.

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
  - [x] Track note (review M1/F5): appended via `track` CLI (see commit) referencing BR-60
        `01KTSFJHBFRT0HHAB9B8PW7926` — BR-60-act is the completion slice of the titled "replace
        bespoke NOTIFY" scope; the 2026-06-12 `done` predates it. No history rewrite (append-only).
  - [x] Lot gate:
    - [x] `make typecheck-api` + `make lint-api` — both clean (0 errors)
    - [x] **API tests**
      - [x] `api/tests/outbox/producer-organization-events-canary-on.test.ts` (new) — outbox-only
            path emits exactly once (no dual NOTIFY when flag ON), covers create/dispatch
      - [x] `api/tests/outbox/producer-organization-events-canary-off.test.ts` (new) — flag OFF
            (default) writes zero outbox rows, reversibility proof
      - [x] Negative cross-workspace test: an org mutation in workspace A must not leak an
            outbox-dispatched SSE event to a workspace B subscriber
            (`api/tests/outbox/producer-organization-events-canary-on.test.ts`, mirrors the
            existing `api/tests/api/streams.test.ts` bespoke-NOTIFY cross-workspace test)
      - [x] Scoped run: `make test-api-outbox SCOPE=tests/outbox/producer-organization-events-canary-on.test.ts ENV=test-data-activate-br60-br59 API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400` — PASS (2/2)
      - [x] `producer-organization-events-canary-off.test.ts` — PASS (1/1)
      - [x] Sub-lot gate: `make test-api-outbox ENV=test-data-activate-br60-br59 API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400` — PASS (8 files/21 tests); see AI/non-AI flaky note above for one intermittent full-suite timing observation

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
  - [x] Lot gate:
    - [x] `make typecheck-api` + `make lint-api` — both clean (0 errors)
    - [x] **API tests**
      - [x] `api/tests/object-registry/object-type-registry.test.ts` — extended with
            `ensureOpportunityTypeRegistered` (idempotent registration, warn-only `draft` status)
            + `generateZodFromJsonSchema` round-trip parity tests — PASS (10/10)
      - [x] `api/tests/api/initiatives.test.ts` — added a full-payload acceptance case for the
            registry-generated schema; the pre-existing "should reject invalid use case data"
            case already regression-covers the generated `required: [folderId,name]` behavior — PASS (20/20)
      - [x] Negative cross-workspace test: `api/tests/api/initiatives.test.ts` "Cross-workspace
            isolation (BR-59-act regression)" — outsider GET on another workspace's initiative → 404
      - [x] Sub-lot gate: `make test-api-object-registry` + `make test-api-endpoints SCOPE=tests/api/initiatives.test.ts` (`ENV=test-data-activate-br60-br59 API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400`) — both PASS

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
