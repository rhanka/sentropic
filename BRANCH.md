# Feature: Engram E2 PostgreSQL u64 persistence

## Objective
Persist exact u64 counters on PostgreSQL: counter codec, effects, journal/roots/readers paths and a new versioned migration for consumed counters/versions. Semantic counters travel separately from bounded page sizes and physical map-node IDs. Published SQL stays byte-identical.

## Scope / Guardrails
- Approved specification: root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E2 row and referenced sections.
- Branch `feat/cluster-mesh-engram-e2`; worktree `tmp/worktrees/mem-e2`; base `origin/feat/cluster-mesh-engram-e1`, no rebase.
- Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
- Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
- Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
- Preserve frozen common contracts and legacy safe numeric inputs; owner-authorized r1 PG journal/consumer/snapshot outputs carry exact decimal strings.
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
  - `packages/cluster-mesh/src/storage/postgres/snapshots.ts`
  - `packages/cluster-mesh/src/storage/postgres/scope.ts` (journal counter inputs only)
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
  - `packages/cluster-mesh/tests/storage/postgres-corpus.spec.ts` (bounded legacy corpus adapter only)
  - `packages/cluster-mesh/tests/storage/postgres-replay.spec.ts` (exact counter assertions only)
  - `packages/cluster-mesh/tests/storage/postgres-crashes.spec.ts` (exact watermark assertion only)
  - `packages/cluster-mesh/tests/storage/postgres-module-migrations.spec.ts` (007 occupies order 7; hypothetical future asset moves 007→008)
  - `packages/cluster-mesh/tests/storage/postgres-reattest.spec.ts` (007 shifts last-receipt ordinal 6→7)
  - `PLAN.md` (inherited: E0 merge content, unauthored here)
  - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts` (inherited: E0 merge content, unauthored here)
  - `packages/cluster-mesh/assets/storage/engram-memory/**` (inherited: E0 merge content, unauthored here)
  - `packages/cluster-mesh/src/storage/u64.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/src/storage/contracts.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/src/storage/backend.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/src/storage/instance-ownership.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/tests/engram-memory/**` (inherited: E0 merge content, unauthored here)
  - `packages/cluster-mesh/tests/comments-fragment-vectors.spec.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/tests/storage/u64-corpus.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/tests/storage/u64-contract.spec.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/tests/storage/representation-contract.spec.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/tests/storage/atomic-corpus.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/tests/storage/chain-corpus.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/tests/storage/read-corpus.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/tests/storage/common-rule/vectors.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/tests/storage/common-rule/contract.spec.ts` (inherited: E1 content, unauthored here)
  - `packages/cluster-mesh/tests/storage/instance-ownership.spec.ts` (inherited: E1 content, unauthored here)
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
  - `packages/cluster-mesh/src/storage/postgres/preparation.ts`
  - `packages/cluster-mesh/src/storage/postgres/units.ts`
  - `packages/cluster-mesh/src/engram-memory/**`
  - `packages/cluster-mesh/assets/storage/engram-memory/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Exception process**:
  - [x] BR2-EX2: owner-authorized PR765 r1 fixes include PostgreSQL snapshots, scope cursor signatures and directly affected PG tests; exact journal positions must cover full u64. Impact: PG counter strings; rollback: revert r1 commits together.
  - [x] BR2-EX1: pack-only package.json/root lock bump to unique `0.23.0-dev.3`; satisfies topic bump gate, never published; rollback both version fields together.

## Feedback Loop
- [x] PR765 r1 P1-2: PG atomic gate requires unique non-empty string result IDs for legacy and u64 units; missing and malformed IDs refuse before effects.
- [x] P1-2 negative fixture rows retain array identity (including duplicates) and include negative/unsafe numeric IDs; legacy and u64 gate paths both tested.
- [x] Base `origin/feat/cluster-mesh-engram-e1` at `2b741f557`; P2 unchanged (`2b85ff28...`).
- [x] Registry check 2026-10-26: mesh latest `0.22.1`; `0.23.0` reserved, `dev.1`/`dev.2` taken; `0.23.0-dev.3` is next free N.
- [x] Inventory: exact-u64 = scopes.version/sequence, fences.epoch, journal.sequence/positions/segments, consumer cursor/scanned/failedSeq/lag, snapshot watermarks, boundaries.version/sequence, chain allocation strings, aggregate versions/guards. Bounded Numbers = chain seq/count/positions, page sizes/limits/budgets, snapshot page ordinals, staged counts, work limits. Physical bigint IDs = map node/root IDs, boundary root, record offsets, schema ordinals.
- [x] PR765 r1 P1-1: journal positions, consumer progress and snapshot watermarks use decimal strings and BigInt arithmetic through max u64; legacy safe numeric inputs remain accepted.
- [x] Frozen numeric replay corpus stays unchanged; its PG-only test adapter checks safe fixture positions while production delivers exact strings.
- [x] PR765 r1 P1-1 regression: journal reads, poison/retry, checkpoint CAS, lag and retained snapshot completion/reopen tested at 2^53, 2^63 and max u64; unsafe numeric input refused.
- [x] PR765 r1 P2: real memory K3/K5/K8 compound keys pass memory effects validation, updates/guards/stale refusals through signed-64 crossing and max u64; post-publish hook failure rolls back root, record and journal at crossing/max with reopen and retry.
- [x] Post-publish rollback witness queries the same transaction and observes both updated scope counters and the inserted journal tail before injecting failure.
- [x] PR765 r1 P2 upgrade: populated 006 scopes/journal/fences/boundaries above 2^53 and at signed max survive 007, reopen, journal read and publication; all six counter columns reject negative and above-u64 writes.
- [x] 006 numeric JSON consumer positions normalize to exact decimal strings after upgrade without changing delivery/checkpoint behavior.
- [x] First real PG run: 75 passed, six new fixture setup refusals (empty descriptor chainKinds; comments grant on memory module). Fixed the descriptor and matching memory grant; upgrade, invalid indexes and post-publish rollback passed. Cleanup exit=0; rerun required.
- [x] R1 focused verification on source head `5eeb20d32`: `make engram-e2-lane E2_LANE=postgres API_PORT=9010 UI_PORT=5210 MAILDEV_UI_PORT=1110 ENV=test-e2-int` under the shared Docker lock: 81 passed, two dedicated crash-mode tests skipped; postgres-u64 25/25 and migration 5/5. Typecheck passed; both lane receipts record exit=0 and cleanup=0 in tmp/engram-e2-receipts.
- [x] R1 source push completed; full qualification remains assigned to queued CI (run 40400619477 on `5eeb20d32`). Removed the redundant local full-qualification waiter before any lane started; no orphan stack or lock holder.
- [ ] Rerun validate-cluster-mesh: requested after push, GitHub returned 403 because run 40388446346 is already queued/active; retry once it leaves that state. New-head CI also pending, no green CI claim.
- [x] Commit-options fences stay safe-only (`validateCommitOptions` frozen); u64 epochs flow through `provisionFence`/`fence` direct paths.
- [x] PR765 r1 P2-3 handoff to E4 (canonical PG acquisition) / E5 (neutral binding): widen commit-options epoch validation and replace strict representation comparisons in postgres/staged.ts, units.ts and seals.ts with exact u64 value comparisons. Acceptance: fenced ordinary/staged commits accept equal canonical epochs at 2^53, 2^63 and max u64, refuse stale epochs, and preserve frozen common behavior. Verification: real PG ownership/staged tests plus common-rule corpus. E2 regression explicitly proves current commitAtomic refusal before persistence; no E4/E5 implementation here.
- [ ] Push draft PR targeting `feat/engram-e2-integration`; E2 qualification green; no merge.
- [x] 007 consequence: the two specs pinning migration-chain ordinals move with the new version (module hypothetical 007→008, reattest last receipt 6→7); no behavior change.
- [x] Scope lesson (stacked PRs): the PR diff vs integration includes the E0 merge and E1 until #758/#763 land; E0/E1-originated paths above are declared inherited/unauthored. After they land, merge the integration base and drop those lines.

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
- [x] **Lot 1 — Tests first**
  - [x] Add `tests/storage/postgres-u64.spec.ts` (codec, crossing, max, exhaustion, reopen, rollback, conversion refusals).
  - [x] Add `tests/storage/postgres-u64-migration.spec.ts` (chain, idempotence, legacy compat, checksums, schema shape).
- [x] **Lot 2 — Implementation**
  - [x] Add `decodePgCounterU64` to `postgres/codec.ts`; keep legacy decoders frozen.
  - [x] Add `007-consumed-counters.sql` (numeric widening + u64 CHECKs); regenerate manifest; published SQL untouched.
  - [x] Move journal/roots/core/queries counters to `::numeric` bindings and u64 decodes; refuse at u64 exhaustion.
  - [x] Accept u64 aggregate versions/guards in PG effects (`U64AtomicUnit`, `validateU64AtomicUnit`); persist versions as given.
  - [x] Validate allocation comparison in readers (corruption on malformed).
- [ ] **Lot 3 — Final validation**
  - [x] `make scope-check` before each commit; commits under 150 lines via `make commit`.
  - [ ] Run build, typecheck, lint, memory, common, grants and real PG lanes with `ENV=test-e2-int` last.
  - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify E2 qualification green without merging.
