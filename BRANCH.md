# Feature: Engram E6 PostgreSQL memory projection and resync

## Objective
- [ ] Complete #709 Lot 2 with durable memory projections, five scoped queries and transactional first-proof validation, following approved E6.

## Scope / Guardrails
- [x] Branch `feat/cluster-mesh-engram-e6`; worktree `tmp/worktrees/mem-e6`; draft base E0 `ad4164534`; merge only, integrate after E2.
- [x] Reuse #709 descriptor, validation and query definitions; Engram remains exactly 0.21.1.
- [x] Preserve P2 `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`; stop on change.
- [x] Make-only, zero Python, `ENV=test-e2-int` last; Docker shared lock and `make down` after each step.
- [x] Ports API 9030, UI 5230, Maildev 1130; qualification uses isolated Compose PostgreSQL without host ports.
- [x] Commit through `make commit`, below 150 changed lines; specific-file staging; no attribution trailers.
- [x] Keep public memory factory closed pending E3/E5/E7; no complete E2/backend qualification claim.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/engram-memory/postgres.ts`
  - `packages/cluster-mesh/src/engram-memory/postgres-queries.ts`
  - `packages/cluster-mesh/src/engram-memory/projection.ts`
  - `packages/cluster-mesh/assets/storage/postgres/engram-memory/**`
  - `packages/cluster-mesh/tests/engram-memory/**`
  - `packages/cluster-mesh/src/storage/postgres/migrations.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/**`
  - `tools/memory-mcp-l5/artifacts/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Exception process**:
  - [x] BRE6-EX1: unique pack-only 0.23.0-dev.5 package/root-lock version fields; never publish; rollback both fields together.

## Feedback Loop
- [x] E2 owns core `007-consumed-counters.sql`. E6 reserves memory chain `001-projections.sql`, next global receipt slot 008 after E2; no competing core migration.
- [ ] Coordinate shared loader: E6 is sole writer of memory role/selection/fingerprint substitutions in migrations.ts after E2; peer message pending automatic approval review.
- [x] Owner excludes Comments `incompatible_version` and selected packaging fixture 0.22.2 failures; #767 owns their one-time repair.

## AI Flaky tests
- [x] No AI tests or flaky waiver applies.

## Orchestration Mode (AI-selected)
- [x] Mono-branch implementation; merge dependency histories, never rebase or cherry-pick.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code change; qualify durable PG behavior in the isolated worktree.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Read Docker lock, rules, approved E6 and #709 view/diff; mechanically check branch.
  - [x] Record successor scope and independent memory migration reservation.
- [ ] **Lot 1 — Tests first**
  - [x] Author `tests/engram-memory/postgres-registration.spec.ts` and `pg-host.ts`: real apply/verify history, reopen, idempotence and drift refusal; RED queued under shared lock.
  - [x] Author `tests/engram-memory/queries.spec.ts`: all five queries, foreign scope, paging, retained boundaries and resync.
  - [x] Author `tests/engram-memory/projection.spec.ts`: live K7/K8, completion, P3 replay and rollback.
  - [ ] Rerun existing `first-proof.spec.ts` and `completion.spec.ts`.
- [ ] **Lot 2 — Implementation**
  - [ ] Memory-only SQL assets and shared schema-role loader hooks.
  - [ ] Transactional projection and backend-backed validation; reuse #709 transition functions.
  - [ ] Root-bound memory queries and scope-chain-index enumeration.
- [ ] **Lot 3 — Final validation and draft handoff**
  - [ ] Existing PG module-migration, migration, registration, query and policy regressions pass.
  - [ ] Build, typecheck, lint, memory/common/grants and real PG qualification lanes pass except the two owner-listed failures.
  - [ ] Scope-check before every commit; P2 unchanged and Engram exactly 0.21.1.
  - [ ] Unique pack-only 0.23.0-dev.5 commit.
  - [ ] Push draft PR to `feat/engram-e2-integration`; record head/CI/migration; do not merge.
