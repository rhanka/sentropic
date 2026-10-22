# Feature: #861 L3 transaction-bound coordinator and migration

## Objective
Deliver the L3 atomic finalization coordinator with one additive migration and real-PostgreSQL regression tests.

## Scope / Guardrails
- Scope limited to the L3 exclusive write set below; never edit files owned by L1, L2, L4-L9 or mesh lots.
- r2 spec is binding; L0 shapes are read-only. L3 follows r2 names, reconciles with the L0 fix on merge.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/artifacts-861-L3`, based on feat/artifacts-861-contracts.
- Automated test campaigns run on dedicated environments (`ENV=test-artifacts-861-L3`), never on root `dev`.
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
- [ ] L3-L0MERGE (attention): Sol review found 5 P1 in L0 shapes; another session is fixing L0 on feat/artifacts-861-contracts. Merge it into this branch before finalizing and reconcile shared names toward the fixed declarations.
- [ ] L3-NOBUMP (acknowledge): no manifest or lock edits in L3 per the r2 single-writer rule, so the enforce-package-bump gate is expected to fail on this PR until the integration owner adds the serial version commit; every other gate must be green.
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
  - [x] ENV mapping: unit/typecheck/lint/integration on ENV=test-artifacts-861-L3 last argument; no services kept running.
  - [x] Confirm scope and guardrails; r2 names over L0 shapes; no manifest edits.
  - [x] Validate scope boundaries with make scope-check before each commit.
- [ ] **Lot 1 — Coordinator migration and postgreSQL executor**
  - [ ] packages/artifacts/migrations/0003_coordinator.sql: operation_keys plus operation_receipts, additive only.
  - [ ] packages/artifacts/src/adapters/postgres-commit.ts: coordination row, READ COMMITTED finalization connections, key lock, receipt read and insert.
  - [ ] Extend packages/artifacts/tests/migration.integration.test.ts with the 0003 describe block.
  - [ ] Extend packages/artifacts/tests/postgres.integration.test.ts with coordination-row convergence.
  - [ ] Lot gate:
    - [ ] make typecheck-artifacts ENV=test-artifacts-861-L3 last
    - [ ] make lint-artifacts ENV=test-artifacts-861-L3 last
- [ ] **Lot 2 — Commit protocol types and coordinator**
  - [ ] packages/artifacts/src/server/commit/types.ts: r2-exact invocation, context, fence, decision, transaction, participant, lock order, request and receipt types.
  - [ ] packages/artifacts/src/server/commit/coordinator.ts: A4 steps 1-6, guarded replay, 23505 resolution, COMMIT-ack unknown, fence verification, exactly-once release.
  - [ ] packages/artifacts/src/testing.ts: createArtifactCommitBarrier with the nine r2 points.
  - [ ] Lot gate:
    - [ ] make typecheck-artifacts ENV=test-artifacts-861-L3 last
    - [ ] make lint-artifacts ENV=test-artifacts-861-L3 last
- [ ] **Lot 3 — Coordinator regression tests and baseline proof**
  - [ ] packages/artifacts/tests/commit-coordinator.integration.test.ts: key recheck, same-key replay, different-hash conflict, denial rollback, guard-after-waits, revision race, last-unit quota race, two-process S3-barrier race, COMMIT unknown, exactly-once release.
  - [ ] Baseline proof: new and extended cases fail on the L0 head and pass on this branch.
  - [ ] Lot gate:
    - [ ] make test-artifacts-integration SCOPE=tests/commit-coordinator.integration.test.ts ENV=test-artifacts-861-L3 last
    - [ ] make test-artifacts-integration SCOPE=tests/migration.integration.test.ts ENV=test-artifacts-861-L3 last
    - [ ] make test-artifacts-integration SCOPE=tests/postgres.integration.test.ts ENV=test-artifacts-861-L3 last
    - [ ] make test-artifacts ENV=test-artifacts-861-L3 last (unit, no collateral)
    - [ ] make scope-check before each commit
- [ ] **Lot 4 — Merge L0 fix, PR and CI**
  - [ ] Merge feat/artifacts-861-contracts after the L0 fix lands; reconcile shared names toward the fixed declarations.
  - [ ] Atomic commits via make commit MSG only, each under 150 lines, git add selective files only.
  - [ ] Push branch and open DRAFT PR feat(artifacts): #861 L3 with base feat/artifacts-861-contracts.
  - [ ] CI green except the documented single-writer version gate; do not merge.
