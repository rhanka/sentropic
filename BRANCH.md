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

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/sessions/workspace-binding.ts`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/tests/session-workspace.spec.ts`
  - `api/src/services/cluster-mesh/session-workspace.ts`
  - `api/src/db/control-schema.ts`
  - `api/tests/api/session-adoption.test.ts`
  - `.h2a/build/app_cm_lot1_report.md`
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
- [ ] `BR01-EX1`: touch `api/drizzle/control/0011_session_workspace_bindings.sql` (one new migration, next free number avoiding 0009 cowork and 0010 PR 664 live-git) (requires clarification about none)
  - `acknowledge`: single additive table, rollback is DROP TABLE, no backfill

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
    - [ ] `make scope-check API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`

- [ ] **Lot 1 — D1 durable session workspace binding**
  - [x] RED: add `packages/cluster-mesh/tests/session-workspace.spec.ts` (rights, idempotence, restart, cross-tenant refusal, reuse, keep after detach and end)
  - [x] RED: add `api/tests/api/session-adoption.test.ts` (attach existing, create new, reuse, keep project and history after detach and end, rights, idempotence, restart, cross-tenant refusal)
  - [ ] GREEN: add `packages/cluster-mesh/src/sessions/workspace-binding.ts` (pure binding behind narrow storage port for later L3a move)
  - [ ] GREEN: export binding from `packages/cluster-mesh/src/index.ts`
  - [ ] GREEN: bump `packages/cluster-mesh/package.json` to `0.16.0` (no publish)
  - [ ] GREEN: extend `api/src/db/control-schema.ts` with `sessionWorkspaceBindings`
  - [ ] GREEN: add `api/drizzle/control/0011_session_workspace_bindings.sql` (one migration, BR01-EX1)
  - [ ] GREEN: add `api/src/services/cluster-mesh/session-workspace.ts` (attach and create existing Sentropic workspace durably, reuse, keep after detach and end)
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`
    - [ ] `make lint-cluster-mesh API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`
    - [ ] **API tests**
      - [ ] Update `api/tests/api/session-adoption.test.ts` (new)
      - [ ] Scoped runs while evolving tests: `make test-api-unit SCOPE=tests/api/session-adoption.test.ts API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`
      - [ ] Sub-lot gate: `make test-api-unit SCOPE=tests/api/session-adoption.test.ts API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`
      - [ ] AI flaky tests run (non-blocking only under acceptance rule): `make test-api-ai ENV=test-session-ws` and document status/signature in `BRANCH.md`
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI changes in LOT1
      - [ ] Sub-lot gate: `make test-ui ENV=test-session-ws`
    - [ ] **E2E tests**
      - [ ] No E2E changes in LOT1
    - [ ] `make test-cluster-mesh SCOPE=tests/session-workspace.spec.ts API_PORT=9490 UI_PORT=5690 MAILDEV_UI_PORT=1590 ENV=test-session-ws`

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
