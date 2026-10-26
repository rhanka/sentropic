# Feature: Engram E3 original-result recovery

## Objective
- [ ] Recover the immutable stored moduleResult after a lost commit acknowledgement through scoped PostgreSQL lookup and a neutral memory bridge.

## Scope / Guardrails
- Approved specification: root `.tmp/engram-e2-host-tuple/plan.md`, revision 3, E3 row and referenced sections.
- Branch `feat/cluster-mesh-engram-e3`; worktree `tmp/worktrees/mem-e3`; base E2 `75076d43e`, merge never rebase.
- Make-only; `ENV=test-e2-int` last; 0 Python; no publication or merge.
- Serialize Docker/test steps with the shared lock; existing Compose targets only; `make down` after each step.
- Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop if an authored change alters it.
- Keep old exports/signatures compatible; legacy safe-integer paths keep frozen behavior.
- Specific-file staging; `make commit` only, each below 150 changed lines, without attribution trailers.
- Unique pack-only `0.23.0-dev.6`; Engram stays exactly `0.21.1`.
- Published SQL stays byte-identical; `007` is inherited from E2. No E3 migration or receipt table.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/storage/postgres/scope.ts`
  - `packages/cluster-mesh/src/storage/postgres/commit-results.ts`
  - `packages/cluster-mesh/src/engram-memory/commit-result-recovery.ts`
  - `packages/cluster-mesh/src/engram-memory/contract.ts`
  - `packages/cluster-mesh/tests/storage/postgres-result-recovery.spec.ts`
  - `packages/cluster-mesh/tests/storage/commit-result-corpus.ts`
  - `packages/cluster-mesh/tests/storage/commit-result-process.ts`
  - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts` (inherited shared CI fix #767)
  - `packages/cluster-mesh/tests/modules/registry.spec.ts` (inherited shared CI fix #767)
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` (inherited shared CI fix #767)
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
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/**`
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
  - `packages/cluster-mesh/assets/storage/engram-memory/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Exception process**:
  - [x] BR3-EX1: authorized pack-only package.json/root lock bump to `0.23.0-dev.6`; no publication; rollback both fields together.

## Feedback Loop
- [x] E2 #765 is in review at `75076d43e`; E3 owns recovery hooks next; E5 follows E3/E4 serially.
- [x] Source manifest baseline is inherited `f2b094ae034514727dfe2f4c9a89b3742e3d75beafc8f70e5074cd49d7f16642`; no P2/P3 re-pin or manifest edit is authorized here.
- [x] Known comments-installed `incompatible_version` on development bumps is explicitly out of scope.
- [x] CI head `978b99770`: E2 qualification green; full package tests found dev-version registry/fixture assertions. Reuse shared #767 by serial atomic merges, retaining its original commit identities and frozen fixture bytes; Comments installed compatibility stays out of scope.
- [x] Shared #767 merge 1/4: inherit `49abeb593` dev-pin assertions; E3 implementation and pack version remain unchanged.
- [x] Shared #767 merge 2/4: inherit `66258e171` explicit pack-only dev predicate and its tests.
- [x] Shared #767 merge 3/4: inherit `52747b5b0` bounded version helper and synthetic proofs; final stable-candidate proof follows separately to keep this merge under 150 lines.
- [x] The inherited E0/E1/E2 paths above describe stacked PR ancestry only; authored E3 changes are restricted to recovery files and pack metadata.
- [ ] Push draft PR to `feat/engram-e2-integration`; get E2 qualification green; do not merge.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: one E3 topic on E2, integrated by merge only; no delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code changes; qualify durable recovery and authority through storage tests.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and branch setup**
  - [x] Read Docker lock, mandatory rules, approved E3 plan and neutral recovery contract.
  - [x] Create `tmp/worktrees/mem-e3` on E2 and pass mechanical harness branch check.
  - [x] Use existing Compose qualification targets with shared Docker lock and cleanup after each step; ENV last.
- [x] **Lot 1 — Tests first**
  - [x] Add `tests/storage/commit-result-corpus.ts`: exact opaque result/time/epoch, absence, copy isolation, conflicting intent.
  - [x] Add `tests/storage/postgres-result-recovery.spec.ts`: lost ACK, process restart, new epoch, current grant/fence, foreign scopes, transient failure.
  - [x] Add `tests/storage/commit-result-process.ts` for independent writer crash and recovery.
  - [x] Focused red run: missing `commit-result-recovery.js` before implementation (2026-10-26).
- [ ] **Lot 2 — Implementation**
  - [x] Add scoped lookup over existing immutable commit receipts; reuse stored moduleResult exclusively.
  - [x] Add and export neutral recovery bridge with required current fence provider; keep memory factory closed until E7.
  - [x] Preserve frozen manifests, SQL, neutral contract and Engram version; pack-only mesh bump is `0.23.0-dev.6`.
  - [x] Crash injection targets the transaction returning a receipt, after the idempotency preflight; expired fences refuse reads.
  - [x] Test grant expiry during the storage wait; revalidation must refuse the stored result.
- [ ] **Lot 3 — Final validation**
  - [x] Focused PostgreSQL recovery: 5 tests passed, zero skips; includes independent post-COMMIT SIGKILL/restart.
  - [x] Typecheck identified generic base64 versus frozen memory UTF-8 boundary; bridge now refuses base64 without decoding or resampling.
  - [x] Rerun focused recovery and typecheck after UTF-8 correction: 5 PG tests, zero skips; source/test typechecks and lint pass.
  - [ ] `make scope-check` before each commit; commits under 150 lines via `make commit`.
  - [ ] Run build, typecheck, lint, memory, common, grants and real PG lanes with `ENV=test-e2-int` last.
  - [ ] Push and open draft PR targeting `feat/engram-e2-integration`; verify E2 qualification green without merging.
