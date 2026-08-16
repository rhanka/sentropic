# Feature: Data socle activation — BR-60-act (outbox real consumer canary) + BR-59-act (registry first caller)

## Objective
Activate the already-built data socle infra with its FIRST REAL production consumers, per
`.tmp/engage/data-socle-dossier.md` (GO-WITH-CHANGES, independent opus 4.8 review applied):
- BR-60-act: canary the outbox as the emission path for the `organizations.ts` ROUTE producer of
  the `organization_events` channel (feature-flagged, reversible) by wiring the existing SSE
  surface as consumer and retiring the bespoke NOTIFY for that one producer behind the flag.
  `organization_events` has 3 emitters total; `tool-service.ts:1530` and `queue-manager.ts:565`
  remain on bespoke NOTIFY, ungated by this canary, and the other 9 domain channels of BR-60's
  original titled scope are untouched by this branch (see PR #537 independent review F1).
- BR-59-act: retrofit `initiatives`/`opportunity` to generate its route zod schema from the
  `object_type_definitions` registry — the registry's first production caller.
- BR-61 and BR-65 stay HOLD (no signed consumer) — untouched in this branch.
- Track reconciliation (review M1): document that BR-60's 2026-06-12 `done` predates its own
  titled scope ("replace bespoke NOTIFY"); this branch does not re-claim `done`, it records
  BR-60-act as a partial completion slice (1-of-3-emitters). Correction: the appended track item
  `01M03WQJ7F2FSM209A5XM5VZ0D`'s title initially overstated this as "completes BR-60 titled
  scope"; per PR #537 independent review F1, retitled + body-clarified via an append-only
  `spec.amended` amendment (seq 5) to state the true partial scope — the original `item.created`
  record is not rewritten.

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
  - `api/Dockerfile` — only under `BR59-EX1` to make the BR-59-act workspace dependency
    available to the production API bundle
  - `.github/workflows/**` — not expected
- **Exception process**:
  - Declare exception ID `BR60-EXn` / `BR59-EXn` in `## Feedback Loop` before touching any
    conditional/forbidden path, with reason, impact, rollback.

## Feedback Loop
- **BR59-EX1** — `api/Dockerfile` (not in Allowed Paths). Reason: PR #537 CI `build-api-image`
  fails reproducibly — esbuild cannot resolve `@sentropic/ubo-contracts` (`dist/index.js` missing)
  because the Dockerfile's per-package `COPY`/`npm --workspace ... run build` lists (added for
  every other `packages/*` consumed by `api/`) were never extended to `ubo-contracts` when
  BR-59-act added it as an `api/package.json` runtime dependency. Impact: 2-line addition mirroring
  the existing pattern for the other 12 `@sentropic/*` packages (`COPY packages/ubo-contracts/package.json
  ./packages/ubo-contracts/package.json` + `RUN npm --workspace @sentropic/ubo-contracts run build`);
  no Makefile/compose change (bundled convention, not `--external`). Rollback: revert the 2 added
  Dockerfile lines; no other file touched.

## AI Flaky tests
(none — this section is for `make test-api-ai`; not applicable, no AI-generation tests touched)

## Non-AI flaky observation (RESOLVED — see PR #537 independent review F2)
- Command: `make test-api-outbox ENV=test-data-activate-br60-br59 ...` (full suite, 8 files)
- File: `api/tests/outbox/producer-organization-events-canary-on.test.ts`, test "dispatches the
  outbox row and preserves cross-workspace SSE isolation"
- Original signature: intermittent SSE-collection-window miss under full-suite concurrent load
  (shared the 1500ms fixed-window `collectFor` helper with the pre-existing
  `api/tests/api/streams.test.ts` cross-workspace pattern it mirrors).
- Evidence of non-systematic nature: failed once across a full-suite run, then passed 4/4
  subsequent runs (1 full-suite rerun + 3 scoped isolated reruns), same commit, same command.
- Root cause: real-clock SSE delivery timing under concurrent Postgres LISTEN/NOTIFY load from
  sibling outbox test files in the same single-worker vitest process — not a logic defect (the
  underlying dispatch path is proven correct by the isolated passes and by the pre-existing,
  unmodified `producer-job-events.test.ts` using the same `OutboxDispatcher`/`PgEventBus`).
- Fix (F2): replaced the fixed-window `collectFor` with `collectConcurrentUntil`, which reads
  both SSE readers concurrently (one in-flight `read()` per reader) and resolves as soon as the
  positive signal (the user's `organization_update` event) is actually observed, bounded by an
  8000ms safety net — not a bare timeout increase. The paired negative assertion (admin must NOT
  receive the event) is evaluated over that same real-time interval, since both readers had
  identical opportunity, instead of an independently-guessed window. Verified: 2 consecutive
  full-suite runs (`make test-api-outbox`, 8 files/21 tests) green, plus 3 isolated scoped reruns
  of the fixed test alone, all green (2.4s-4.1s each, well under the old 1500ms×2 fixed cost).

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

- [x] **Lot 3 — Final validation**
  - [x] Typecheck & Lint (api) — clean, 0 errors (see `make -o <build-*> typecheck-api` /
        `lint-api` runs, `ENV=test-data-activate-br60-br59 API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400`)
  - [x] Retest API: `make test-api-outbox` (8/8 files, 21/21), `make test-api-object-registry`
        (10/10), `make test-api-endpoints SCOPE=tests/api/initiatives.test.ts` (20/20),
        `make test-api-security` (49/49). Broader `make test-api-endpoints` (658 tests): 657 pass,
        1 pre-existing/order-dependent flake in an untouched file (`arch11-tenant-data.test.ts`,
        confirmed passing 8/8 on a fresh Postgres volume — see Feedback Loop below).
  - [x] Package bump check: no `packages/*/src/**` changed in this branch (only `api/src/**` and
        `api/tests/**`) — no version bump required.
  - [x] Push branch; PR opened DRAFT; no merge.
  - [x] Request independent blind opus 4.8 review; report to h2a inbox.

- [x] **Lot 4 — Fix independent review findings (PR #537, `.tmp/engage/data537-review-opus.md`)**
  - [x] F1 (MEDIUM): track item `01M03WQJ7F2FSM209A5XM5VZ0D` title overstated "completes BR-60
        titled scope"; canary covers only the `organizations.ts` route producer, 1 of 3
        `organization_events` emitters. Fixed via append-only `track item spec-amend` (seq 5):
        retitled + body-clarified to state the true partial scope; original `item.created` record
        not rewritten. BRANCH.md/PR body Objective section aligned to match.
  - [x] F2 (LOW-MEDIUM): canary-ON cross-workspace SSE test used a fixed 1500ms wall-clock
        `collectFor` window (1/5 flaky under full-suite load). Fixed by replacing it with
        `collectConcurrentUntil` (event-driven, bounded 8000ms safety net) in
        `producer-organization-events-canary-on.test.ts` — see resolved flaky-observation note
        below.
  - [x] F3 (LOW, disclosure): left as-is per review (generation-from-shared-constant, drift
        impossible); already disclosed in `index.ts:210-213` and this PR's description.
  - [x] Lot gate: `make typecheck-api` + `make lint-api` — both clean, 0 errors (see F1/F2 build
        below); `make test-api-outbox` — 2 consecutive full-suite runs, 8/8 files, 21/21 PASS.

- [x] **Lot 5 — Fix `build-api-image` workspace resolution (PR #537)**
  - [x] Apply `BR59-EX1`: copy `packages/ubo-contracts/package.json` before workspace install and
        build `@sentropic/ubo-contracts` before the API esbuild bundle, matching the existing
        bundled-workspace convention (no runtime externalization).
  - [x] Local gate: `make build-api-image` — PASS (exit 0); `@sentropic/ubo-contracts` build PASS,
        API esbuild bundle PASS (`dist/index.js`), image `a76faa0f9be6` built successfully.
  - [x] `make -o <build-*> typecheck-api ENV=data-activate` — PASS (exit 0), following the
        branch's documented host-workspace bootstrap convention.
  - [x] `make -o <build-*> lint-api ENV=data-activate` — PASS (exit 0, 0 errors).

## Feedback Loop
- **ID F-arch11-flake** — `attention` (non-blocking, informational)
  - Repro: run `make test-api-endpoints` (full suite) against a Postgres volume that has
    accumulated test-run state from prior interactive `make test-api-*` invocations in the same
    session; `tests/api/tenancy/arch11-tenant-data.test.ts` "backfill: every existing user has an
    approved sentropic membership" fails (`expected 1 to be 0`).
  - Expected/Actual: expected 0 orphaned users always; actual found 1 orphaned user left over from
    an earlier interactive run in this session's shared test DB.
  - Evidence: same test, same command, on a `make clean`-reset (pristine) volume → 8/8 pass. File
    is untouched by this branch (no `users`/`tenant_memberships` code touched).
  - Recommendation: not a branch regression; order/state-dependent pre-existing test hygiene gap
    (the test scans the GLOBAL `users` table, not scoped to its own fixtures). No code change
    proposed in this branch (out of scope — `api/tests/api/tenancy/**` not part of BR-60-act/BR-59-act).

- **ID F1-track-scope** — `resolved` (PR #537 independent review, opus 4.8, `.tmp/engage/data537-review-opus.md`)
  - Finding: track item `01M03WQJ7F2FSM209A5XM5VZ0D`'s title read "completes BR-60 titled scope:
    replace bespoke NOTIFY", but the canary only covers the `organizations.ts` route producer —
    `tool-service.ts:1530` and `queue-manager.ts:565` remain on bespoke NOTIFY for the same
    `organization_events` channel, and 9 other domain channels are untouched.
  - Fix: append-only `track item spec-amend 01M03WQJ7F2FSM209A5XM5VZ0D` (seq 5) — retitled to
    "BR-60-act: organizations.ts route-producer canary for organization_events (1 of 3 emitters;
    tool-service.ts and queue-manager.ts bespoke NOTIFY UNCHANGED, other 9 channels untouched)"
    and body clarified with the same detail. Original `item.created`/BR-60 `done` records not
    rewritten (append-only, per M1/F5 mechanism). Note: one exploratory `spec-amend` probe (seq 4,
    placeholder title "test", zero-hash) preceded the real fix while learning the CLI's
    base/result-hash semantics; `spec.amended` is record-only (mutates no item field — confirmed
    via `track item show` before/after), so no data was corrupted, and a seq-6 meta-note discloses
    it rather than leaving it unexplained.
  - Owner: data-impl. Status: resolved, this branch.

- **ID F2-sse-flaky-window** — `resolved` (PR #537 independent review, opus 4.8)
  - Finding: `producer-organization-events-canary-on.test.ts`'s cross-workspace SSE test used a
    fixed 1500ms wall-clock `collectFor` window, observed 1/5 flaky under full-suite concurrent
    LISTEN/NOTIFY load.
  - Fix: replaced with `collectConcurrentUntil` — reads both SSE readers concurrently and resolves
    as soon as the real signal (the user's `organization_update` event) is observed, bounded by an
    8000ms safety net (not a bare timeout bump). The negative cross-workspace assertion is
    evaluated over that same real-time interval. Verified: 2 consecutive full-suite
    `make test-api-outbox` runs (8/8 files, 21/21) + 3 isolated scoped reruns, all green.
  - Owner: data-impl. Status: resolved, this branch.
