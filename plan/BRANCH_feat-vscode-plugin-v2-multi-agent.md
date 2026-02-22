# Feature: VSCode Plugin v2 Multi-Agent

## Objective
Deliver VSCode plugin v2 with multi-agent and multi-model orchestration while reusing shared chat core and API orchestration source of truth.

## Scope / Guardrails
- Scope limited to VSCode plugin orchestration UX, agent lanes, model assignment, execution trace.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-vscode-plugin-v2-multi-agent` `API_PORT=8710` `UI_PORT=5110` `MAILDEV_UI_PORT=1010`.

## Questions / Notes
- VSC-Q4: Multi-agent conflict resolution UX model.
- VSC-Q5: Telemetry opt-in boundaries for plugin analytics.
- Define minimum merge/checkpoint policies between agent lanes.

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
  - [ ] Confirm isolated worktree `tmp/feat-vscode-plugin-v2-multi-agent` and environment mapping (`ENV=feat-vscode-plugin-v2-multi-agent`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Multi-Agent Lanes**
  - [ ] Add multi-agent task lanes and assignment model in plugin UI.
  - [ ] Implement orchestration commands for parallel agent execution.
  - [ ] Track lane state and merge checkpoints with explicit audit metadata.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make lint-api ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make test-api ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make typecheck-ui ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make lint-ui ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make test-ui ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make build-api build-ui-image API_PORT=8710 UI_PORT=5110 MAILDEV_UI_PORT=1010 ENV=e2e-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make clean test-e2e API_PORT=8710 UI_PORT=5110 MAILDEV_UI_PORT=1010 ENV=e2e-feat-vscode-plugin-v2-multi-agent`

- [ ] **Lot 2 — Multi-Model Assignment + Trace**
  - [ ] Enable per-agent/per-task model selection from runtime catalog.
  - [ ] Implement execution trace panel for decisions and changes.
  - [ ] Add regression tests for multi-agent + multi-model scenarios.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make lint-api ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make test-api ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make typecheck-ui ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make lint-ui ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make test-ui ENV=test-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make build-api build-ui-image API_PORT=8710 UI_PORT=5110 MAILDEV_UI_PORT=1010 ENV=e2e-feat-vscode-plugin-v2-multi-agent`
    - [ ] `make clean test-e2e API_PORT=8710 UI_PORT=5110 MAILDEV_UI_PORT=1010 ENV=e2e-feat-vscode-plugin-v2-multi-agent`

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
