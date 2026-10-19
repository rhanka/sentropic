# Feature: Cluster-mesh SQLite L3a backend lot 1 with G3 commit fencing

## Objective
Deliver the node:sqlite L3a backend for the eight transactional profiles with the shared conformance corpus, plus the storage-carried G3 commit fencing check on SQLite and Postgres.

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
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop

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
  - [x] Kernel composition plus eight transactional profile claims in `src/storage/sqlite/index.ts`, package export and version bump.
  - [ ] Additive Postgres commit-possession hook in `postgres/protocol.ts` plus `postgres/ordinary-transactions.ts`, no behavior change when absent.
  - [ ] Fixture plus shared-corpus SQLite spec: `tests/storage/sqlite-fixture.ts`, `tests/storage/sqlite-corpus.spec.ts`.
  - [ ] Ownership and fencing spec: `tests/storage/instance-ownership.spec.ts` covering double-acquire refusal, stale-epoch refusal, terminal loss, tampered-ownership commit refusal with rollback.
  - [ ] New make targets in `tests/storage/sqlite.mk` for `cluster-mesh-sqlite-test`.
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh ENV=test-cm-sqlite`
    - [ ] **API tests**
      - [ ] No API surface changed, no API test updates.
      - [ ] Sub-lot gate: not applicable, cluster-mesh package gate applies.
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI surface changed, no UI test updates.
    - [ ] **E2E tests**
      - [ ] No E2E surface changed, no E2E test updates.
    - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/sqlite-corpus.spec.ts ENV=test-cm-sqlite`
    - [ ] Scoped runs while evolving tests: `make test-cluster-mesh SCOPE=tests/storage/instance-ownership.spec.ts ENV=test-cm-sqlite`
    - [ ] Sub-lot gate: `make test-cluster-mesh SCOPE=tests/storage/ ENV=test-cm-sqlite`
    - [ ] `make scope-check` clean before every commit.
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
