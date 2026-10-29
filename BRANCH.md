# Feature: Canvas live H2 durable store, journal and baseline bridge

## Objective
- [ ] Deliver approved host plan r3 H2 (`a48f54be6ce82b05e697f1c3f7dbc433ed60b69f5c2e377b6fb71faad9ababe7`) and DS persistence contract §7.4 (`161c5dac35d1cfe6b4a1937fe2f38f900e3f73d24cbae1cbb802b4036ee36834`).

## Scope / Guardrails
- [x] H0 merged in #823; H1 #830 identity/admission contract is the dependency, developed alongside a fake registry.
- [x] Branch `feat/canvas-live-h2` from `origin/main`; worktree `tmp/worktrees/canvas-h2`.
- [x] Make-only, Docker-first, no Python, no user-visible behavior change.
- [x] `ENV=test-canvas-h2` last; `API_PORT=8801 UI_PORT=5201 MAILDEV_UI_PORT=1101`.
- [x] Docker operations hold `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; finish with `make down`.
- [x] One branch migration maximum; no storage expiry invented; artifacts lifecycle remains authoritative.
- [x] Atomic commits ≤150 changed lines through `make commit`; selective staging; merge only, never rebase.
- [x] Draft PR to main; retain BRANCH.md; no merge requested.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/chat-core/src/live-document-port.ts`
  - `packages/chat-core/src/ports.ts`
  - `packages/chat-core/package.json`
  - `packages/chat-server/package.json`
  - `api/src/services/canvas-live/persistence.ts`
  - `api/src/services/canvas-live/pg-store.ts`
  - `api/src/services/canvas-live/journal.ts`
  - `api/src/services/canvas-live/freeze-capture.ts`
  - `api/src/db/schema.ts`
  - `api/drizzle/0048_canvas_live_h2.sql`
  - `api/drizzle/meta/_journal.json`
  - `api/tests/unit/canvas-live-recovery.test.ts`
  - `api/tests/unit/canvas-live-journal.test.ts`
  - `api/tests/unit/canvas-live-freeze-capture.test.ts`
  - `api/tests/helpers/canvas-live.ts`
  - `api/tests/api/canvas-live-persistence.test.ts`
  - `api/tests/api/cluster-mesh-transfers-cutover.test.ts`
  - `api/tests/fixtures/historical/transfers-0c5aef04/README.md`
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json`
  - `spec/DATA_MODEL.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (one named migration above only)
- **Exception process**:
  - [x] Record BRH2-EXn reason, impact and rollback before any additional conditional change.

## Feedback Loop
- [x] BRH2-EX2 — CI job 123301301873 fails full manifest parity because the historical router reads pinned journal 0043 while the product reads H2 journal 0048; session-denial logs belong to passing chat tests. Scope: parity harness and fixture documentation only. Bridge historical journal reads to the current product input, preserve pinned bytes/digests and complete archive equality. Rollback: revert the test bridge and documentation together.
- [ ] Peer dispatch awaits the owner's reply to the repository-mandated launch approval request; no consensus review is claimed. Dossier: `.tmp/canvas-h2-review/dossier.md` in the main workspace.
- [x] BRH2-EX1 — Root Docker npm ci dry-run reproduced missing chat-core 0.1.7: chat-server's old dependency excludes 0.2.0. Scope: its manifest and existing locks only. Advance to the new substantive port rather than installing another old stub; no server source changes. Rollback: revert manifest and matching lock entries together.
- [ ] Deferred integration: H1 final admission/registry wiring waits for #830 merge; H3 owns real provider conformance, H4 real inverse qualification, H5 publication authority, H10 production activation/N4 retirement.
- [x] User instruction replaces the LiveDocumentStore stub now; one exported substantive port, no alias or fallback.
- [x] Focus editing API pinned to h2a `98060bd0a` (0.5.0, unpublished: npm E404); inject its exact diff contract and use the planned FE-3 test double, without substituting the app-local Focus package.

## AI Flaky tests
- [x] No AI calls in H2 acceptance; no flaky exceptions requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; single code author; merge-only integration.

## UAT Management (in orchestration context)
- [x] No UI, Chrome or VSCode flow changes; acceptance uses host service and database witnesses.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read MASTER, workflow, testing, API services, data and schema migration rules, template and approved H2.
  - [x] Create isolated worktree and mechanically pass `harness check branch`.
  - [x] Define scope, test environment, ports and Docker lock.
- [x] **Lot 1 — Port and RED witnesses**
  - [x] Recovery witness authored before implementation, with real Yjs codec and test-only registry/storage fakes.
  - [x] Recovery RED: Docker Vitest fails on missing persistence module, before implementation.
  - [x] PostgreSQL crash/rollback, restart, idempotency, journal metadata and tenant witnesses authored before adapter implementation.
  - [x] Replace stub with host-only persistence contract; chat-core 0.2.0 exceeds npm 0.1.7 (Docker npm view).
  - [x] RED `api/tests/unit/canvas-live-recovery.test.ts`: checkpoints, replay, delete set/vector, epoch, corrupted watermark, tenant isolation.
  - [x] RED `api/tests/unit/canvas-live-journal.test.ts`: receipts, inverse/provenance atomicity, publish after commit, rebuild after failure; retention witness follows.
  - [x] RED `api/tests/unit/canvas-live-freeze-capture.test.ts`: cumulative retained-baseline diff and undo to baseline.
  - [x] RED `api/tests/api/canvas-live-persistence.test.ts`: missing adapter module; real PostgreSQL rollback, restart, duplicate keys and scope.
- [x] **Lot 2 — Durable database adapter**
  - [x] Added one idempotent branch migration and scoped three-table schema; documented full retention and H1/H3/H4/H10 integration boundaries.
  - [x] Implemented PostgreSQL row-locked transactions, synchronous WAL commit, immutable checkpoint history and duplicate-payload fencing.
  - [x] Sequence journal, atomic encoded-state checkpoints, immutable baseline, scoped migration/schema and DATA_MODEL.
  - [x] Durable roster, registry origins, admissions/acknowledgements, freeze exclusions/digest, refusals, receipts, inverse and revert records.
  - [x] Transactionally commit update/receipt/inverse/formatting intents; retain all dependency records with destructive compaction disabled.
- [x] **Lot 3 — Recovery and commit-gated publication**
  - [x] Initial GREEN: 17 scoped tests across all four planned files; added RED retention/checkpoint service witness and after-commit lost-ack witness.
  - [x] RED proved agent receipt omission and resealed stale watermark; added committed-state checkpoint creation and full-history coverage verification.
  - [x] Persist explicit total-order sequences on every formatting intent and typed restart-safe affected-item records.
  - [x] Implemented fresh committed-state reconstruction and discarded scratch candidates; no rejected tombstone reaches shared state.
  - [x] Restore fresh document from checkpoint plus exact suffix; reject inconsistent watermark and digest.
  - [x] Rebuild committed state after candidate persistence failure; gate all further publication until recovery succeeds.
  - [x] GREEN recovery and journal witnesses, including semantic same-value formatting reassertion.
- [x] **Lot 4 — FE-3 baseline bridge**
  - [x] Map complete captured blocks by manifest identities to pinned Focus `diffParagraphs`; preserve baseline at reconnect.
  - [x] GREEN cumulative diff, undo-empty and invalid capture refusal witnesses.
- [ ] **Lot 5 — Docs consolidation and final validation**
  - [x] CI parity correction: isolated Docker RED reproduces the schema tag/hash mismatch without other tests; GREEN targeted suite 8/8, exact endpoints shard 3/4 480/480, H2 four-file regression 22/22. Shared flock, prescribed ports and ENV=test-canvas-h2; runtime health 200 and make down after validation.
  - [x] Typecheck and lint passed for H2 services, schema, package port and tests; formatter applied to new source only in ≤150-line slices.
  - [x] All four H2 suites GREEN (20 tests); real isolated PostgreSQL crash/rollback/restart witnesses; chat-core regression suite 252/252.
  - [x] Root Docker npm ci dry-run passed after dependency correction; chat-server 0.4.1 exceeds published 0.4.0.
  - [x] Final local checks: H2 22/22, chat-core 252/252, chat-server 29/29, scoped strict typecheck, ESLint and Prettier all passed.
  - [x] Final self-review RED reproduced locale-dependent Unicode digest ordering; use deterministic code-unit key order and expose the complete substantive port types.
  - [x] Frozen DS shape re-read: use AnchorRange start/end, preserve receipt reasons/conflicts and lossless marks; RED reproduced transient rate-limit storage, now refused before commit.
  - [x] Typecheck RED then storage witness cover authoritative/preserved-draft migration records and draft/profile/epoch-linked acknowledgements (§4.8.1).
  - [ ] Review with at least two peers and resolve findings.
  - [x] `make scope-check` before every commit; verified every hunk serves H2 or its directly blocking manifest dependency.
  - [x] Draft PR #833 uses this BRANCH.md as body; initial five-step plan comment posted.
  - [ ] CI completed/success on the exact reported head; record PR and SHA.
  - [x] PostgreSQL test stack health passed; all runs torn down; explicit locked `make down` and `make ps` confirm no H2 services. No application runtime is activated in H2.
