# Feature: Cluster-mesh SQLite L3a backend lot 1 with G3 commit fencing

## Objective
Deliver the node:sqlite L3a backend for the restart-durable lot 1 profile subset (atomic, chains, boundaries) with the shared conformance corpus, plus the storage-carried G3 commit fencing check on SQLite and Postgres. The remaining five profiles stay disabled until S2-S4 (Lot 2).

## Scope / Guardrails
- Scope limited to cluster-mesh storage SQLite backend, neutral instance-ownership contract, additive Postgres commit-possession hook, and their tests.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/cm-sqlite-l3a-g3` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/storage/sqlite/**`
  - `packages/cluster-mesh/src/storage/instance-ownership.ts`
  - `packages/cluster-mesh/src/storage/postgres/ordinary-transactions.ts`
  - `packages/cluster-mesh/src/storage/postgres/protocol.ts`
  - `packages/cluster-mesh/tests/storage/sqlite-*.ts`
  - `packages/cluster-mesh/tests/storage/sqlite.mk`
  - `packages/cluster-mesh/tests/storage/instance-ownership.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `plan/6[2-9]-BRANCH_*.md` (BR704-EX3, unchanged origin/main merge input only)
  - `plan/70-BRANCH_test-ci-ten-minute-proof.md` (BR704-EX3, unchanged origin/main merge input only)
  - `spec/**` (BR704-EX3, unchanged origin/main merge input only)
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `packages/cluster-mesh/src/modules/catalog.ts` (BR704-EX1, one range line only)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR704-EX2, candidate file: rename only)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR704-EX2, candidate file: rename only)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] **R1 runtime preparation**: fixed Node owner program plus synchronous IPC, with caller callbacks executed outside the writer process; no addon or helper binary. Connection integration and S0 probes follow in separate atomic commits.
- [x] **R7 round 2**: transaction callback ports revalidate possession before each operation and after awaited results; returning from the callback invalidates escaped ports. Tests cover loss inside the callback, loss during a prepared read, and use after callback completion.
- [x] **R4/R8 round 2**: bound profiles and capability lookup use the same lot-1 durable claims as the root; deferred profiles refuse. Supported capability ports bind to the SQLite facade, preserving immediate persistence and terminal revocation. Three regression probes verify negotiation, SQL state at ACK, and saved-port refusal after loss.
- [x] **R2 round 2**: one immediate admission slot per SQLite backend covers reads, preparation, persistence and rollback across all bound handles/scopes; overlapping independent calls refuse with `instance-busy`, without a queue. Regression probes cover rejected-write visibility and acknowledged-write preservation after retry.
- [x] **BR704-EX3**: owner-requested origin/main integration; incoming plan/spec changes only, no authored changes there. The conflict-free merge has no resolution delta; its first-parent size reflects imported main commits. Rollback: revert the integration merge.
- [x] **BR704-EX1** (R5): touch `packages/cluster-mesh/src/modules/catalog.ts` (one line: Comments range `>=0.19.0 <0.20.0` to `>=0.19.0 <0.21.0`) so the bumped 0.20.0 package passes its own installed gate. Reason: package self-compatibility, no behavior change. Impact: Comments module admits 0.19.x and 0.20.x. Rollback: revert the range line.
- [x] **R3**: Postgres possession hook runs after `roots.publish` (outbox callback included); protocol comment states the seam is not the full G3 guarantee. Regression test covers loss inside outbox with rollback.
- [x] **R4**: `profiles()` advertises only the restart-durable lot 1 subset (atomic, chains, boundaries); staged/journal/barrier/fence/purge claims stay disabled until S2-S4.
- [x] **R6**: owning moduleId persisted in `cm_meta` at creation and validated on reopen; cross-module reopen refuses before any read or mutation.
- [x] **R1**: `assertOwnership` re-verifies store file identity plus kernel POSIX lock liveness (procfs, no store fd) before trusting cached reads; acquisition contention maps to typed `instance-busy`.
- [x] **R2/R7**: mutations snapshot the scope and restore it when the inner op, the post-op revalidation, or `flushScope` fails; reads revalidate after the await.
- [x] **R1/R2/R6/R7 regression tests**: foreign-fd-close terminal probe, trigger-refusal rollback, prepared-read invalidation, and cross-module reopen refusal in the SQLite specs.
- [x] **R2 fixup**: restore preserves the live staged attachment and never replaces state on inner-op throw (coordinator owns inner atomicity and CAS identity).
- [x] **BR704-EX2** (lazy gate): selected fixture candidate rename `0.19.1` to `0.20.0` (package.json + lock, 4 lines) so the packed 0.20.0 candidate resolves; peers untouched. Reason: version-bump companion per precedent. Rollback: revert the rename.

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
- Rationale: single backend increment with one test cycle, no orthogonal workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`.
  - [ ] Create isolated worktree `tmp/worktrees/cm-sqlite-l3a-g3` on `feat/cluster-mesh-sqlite-l3a-g3` from `origin/main`.
  - [ ] Verify branch with `git -C tmp/worktrees/cm-sqlite-l3a-g3 branch --show-current`.
  - [ ] Capture Makefile targets: `typecheck-cluster-mesh`, `test-cluster-mesh SCOPE=<file>`, `pack-cluster-mesh`, `scope-check`, `commit`.
  - [ ] Define environment mapping: `ENV=test-cm-sqlite` for all commands, `ENV` last.
  - [ ] Confirm no host ports needed: disposable Docker cold workspace, no pg container for lot 1 gates.
  - [ ] Confirm scope boundaries and no `BRxx-EXn` exceptions needed.
- [ ] **Lot 1 — SQLite backend plus conformance plus G3 commit fencing**
  - [x] Neutral `CanonicalInstanceOwnershipV1` contract in `src/storage/instance-ownership.ts` with version and digest.
  - [x] SQLite open guard in `src/storage/sqlite/engine.ts`: engine check before WAL, WAL verified, FULL verified, EXCLUSIVE ownership with fail-fast second-holder refusal.
  - [x] Durable SQLite backend in `src/storage/sqlite/backend.ts`: per-scope snapshots persisted in one SQLite transaction per mutation, ownership re-verified before COMMIT.
  - [x] Kernel composition plus lot 1 restart-durable profile claims in `src/storage/sqlite/index.ts`, package export and version bump.
  - [x] Additive Postgres commit-possession hook in `postgres/protocol.ts` plus `postgres/ordinary-transactions.ts`, no behavior change when absent.
  - [x] Fixture plus shared-corpus SQLite specs: `tests/storage/sqlite-fixture.ts`, `tests/storage/sqlite-corpus.spec.ts`, `tests/storage/sqlite-lanes.spec.ts`.
  - [x] Ownership and fencing spec: `tests/storage/instance-ownership.spec.ts` covering double-acquire refusal, stale-epoch refusal, terminal loss, tampered-ownership commit refusal with rollback.
  - [x] New make targets in `tests/storage/sqlite.mk` for `cluster-mesh-sqlite-test`.
  - [x] Lot gate:
    - [x] `make typecheck-cluster-mesh ENV=test-cm-sqlite`
    - [ ] **API tests**
      - [ ] No API surface changed, no API test updates.
      - [ ] Sub-lot gate: not applicable, cluster-mesh package gate applies.
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI surface changed, no UI test updates.
    - [ ] **E2E tests**
      - [ ] No E2E surface changed, no E2E test updates.
    - [x] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/sqlite-corpus.spec.ts ENV=test-cm-sqlite`
    - [x] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/instance-ownership.spec.ts ENV=test-cm-sqlite`
    - [x] Sub-lot gate: `make test-cluster-mesh SCOPE=tests/storage/ ENV=test-cm-sqlite`
    - [x] Full pg sweep for the additive hook: all `postgres-*` suites green on live Postgres.
    - [x] `make scope-check` clean before every commit.
- [ ] **Lot 2 — Deferred to follow-up branches (out of scope here)**
  - [ ] Roots, staging, SPI, journal, claims, lifecycle, crash hardening per plan S2 through S4.
  - [ ] Postgres deferred guard asset and session admission per plan G-P0a through G-P1.
  - [ ] Full S0 falsification matrix including SIGKILL, rename, and cross-process cases.
  - [ ] Dual-corpus qualification, installed tarball, and CI gates per plan Q0 through Q2.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck and scoped storage tests green.
  - [ ] Bumped `packages/cluster-mesh/package.json` version for `src/**` change.
  - [ ] Final gate step 1: create draft PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run and verify branch CI on that PR, resolve remaining blockers.
  - [ ] Draft PR stays unmerged, report PR number, head SHA, lot checklist status, measured agent time.
