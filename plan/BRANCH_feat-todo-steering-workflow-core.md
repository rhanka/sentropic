# Feature: TODO + Steering + Workflow Core

## Objective
Deliver core entities and runtime for TODO plans, steering modes, and workflow orchestration foundations for human-in-the-loop execution.

## Scope / Guardrails
- Scope limited to Data model, API routes, core UI panels, steering state machine, execution trace anchors.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-todo-steering-workflow-core` `API_PORT=8703` `UI_PORT=5103` `MAILDEV_UI_PORT=1003`.

## Questions / Notes
- AWT-Q1: Minimum status taxonomy for W1.
- AWT-Q2: Critical actions list that must enforce human approval.
- AWT-Q5: Steering ownership (workspace admin only vs per-user session).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: This branch is scoped to one capability and remains independently mergeable.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot when UI/plugin surface is impacted).
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read relevant `.mdc` files, `README.md`, `TODO.md`, and linked specs.
  - [ ] Confirm isolated worktree `tmp/feat-todo-steering-workflow-core` and environment mapping (`ENV=feat-todo-steering-workflow-core`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Core Domain and API**
  - [ ] Add core entities (plans, steps, checkpoints, steering events).
  - [ ] Implement API CRUD for plan/steps/checkpoints and steering mode updates.
  - [ ] Implement trace links from steps to tool executions.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-todo-steering-workflow-core`
    - [ ] `make lint-api ENV=test-feat-todo-steering-workflow-core`
    - [ ] `make test-api ENV=test-feat-todo-steering-workflow-core`
    - [ ] `make typecheck-ui ENV=test-feat-todo-steering-workflow-core`
    - [ ] `make lint-ui ENV=test-feat-todo-steering-workflow-core`
    - [ ] `make test-ui ENV=test-feat-todo-steering-workflow-core`

- [ ] **Lot 2 — Core UI + Execution Flow**
  - [ ] Add plan and steering panels with actionable statuses.
  - [ ] Implement execution flow respecting steering mode and approvals.
  - [ ] Add baseline integration tests across API + UI behavior.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-todo-steering-workflow-core`
    - [ ] `make lint-api ENV=test-feat-todo-steering-workflow-core`
    - [ ] `make test-api ENV=test-feat-todo-steering-workflow-core`
    - [ ] `make typecheck-ui ENV=test-feat-todo-steering-workflow-core`
    - [ ] `make lint-ui ENV=test-feat-todo-steering-workflow-core`
    - [ ] `make test-ui ENV=test-feat-todo-steering-workflow-core`

- [ ] **Lot N-2 — UAT**
  - [ ] Run targeted UAT scenarios for impacted capabilities.
  - [ ] Run non-regression checks on adjacent workflows.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into the relevant `spec/*` files.
  - [ ] Update `PLAN.md` status and dependency notes after integration readiness.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
  - [ ] Ensure branch remains orthogonal, mergeable, and non-blocking.
