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
- [ ] **Lot 1 — Port and RED witnesses**
  - [x] Recovery witness authored before implementation, with real Yjs codec and test-only registry/storage fakes.
  - [x] Recovery RED: Docker Vitest fails on missing persistence module, before implementation.
  - [x] PostgreSQL crash/rollback, restart, idempotency, journal metadata and tenant witnesses authored before adapter implementation.
  - [x] Replace stub with host-only persistence contract; chat-core 0.2.0 exceeds npm 0.1.7 (Docker npm view).
  - [x] RED `api/tests/unit/canvas-live-recovery.test.ts`: checkpoints, replay, delete set/vector, epoch, corrupted watermark, tenant isolation.
  - [x] RED `api/tests/unit/canvas-live-journal.test.ts`: receipts, inverse/provenance atomicity, publish after commit, rebuild after failure; retention witness follows.
  - [x] RED `api/tests/unit/canvas-live-freeze-capture.test.ts`: cumulative retained-baseline diff and undo to baseline.
  - [x] RED `api/tests/api/canvas-live-persistence.test.ts`: missing adapter module; real PostgreSQL rollback, restart, duplicate keys and scope.
- [ ] **Lot 2 — Durable database adapter**
  - [x] Added one idempotent branch migration and scoped three-table schema; documented full retention and H1/H3/H4/H10 integration boundaries.
  - [x] Implemented PostgreSQL row-locked transactions, synchronous WAL commit, immutable checkpoint history and duplicate-payload fencing.
  - [ ] Sequence journal, atomic encoded-state checkpoints, immutable baseline, scoped migration/schema and DATA_MODEL.
  - [ ] Durable roster, registry origins, admissions/acknowledgements, freeze exclusions/digest, refusals, receipts, inverse and revert records.
  - [ ] Transactionally commit update/receipt/inverse/formatting intents; preserve retained dependency references during compaction.
- [ ] **Lot 3 — Recovery and commit-gated publication**
  - [x] Initial GREEN: 17 scoped tests across all four planned files; added RED retention/checkpoint service witness and after-commit lost-ack witness.
  - [x] RED proved agent receipt omission and resealed stale watermark; added committed-state checkpoint creation and full-history coverage verification.
  - [x] Persist explicit total-order sequences on every formatting intent and typed restart-safe affected-item records.
  - [x] Implemented fresh committed-state reconstruction and discarded scratch candidates; no rejected tombstone reaches shared state.
  - [ ] Restore fresh document from checkpoint plus exact suffix; reject inconsistent watermark and digest.
  - [ ] Rebuild committed state after candidate persistence failure; gate all further publication until recovery succeeds.
  - [ ] GREEN recovery and journal witnesses, including semantic same-value formatting reassertion.
- [ ] **Lot 4 — FE-3 baseline bridge**
  - [ ] Map complete captured blocks by manifest identities to pinned Focus `diffParagraphs`; preserve baseline at reconnect.
  - [ ] GREEN cumulative diff, undo-empty and invalid capture refusal witnesses.
- [ ] **Lot 5 — Docs consolidation and final validation**
  - [ ] Typecheck, lint, formatting and package-port checks.
  - [ ] All four scoped H2 suites GREEN on real isolated PostgreSQL where applicable.
  - [ ] Review with at least two peers and resolve findings.
  - [ ] `make scope-check` before every commit; verify no out-of-scope hunks.
  - [ ] Draft PR using this BRANCH.md as body; initial plan comment.
  - [ ] CI completed/success on the exact reported head; record PR and SHA.
  - [ ] Inspect service logs and `make down` after validation.

- [x] Formatter slice 1: apply repository style to new H2 source only.

- [x] Formatter slice 2: continue source-only H2 formatting.

- [x] Formatter slice 3: source-only H2 formatting.

- [x] Formatter slice 4: source-only H2 formatting.
