# Feature: <Title>

## Objective
<One or two sentences describing the goal.>

## Scope / Guardrails
- Scope limited to <areas>.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `<path-or-glob-1>`
  - `<path-or-glob-2>`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `<other-sensitive-paths>`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: <Why this mode is selected>

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
  - [ ] Read the relevant `.mdc` files and `README.md`.
  - [ ] Create/confirm isolated worktree `tmp/feat-<slug>` and run development there.
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Define environment mapping (`dev`, `test`, `e2e`) and ports for this branch.
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Confirm scope and guardrails.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [ ] If the branch is complex, add `spec/BRANCH_SPEC_EVOL.md` (initial draft).

- [ ] **Lot 1 — <Main change>**
  - [ ] <Task 1>
    - <feedback loop if required only>
      - `blocked` / `deferred` / `cancelled` / `attention`: message (requires clarification about ...)
      - `clarification` / `acknowledge` / `refuse`: explanation
  - [ ] <Task 2>
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>`>
    - [ ] **API tests**
      - [ ] <Exhaustive list of API test updates (file-by-file, existing + new)>
      - [ ] <Evolve or add API tests (e.g., update `api/tests/api/organizations.spec.ts` or add `api/tests/api/new-feature.spec.ts`)>
      - [ ] <Scoped runs while evolving tests: `make test-api-<suite> SCOPE=tests/your-file.spec.ts ENV=test-<branch-slug>`>
      - [ ] Sub-lot gate: `make test-api ENV=test-<branch-slug>`
      - [ ] AI flaky tests run (non-blocking only under acceptance rule): `make test-api-ai ENV=test-<branch-slug>` and document status/signature in `BRANCH.md`
    - [ ] **UI tests (TypeScript only)**
      - [ ] <Exhaustive list of UI TS test updates (file-by-file, existing + new)>
      - [ ] <Evolve or add UI TS tests (e.g., update `ui/tests/stores/organizations.spec.ts` or add `ui/tests/utils/new-feature.spec.ts`)>
      - [ ] <Scoped runs while evolving tests: `make test-ui SCOPE=tests/your-file.spec.ts ENV=test`>
      - [ ] Sub-lot gate: `make test-ui ENV=test`
    - [ ] **E2E tests**
      - [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e-<branch-slug>`
      - [ ] <Exhaustive list of E2E test updates (file-by-file, existing + new)>
      - [ ] <Evolve or add E2E tests (e.g., update `e2e/tests/05-organizations.spec.ts` or add `e2e/tests/10-new-feature.spec.ts`)>
      - [ ] <Scoped runs while evolving tests: `make test-e2e E2E_SPEC=tests/your-file.spec.ts API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e`>
      - [ ] Sub-lot gate: `make clean test-e2e API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e-<branch-slug> E2E_GROUP=<matrix.e2e_group>` (pour matrix.e2_group = 00 01 02, 03 04 05, 06 06, cf .github/workflows/ci.yml for exact ref of split)
      - [ ] AI flaky tests run (non-blocking only under acceptance rule): scoped `E2E_SPEC` runs for AI specs and document status/signature in `BRANCH.md`
    - [ ] non mandatory UAT if required user interaction strictly required before Lot 2, splitted by sublist for each env
      - [ ] <Instruction by env (chrome plugin, vscode, ...) brefore testing>
      - [ ] <Detailed évol tests>
      - [ ] <Detailed non reg tests>

- [ ] **Lot 2 — <Next change>**
  - [ ] <Task 1>
  - [ ] <Task 2>
  - [ ] <Lot gate: copy exact checklist of Lot 1, no UAT if last branch>

- [ ] **Lot N-2** UAT
  - [ ] Web app (splitted by sublist for each env)
    - [ ] <Instruction by env (chrome plugin, vscode, ...) brefore testing>
    - [ ] <Detailed évol tests>
    - [ ] <Detailed non reg tests>
  - [ ] Chrome plugin (if imacted)
    ....
  - [ ] VScode plugin (if impacted)
    ....

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Refactor and integrate `spec/BRANCH_SPEC_EVOL.md` into existing specs (if not a new standalone spec).
  - [ ] Delete `spec/BRANCH_SPEC_EVOL.md` after integration.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
