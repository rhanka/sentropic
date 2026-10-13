# Feature: Session Workspace Binding LOT1 D1 durable

## Objective
Attach or create an existing Sentropic workspace to an adopted session durably.

## Scope / Guardrails
- Scope limited to LOT1 D1 durable session workspace binding.
- One migration max in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- No D2 content consent or mirror, no UI.
- Cluster-mesh version coordination tuple: #662 is 0.14.0, #666 is 0.15.0, #664 moves to next free at rebase; this branch proposes 0.16.0.
- Migration recalage rule: `0011_session_workspace_bindings` has `when: 1791900000000` strictly after 0009 cowork (`1791632933743`) and 0010 live-git (`1791845400000`). If rebased, re-verify contiguous `idx` and `when > last.when`.
- History semantics: "Keep project and history after detach/end" guarantees that the Sentropic workspace data (files, commits, history) is preserved across session detachment and termination.
- Session registry dependency: session ID validity against the session registry is gated on PR #664 (L6a contract).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/sessions/workspace-binding.ts`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/tests/session-workspace.spec.ts`
  - `api/src/services/cluster-mesh/session-workspace.ts`
  - `api/src/db/control-schema.ts`
  - `api/tests/api/session-adoption.test.ts`
  - `api/tests/api/llm-admission-schema.test.ts`
  - `api/drizzle/control/0011_session_workspace_bindings.sql`
  - `api/drizzle/control/meta/_journal.json`
  - `.h2a/build/app_cm_lot1_report.md`
  - `.h2a/build/app_cm_lot1_fix_report.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/control/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] `BR01-EX1`: touch `api/drizzle/control/0011_session_workspace_bindings.sql` and `api/drizzle/control/meta/_journal.json` (one new migration, next free number avoiding 0009 cowork and 0010 PR 664 live-git)
  - `acknowledge`: single additive table with principal_id, rollback is DROP TABLE, no backfill
- [x] `BR01-EX2`: regenerate root `package-lock.json` via `make lock-root` for cluster-mesh 0.16.0 lock-sync (CI changes job)
  - `acknowledge`: one version line sync, rollback is restore lock entry
- [x] `BR01-EX3`: refresh `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` + `package-lock.json` for the 0.16.0 bump (CI validate-cluster-mesh test-lazy-package ENOENT sentropic-cluster-mesh-0.13.3.tgz)
  - `acknowledge`: fixture-only change, lock regenerated via `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock`, verified green via `test-lazy-package` (10 files / 63 tests), rollback is checkout both fixture files
- [x] `BR01-EX4`: evolve `api/tests/api/llm-admission-schema.test.ts` frozen-journal assertions for the new `0011_session_workspace_bindings` journal entry (CI test-api-unit-integration endpoints 3)
  - `acknowledge`: assertion-level evolution only, byte-identical to CI-green PR #664 pattern (0008 pinned at idx 8, applied row matched by hash, disposable upgrade expects journal.entries.length), 0008 semantics unchanged, rollback is checkout the test file

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
- Rationale: single LOT1 scope, one worktree, one test cycle

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
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules and proposal sources
  - [x] Confirm worktree `tmp/worktrees/session-workspace-binding` on branch `feat/session-workspace-binding` from `origin/main`
  - [x] Capture make targets for debug and testing
  - [x] Define environment mapping and ports for this branch
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last
  - [x] Confirm scope and guardrails
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BR01-EX1`
  - [x] Environment mapping: `ENV=test-session-ws`, `API_PORT=9490`, `UI_PORT=5690`, `MAILDEV_UI_PORT=1590`
  - [x] cluster-mesh version: propose `0.16.0` (0.14.0 taken by #662, next minor by #664), do not publish
  - [x] Lot gate:
    - [x] `make ps-all API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`
    - [x] `make scope-check API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`

- [x] **Lot 1 — D1 durable session workspace binding**
  - [x] RED: add `packages/cluster-mesh/tests/session-workspace.spec.ts` (rights, idempotence, restart, cross-tenant refusal, reuse, keep after detach and end)
  - [x] RED: add `api/tests/api/session-adoption.test.ts` (attach existing, create new, reuse, keep project and history after detach and end, rights, idempotence, restart, cross-tenant refusal)
  - [x] GREEN: add `packages/cluster-mesh/src/sessions/workspace-binding.ts` (pure binding behind narrow storage port for later L3a move)
  - [x] GREEN: export binding from `packages/cluster-mesh/src/index.ts`
  - [x] GREEN: bump `packages/cluster-mesh/package.json` to `0.16.0` (no publish)
  - [x] GREEN: extend `api/src/db/control-schema.ts` with `sessionWorkspaceBindings`
  - [x] GREEN: add `api/drizzle/control/0011_session_workspace_bindings.sql` (one migration, BR01-EX1)
  - [x] GREEN: add `api/src/services/cluster-mesh/session-workspace.ts` (attach and create existing Sentropic workspace durably, reuse, keep after detach and end)
  - [x] Lot gate:
    - [x] `make typecheck-cluster-mesh API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`
    - [x] `make lint-cluster-mesh API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`
    - [x] **API tests**
      - [x] Update `api/tests/api/session-adoption.test.ts` (new)
      - [x] Scoped runs while evolving tests: `make test-api-unit SCOPE=tests/api/session-adoption.test.ts API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`
      - [x] Sub-lot gate: `make test-api-unit SCOPE=tests/api/session-adoption.test.ts API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`
      - [x] AI flaky tests run (non-blocking only under acceptance rule): `make test-api-ai ENV=test-session-ws` and document status/signature in `BRANCH.md`
    - [x] **UI tests (TypeScript only)**
      - [x] No UI changes in LOT1
      - [x] Sub-lot gate: `make test-ui ENV=test-session-ws`
    - [x] **E2E tests**
      - [x] No E2E changes in LOT1
    - [x] `make test-cluster-mesh SCOPE=tests/session-workspace.spec.ts API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`

- [x] **Lot 2 — Opus NO-GO fixes**
  - [x] RED: add cluster-mesh principalId and rights tests in packages/cluster-mesh/tests/session-workspace.spec.ts
  - [x] GREEN: enforce principalId and rights in packages/cluster-mesh/src/sessions/workspace-binding.ts
  - [x] Migration 0011 re-date after 0009/0010 and add principal_id column to schema
  - [x] RED: add API refusal and RBAC tests in api/tests/api/session-adoption.test.ts
  - [x] GREEN: integrate cluster-mesh storage port in session-workspace service
  - [x] GREEN: enforce workspace RBAC and canonical creation in session-workspace service
  - [x] Sub-lot gate: test-cluster-mesh, test-api-unit, scope-check

- [ ] **Lot 3 — Opus r2 NO-GO fixes (r3)**
  - [x] RED: domain principal/CAS/uniform coverage in session-workspace.spec.ts
  - [x] RED: API principal/order/uniform/journal coverage in session-adoption.test.ts
  - [ ] RED: API editor/seeds/concurrency/admin/ended/get coverage in session-adoption.test.ts
  - [ ] GREEN: conditional binding writes in cluster-mesh domain (compare-and-set)
  - [ ] GREEN: required principal object inputs on detach/end/get (API + domain)
  - [ ] GREEN: rights order, global editor, canonical seeds, englobing transaction
  - [ ] GREEN: clean 0011 migration, re-date journal, BRANCH minors
  - [ ] Sub-lot gate: test-cluster-mesh, test-api-unit, scope-check

- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint
  - [x] Retest UI (no UI changes in Lot 1)
  - [x] Retest API (session-adoption scoped tests 10/10 PASS)
  - [x] Retest e2e (no E2E changes in Lot 1)
  - [x] Bumped affected `packages/<pkg>/package.json` version (cluster-mesh 0.16.0)
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
