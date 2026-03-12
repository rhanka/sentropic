# Feature: BR-14 — Chat Modularization

## BR-04 dependency note
Low impact: BR-04 modifies ChatPanel/ChatWidget for workspace type context propagation, tool scope display updates, and `usecase`→`initiative` rename. Mechanical merge conflicts expected but no architectural dependency. See `spec/SPEC_EVOL_WORKSPACE_TYPES.md` §15.1.

## Objective
Decompose ChatPanel.svelte (59K) and ChatWidget.svelte (37K) into modular sub-components to enable parallel development on chat-related branches without merge conflicts.

## Scope / Guardrails
- Scope limited to UI component refactoring of ChatPanel and ChatWidget into modular sub-components (message list, tool call renderer, document panel, input bar, session manager, stream handler).
- No functional changes — pure structural refactoring.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-chat-modularization`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-chat-modularization` `API_PORT=8714` `UI_PORT=5114` `MAILDEV_UI_PORT=1014`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/**`
  - `e2e/**`
  - `plan/14-BRANCH_feat-chat-modularization.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**` (no backend changes expected)
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/**` (only if API types need to be adjusted for component contracts)
  - `.github/workflows/**`
  - `spec/**`, `PLAN.md`, `TODO.md` (docs consolidation or roadmap sync only)
  - `scripts/**` (only if strictly required by the branch objective)
- **Exception process**:
  - Declare exception ID `BR14-EXn` in this file before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

## Questions / Notes
- CM-Q1: Target component granularity — how fine-grained should the split be?
- CM-Q2: Shared state management pattern post-split (stores vs context vs props).
- CM-Q3: Impact on Chrome extension and VSCode plugin ChatWidget integration points.

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
- Rationale: Pure UI refactoring, single linear progression.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot when UI/plugin surface is impacted).
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-chat-modularization`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-chat-modularization` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read relevant `.mdc` files, `README.md`, `TODO.md`, and linked specs.
  - [ ] Confirm isolated worktree `tmp/feat-chat-modularization` and environment mapping (`ENV=feat-chat-modularization`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BR14-EXn` exceptions if needed.
  - [ ] Finalize open questions required before implementation starts.
  - [ ] Analyze ChatPanel.svelte and ChatWidget.svelte dependencies to define target component tree.

- [ ] **Lot 1 — ChatWidget decomposition**
  - [ ] Extract session lifecycle management into dedicated component/module.
  - [ ] Extract layout management (floating/docked, open/closed) into dedicated component.
  - [ ] Extract queue monitor into standalone component.
    - <feedback loop if required only>
      - `blocked` / `deferred` / `cancelled` / `attention`: message (requires clarification about ...)
      - `clarification` / `acknowledge` / `refuse`: explanation
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-ui ENV=test-feat-chat-modularization`
    - [ ] `make lint-ui ENV=test-feat-chat-modularization`
    - [ ] `make test-ui ENV=test-feat-chat-modularization`

- [ ] **Lot 2 — ChatPanel decomposition**
  - [ ] Extract message timeline renderer into standalone component.
  - [ ] Extract tool call display into standalone component.
  - [ ] Extract document upload/list panel into standalone component.
  - [ ] Extract message input bar (with Tiptap, multi-line, context menu) into standalone component.
  - [ ] Extract stream handler into standalone module.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-ui ENV=test-feat-chat-modularization`
    - [ ] `make lint-ui ENV=test-feat-chat-modularization`
    - [ ] `make test-ui ENV=test-feat-chat-modularization`
    - [ ] `make build-api build-ui-image API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=e2e-feat-chat-modularization`
    - [ ] `make clean test-e2e API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=e2e-feat-chat-modularization`

- [ ] **Lot N-2** UAT
  - [ ] Web app (splitted by sublist for each env)
    - [ ] <Instruction by env before testing>
    - [ ] <Detailed evol tests>
    - [ ] <Detailed non reg tests>
  - [ ] Chrome plugin (if impacted)
    - [ ] <Instruction by env before testing>
    - [ ] <Detailed evol tests>
    - [ ] <Detailed non reg tests>
  - [ ] VSCode plugin (if impacted)
    - [ ] <Instruction by env before testing>
    - [ ] <Detailed evol tests>
    - [ ] <Detailed non reg tests>

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into the relevant `spec/*` files.
  - [ ] Update `PLAN.md` status and dependency notes after integration readiness.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
