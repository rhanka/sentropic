# Feature: #861 L3 transaction-bound coordinator and migration

## Objective
Deliver the L3 atomic finalization coordinator with one additive migration and real-PostgreSQL regression tests.

## Scope / Guardrails
- Scope limited to the L3 exclusive write set below; never edit files owned by L1, L2, L4-L9 or mesh lots.
- r2 spec is binding; L0 shapes are read-only. L3 follows r2 names, reconciles with the L0 fix on merge.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/artifacts-861-L3`, based on feat/artifacts-861-contracts.
- Automated test campaigns run on dedicated environments (`ENV=test-artifacts-861-l3`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- No package manifest or lock edits in L3 (single-writer integration owner rule); no version bump.
- No export-map or barrel edits in L3 (qualified in L6/L8).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/commit/types.ts`
  - `packages/artifacts/src/server/commit/coordinator.ts`
  - `packages/artifacts/src/adapters/postgres-commit.ts`
  - `packages/artifacts/src/testing.ts`
  - `packages/artifacts/migrations/0003_coordinator.sql`
  - `packages/artifacts/tests/commit-coordinator.integration.test.ts`
  - `packages/artifacts/tests/migration.integration.test.ts`
  - `packages/artifacts/tests/postgres.integration.test.ts`
  - `packages/artifacts/tests/radar-commit-setup.integration.test.ts`
  - `packages/artifacts/examples/radar-commit-setup.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/artifacts/package.json`
  - `packages/artifacts/src/index.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/src/mcp.ts`
  - `packages/artifacts/src/http.ts`
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/src/server/service.ts`
  - `packages/artifacts/src/server/idempotency.ts`
  - `packages/artifacts/src/server/object-intents.ts`
  - `packages/artifacts/src/adapters/postgres.ts`
  - `packages/artifacts/src/adapters/s3.ts`
  - `packages/artifacts/l0-freeze/**`
  - `packages/cluster-mesh/**`
  - `packages/mcp-platform/**`
  - `packages/mcp-auth/**`
  - `.github/workflows/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] L3-L0MERGE (attention): Sol review found 5 P1 in L0 shapes; another session is fixing L0 on feat/artifacts-861-contracts. Merged through d4bd43b3c; reconciled toward the fixed declarations (fixed context, fence, transaction, variant, success-correlation shapes mirrored in src/server/commit/types.ts; FinalizationCoordinator renamed to leave the fixed role descriptor untouched; observer barrier shape intentionally unchanged — see L3-BARRIER).
- [ ] L3-BARRIER (acknowledge): the fixed CommitBarrierObserver.arrive is sync void while the L3 testing barrier blocks per armed pair; L3 keeps its proven blocking seam (r2 names the factory members and nine points, both match) and leaves unification to integration.
- [ ] L3-EXAMPLE (acknowledge): conductor-directed typed public example of the Radar construction (coordinator plus PG participant plus fence plus sweeper). Example imports only L3 src modules; profile/app wiring stays L6-provided and is referenced textually, not sketched. Type-check evidence comes from a one-off tsc run with the repo toolchain (tsconfig covers src only); the integration test proves it runs.
- [ ] L3-NOBUMP (acknowledge): no manifest or lock edits in L3 per the r2 single-writer rule, so the enforce-package-bump gate is expected to fail on this PR until the integration owner adds the serial version commit; every other gate must be green.
- [x] L3-ENV (acknowledge): packet ENV upper-case suffix rejected by compose project naming, so all L3 gates use lowercase ENV=test-artifacts-861-l3 with identical isolation.
- [ ] L3-QUOTA (acknowledge): quota-exhausted finalization maps to conflict 409 non-retriable as a genuine conflict; r2 names no explicit quota-exhausted outcome.
- [ ] L3-QUARANTINE (acknowledge): unknown legacy codec on a found success row raises a typed quarantine error for L6 projection; L3 invents no migration-condition taxonomy.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: L3 is one lot in the S1 parallel wave; integration happens on the integration branch after the wave.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in L3; no UAT checkpoints apply.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, r2 spec L3 row plus sections 1-5, Q0 inventory, Sol L0 review.
  - [x] Worktree tmp/worktrees/artifacts-861-L3 on branch feat/artifacts-861-L3 from feat/artifacts-861-contracts verified.
  - [x] ENV mapping: unit/typecheck/lint/integration on ENV=test-artifacts-861-l3 last argument; no services kept running.
  - [x] Confirm scope and guardrails; r2 names over L0 shapes; no manifest edits.
  - [x] Validate scope boundaries with make scope-check before each commit.
- [x] **Lot 1 — Coordinator migration and postgreSQL executor**
  - [x] packages/artifacts/migrations/0003_coordinator.sql: operation_keys plus operation_receipts, additive only.
  - [x] packages/artifacts/src/adapters/postgres-commit.ts: coordination row, READ COMMITTED finalization connections, key lock, receipt read and insert.
  - [x] Extend packages/artifacts/tests/migration.integration.test.ts with the 0003 describe block.
  - [x] Extend packages/artifacts/tests/postgres.integration.test.ts with coordination-row convergence.
  - [x] Lot gate:
    - [x] make typecheck-artifacts ENV=test-artifacts-861-l3 last
    - [x] make lint-artifacts ENV=test-artifacts-861-l3 last
- [x] **Lot 2 — Commit protocol types and coordinator**
  - [x] packages/artifacts/src/server/commit/types.ts: r2-exact invocation, context, fence, decision, transaction, participant, lock order, request and receipt types (self-contained: tsc rootDir bars l0-freeze imports).
  - [x] packages/artifacts/src/server/commit/coordinator.ts: A4 steps 1-6, guarded replay, 23505 resolution, COMMIT-ack unknown, fence verification, exactly-once release, destroy-on-uncertain-release, one-shot armed barriers.
  - [x] packages/artifacts/src/testing.ts: createArtifactCommitBarrier with the nine r2 points.
  - [x] Lot gate:
    - [x] make typecheck-artifacts ENV=test-artifacts-861-l3 last
    - [x] make lint-artifacts ENV=test-artifacts-861-l3 last
- [x] **Lot 3 — Coordinator regression tests and baseline proof**
  - [x] packages/artifacts/tests/commit-coordinator.integration.test.ts: 14 tests (key recheck, same-key replay, different-hash conflict, denial rollback, guard-after-waits, revision race, last-unit quota race, two-process S3-barrier race, COMMIT unknown, exactly-once release, quarantine, replay quota policy, malformed input).
  - [x] Baseline proof: new file fails to collect, 2 migration cases fail, postgres file fails on the L0 head; all pass on this branch.
  - [x] Lot gate:
    - [x] make test-artifacts-integration SCOPE=tests/commit-coordinator.integration.test.ts ENV=test-artifacts-861-l3 last (14/14)
    - [x] make test-artifacts-integration SCOPE=tests/migration.integration.test.ts ENV=test-artifacts-861-l3 last (9/9)
    - [x] make test-artifacts-integration SCOPE=tests/postgres.integration.test.ts ENV=test-artifacts-861-l3 last (11/11)
    - [x] make test-artifacts ENV=test-artifacts-861-l3 last (unit, no collateral: 216/216)
    - [x] make scope-check before each commit
- [ ] **Lot 4 — Merge L0 fix, PR and CI**
  - [x] Merge feat/artifacts-861-contracts after the L0 fix lands; reconcile shared names toward the fixed declarations.
  - [x] Ship the typed Radar construction example (examples/radar-commit-setup.ts plus tests/radar-commit-setup.integration.test.ts, 3/3 green, one-off tsc proof with the repo toolchain).
  - [x] Atomic commits via make commit MSG only, each under 150 lines, git add selective files only (one merge commit used direct git for the L0-fix merge conflict resolution).
  - [x] Push branch and open DRAFT PR feat(artifacts): #861 L3 with base feat/artifacts-861-contracts (PR #727).
  - [x] CI status: the CI workflow triggers only on main-targeted PRs and pushes, so PR #727 gets no workflow runs; every repo gate verified locally on HEAD (typecheck, lint, unit 232/232, integration 14/14 plus 9/9 plus 11/11 plus 3/3, scope-check PASS each commit). The enforce-package-bump gate remains expected-fail until the integrator adds the serial version commit. Do not merge.
