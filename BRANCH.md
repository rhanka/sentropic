# Feature: #861 L5 ensure and guarded replay

## Objective
Deliver the L5 coordinator-bound ensure path with guarded replay on top of the frozen L0 contracts and the L1/L2/L3 lanes.

## Scope / Guardrails
- Scope limited to the L5 exclusive write set below; never edit files owned by L0-L4 or L6-L9 lanes.
- r2 spec is binding; L0 shapes are read-only. L5 follows r2 names and uses frozen shared ports only.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/861-L5`, based on origin/feat/artifacts-861-L3 with L1 plus L2 merged in.
- Automated test campaigns run on dedicated environment (`ENV=test-861-l5`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- No package manifest or lock edits in L5 (single-writer integration owner rule); no version bump.
- No export-map or barrel edits in L5 (qualified in L6/L8).
- Legacy split ensure path stays intact for L6-owned consumers; L5 adds the guarded composition alongside, never a second implicit fallback.
- Coordinator changes needed by L5 are returned to the L3 owner; L5 does not edit coordinator files.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.track/**` (branch-lifecycle step 4 re-anchor at setup only; no further track writes in this lot)
  - `packages/artifacts/src/server/service.ts`
  - `packages/artifacts/src/server/authorized-replay.ts`
  - `packages/artifacts/tests/ensure-authorization.integration.test.ts`
  - `packages/artifacts/tests/service.test.ts`
  - `packages/artifacts/tests/idempotency.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/artifacts/package.json`
  - `packages/artifacts/src/index.ts`
  - `packages/artifacts/src/http.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/src/mcp.ts`
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/src/server/object-intents.ts`
  - `packages/artifacts/src/server/lifecycle.ts`
  - `packages/artifacts/src/server/commit/**`
  - `packages/artifacts/src/server/failures.ts`
  - `packages/artifacts/src/server/outcome-projection.ts`
  - `packages/artifacts/src/server/command-identity.ts`
  - `packages/artifacts/src/server/idempotency.ts`
  - `packages/artifacts/src/server/bindings.ts`
  - `packages/artifacts/src/adapters/postgres-commit.ts`
  - `packages/artifacts/src/profile/**`
  - `packages/artifacts/src/testing.ts`
  - `packages/artifacts/l0-freeze/**`
  - `packages/cluster-mesh/**`
  - `packages/mcp-platform/**`
  - `packages/mcp-auth/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] L5-BASE (acknowledge): worktree tmp/worktrees/861-L5 on branch feat/artifacts-861-L5 from origin/feat/artifacts-861-L3; merged origin/feat/artifacts-861-L1 then origin/feat/artifacts-861-L2 (BRANCH.md conflicts resolved toward ours; L5 BRANCH.md replaces the file next). Merge commits used direct git; all other commits use make commit MSG only.
- [x] L5-TRACK (acknowledge): branch-lifecycle containment gate PASS (candidate contains all 342 branch event ids, rc=0); step 4 consolidate ok with zero skipped items; the 4 re-anchor events ship in the init commit; no further track writes in this lot.
- [ ] L5-LEGACY (attention): legacy createArtifactService plus ensurePrivateView stay intact because http.ts and L6-owned tests consume them; L6 removes the split path during wiring. No second implicit fallback is added by L5.
- [ ] L5-QUOTA (attention): ensure finalization reserves quota through the coordinator participant; replay never recharges (coordinator runs pre-quota lock groups on replayGuarded).

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
- Rationale: L5 is one lot in the S2 parallel wave with L4; integration happens on the integration branch after the wave.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in L5; no UAT checkpoints apply.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, r2 spec S2/L5 row plus sections 2-4, L0 frozen contracts, L1/L2/L3 sources.
  - [x] Worktree tmp/worktrees/861-L5 on branch feat/artifacts-861-L5 from origin/feat/artifacts-861-L3 verified, L1 plus L2 merged, track containment gate PASS.
  - [x] ENV mapping: unit/typecheck/lint/integration on ENV=test-861-l5 last argument; no services kept running.
  - [x] Confirm scope and guardrails; frozen shared ports only; no manifest edits.
  - [x] Validate scope boundaries with make scope-check before each commit.
- [x] **Lot 1 — Guarded ensure composition plus authorized replay**
  - [x] packages/artifacts/src/server/authorized-replay.ts: ensure-domain replay adapter over coordinator.replayGuarded with request-bound guard, stored-receipt to ensure-result projection, quarantine propagation.
  - [x] packages/artifacts/src/server/service.ts: guarded ensure composition alongside legacy exports (compiled profile plus key derivation plus invocation context, effective command, coordinator finalize with binding lock plus provisional effects, typed entry failures, no caller hash or scope).
  - [x] Lot gate:
    - [x] make typecheck-artifacts ENV=test-861-l5 last
    - [x] make lint-artifacts ENV=test-861-l5 last
- [ ] **Lot 2 — Ensure and replay regression tests**
  - [x] packages/artifacts/tests/service.test.ts: guarded ensure unit tests on a memory executor (success plus replay, denial with zero success row, fresh retry after denial, same-key different-command conflict, legacy tests untouched).
  - [x] packages/artifacts/tests/idempotency.test.ts: durable-key idempotency (refused attempt never poisons the key, success replays only while currently authorized; legacy store tests untouched).
  - [x] packages/artifacts/tests/ensure-authorization.integration.test.ts: real-PG ensure (guard-after-waits denial with zero committed residue, fresh denial retry, cross-invocation replay without recharge, same-key conflict, last quota unit, actor isolation, legacy quarantine).
  - [ ] Lot gate:
    - [x] make test-artifacts SCOPE=tests/service.test.ts ENV=test-861-l5 last
    - [x] make test-artifacts SCOPE=tests/idempotency.test.ts ENV=test-861-l5 last
    - [x] make test-artifacts-integration SCOPE=tests/ensure-authorization.integration.test.ts ENV=test-861-l5 last
    - [x] make test-artifacts ENV=test-861-l5 last (unit, no collateral)
    - [x] make scope-check before each commit
- [ ] **Lot 3 — PR and CI**
  - [ ] Atomic commits via make commit MSG only, each under 150 lines, git add selective files only.
  - [ ] Push branch and open DRAFT PR targeting feat/artifacts-861-L3.
  - [ ] Local gates green: typecheck plus lint plus unit plus integration plus scope-check; record PR number plus head SHA.
