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
  - Declare exception ID `BRxx-EXn` in `## Questions / Notes` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in `plan/CONDUCTOR_QUESTIONS.md`.

## Questions / Notes
- <Open questions that affect scope or sequencing.>

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
  - [ ] <Task 2>
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>`>
    - [ ] **API tests**
      - [ ] <Exhaustive list of API test updates (file-by-file, existing + new)>
      - [ ] <Evolve or add API tests (e.g., update `api/tests/api/organizations.spec.ts` or add `api/tests/api/new-feature.spec.ts`)>
      - [ ] <Scoped runs while evolving tests: `make test-api-<suite> SCOPE=tests/your-file.spec.ts ENV=test-<branch-slug>`>
      - [ ] Sub-lot gate: `make test-api ENV=test-<branch-slug>`
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
  - [ ] Final gate: Créate PR with BRANCH.md content as initial message & Verify CI for the branch
  - [ ] Final commit removes `BRANCH.md` and checks `TODO.md`
