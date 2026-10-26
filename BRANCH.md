# Feature: Engram E2 PostgreSQL u64 persistence

## Objective
Persist exact u64 counters on PostgreSQL: counter codec, effects, journal/roots/readers paths and a new versioned migration for consumed counters/versions. Semantic counters travel separately from bounded page sizes and physical map-node IDs. Published SQL stays byte-identical.

## Scope / Guardrails
- Approved specification: root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E2 row and referenced sections.
- Branch `feat/cluster-mesh-engram-e2`; worktree `tmp/worktrees/mem-e2`; base `origin/feat/cluster-mesh-engram-e1`, no rebase.
- Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
- Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
- Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
- Keep old exports/signatures compatible; legacy safe-integer paths keep frozen behavior.
- Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
- Unique pack-only `0.23.0-dev.3`, next free N after E1.
- Published 001-006 and comments SQL stay byte-identical (checksums pinned in tests); only `007` is new.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/storage/atomic.ts` (additive `U64AtomicUnit` + `validateU64AtomicUnit` only)
  - `packages/cluster-mesh/src/storage/postgres/codec.ts`
  - `packages/cluster-mesh/src/storage/postgres/effects.ts`
  - `packages/cluster-mesh/src/storage/postgres/journal.ts`
  - `packages/cluster-mesh/src/storage/postgres/roots.ts`
  - `packages/cluster-mesh/src/storage/postgres/readers.ts`
  - `packages/cluster-mesh/src/storage/postgres/core.ts` (fence/provision epoch only)
  - `packages/cluster-mesh/src/storage/postgres/queries.ts` (boundary version/sequence only)
  - `packages/cluster-mesh/src/storage/postgres/ordinary-transactions.ts` (u64 unit acceptance only)
  - `packages/cluster-mesh/assets/storage/postgres/007-consumed-counters.sql`
  - `packages/cluster-mesh/assets/storage/postgres/manifest.json` (`007` entry only)
  - `packages/cluster-mesh/tests/storage/generate-pg-manifest.mjs` (`007` file entry only)
  - `packages/cluster-mesh/tests/storage/postgres-u64.spec.ts`
  - `packages/cluster-mesh/tests/storage/postgres-u64-migration.spec.ts`
  - `packages/cluster-mesh/tests/storage/postgres-module-migrations.spec.ts` (007 occupies order 7; hypothetical future asset moves 007→008)
  - `packages/cluster-mesh/tests/storage/postgres-reattest.spec.ts` (007 shifts last-receipt ordinal 6→7)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/src/storage/u64.ts`
  - `packages/cluster-mesh/src/storage/contracts.ts`
  - `packages/cluster-mesh/src/storage/backend.ts`
  - `packages/cluster-mesh/src/storage/instance-ownership.ts`
  - `packages/cluster-mesh/src/storage/common-contract.ts`
  - `packages/cluster-mesh/assets/storage/postgres/001-core.sql`
  - `packages/cluster-mesh/assets/storage/postgres/002-map.sql`
  - `packages/cluster-mesh/assets/storage/postgres/003-staged.sql`
  - `packages/cluster-mesh/assets/storage/postgres/004-queries.sql`
  - `packages/cluster-mesh/assets/storage/postgres/005-cleanup.sql`
  - `packages/cluster-mesh/assets/storage/postgres/006-staged-coverage.sql`
  - `packages/cluster-mesh/assets/storage/postgres/comments/**`
  - `packages/cluster-mesh/src/storage/postgres/snapshots.ts`
  - `packages/cluster-mesh/src/storage/postgres/preparation.ts`
  - `packages/cluster-mesh/src/storage/postgres/units.ts`
  - `packages/cluster-mesh/src/engram-memory/**`
  - `packages/cluster-mesh/assets/storage/engram-memory/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Exception process**:
  - [x] BR2-EX1: pack-only package.json/root lock bump to unique `0.23.0-dev.3`; satisfies topic bump gate, never published; rollback both version fields together.

## Feedback Loop
- [x] Base `origin/feat/cluster-mesh-engram-e1` at `2b741f557`; P2 unchanged (`2b85ff28...`).
- [x] Registry check 2026-10-26: mesh latest `0.22.1`; `0.23.0` reserved, `dev.1`/`dev.2` taken; `0.23.0-dev.3` is next free N.
- [x] Inventory: exact-u64 = scopes.version/sequence, fences.epoch, journal.sequence, boundaries.version/sequence, chain allocation strings, aggregate versions/guards. Bounded Numbers stay = chain seq/count/positions, read windows/limits/budgets, consumer cursor/scanned, staged counts, work limits. Physical bigint IDs stay = map node/root IDs, boundary root, record offsets, schema ordinals.
- [x] Read windows and consumer positions stay bounded: `readPgJournal`/snapshots refuse above-safe journals with the existing capacity error (fail-closed; u64-scale replay is follow-on, not this lot).
- [x] Commit-options fences stay safe-only (`validateCommitOptions` frozen); u64 epochs flow through `provisionFence`/`fence` direct paths.
- [ ] Push draft PR targeting `feat/engram-e2-integration`; E2 qualification green; no merge.
- [x] 007 consequence: the two specs pinning migration-chain ordinals move with the new version (module hypothetical 007→008, reattest last receipt 6→7); no behavior change.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one E2 topic on the E1 branch; no delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code changes; qualify PG counters, migration, reopen and rollback.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and branch setup**
  - [x] Read Docker lock, approved plan E2 row, C5 binding and K3/K5/K8 version rule.
  - [x] Trace impact across codec, journal, roots, readers, effects, core, queries, migrations.
  - [x] Create worktree `tmp/worktrees/mem-e2` on E1 base; verify P2 unchanged.
  - [x] Write BRANCH.md from template; reserve pack-only `0.23.0-dev.3`.
- [ ] **Lot 1 — Tests first**
  - [ ] Add `tests/storage/postgres-u64.spec.ts` (codec, crossing, max, exhaustion, reopen, rollback, conversion refusals).
  - [ ] Add `tests/storage/postgres-u64-migration.spec.ts` (chain, idempotence, legacy compat, checksums, schema shape).
- [ ] **Lot 2 — Implementation**
  - [ ] Add `decodePgCounterU64` to `postgres/codec.ts`; keep legacy decoders frozen.
  - [ ] Add `007-consumed-counters.sql` (numeric widening + u64 CHECKs); regenerate manifest; published SQL untouched.
  - [ ] Move journal/roots/core/queries counters to `::numeric` bindings and u64 decodes; refuse at u64 exhaustion.
  - [ ] Accept u64 aggregate versions/guards in PG effects (`U64AtomicUnit`, `validateU64AtomicUnit`); persist versions as given.
  - [ ] Validate allocation comparison in readers (corruption on malformed).
- [ ] **Lot 3 — Final validation**
  - [ ] `make scope-check` before each commit; commits under 150 lines via `make commit`.
  - [ ] Run build, typecheck, lint, memory, common, grants and real PG lanes with `ENV=test-e2-int` last.
  - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify E2 qualification green without merging.
