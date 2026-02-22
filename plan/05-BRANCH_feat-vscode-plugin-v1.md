# Feature: VSCode Plugin v1

## Objective
Deliver VSCode plugin v1 based on shared ChatWidget/chat core with plan/tools/summary/checkpoint and API-driven orchestration.

## Scope / Guardrails
- Scope limited to VSCode extension shell, webview integration, local tools bridge, API orchestration bridge.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-vscode-plugin-v1` `API_PORT=8705` `UI_PORT=5105` `MAILDEV_UI_PORT=1005`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `scripts/**`
  - `plan/05-BRANCH_feat-vscode-plugin-v1.md`
  - `plan/DEBUG_TICKETS.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `spec/**`, `PLAN.md`, `TODO.md` (docs consolidation or roadmap sync only)
  - `scripts/**` (only if strictly required by the branch objective)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in this file before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.
  - Mirror exception in `plan/CONDUCTOR_QUESTIONS.md`.

## Questions / Notes
- VSC-Q2: Allowed shell command set for v1 local tools.
- VSC-Q3: Checkpoint model (git-only or mixed with domain snapshots).
- Confirm package naming for release alignment with CI flows.

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
  - [ ] Confirm isolated worktree `tmp/feat-vscode-plugin-v1` and environment mapping (`ENV=feat-vscode-plugin-v1`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Plugin Host and Shared Chat Core**
  - [ ] Bootstrap VSCode extension and webview with shared ChatWidget/chat core adapters.
  - [ ] Implement auth/session bridge and API orchestration connection.
  - [ ] Add plan/summary/checkpoint baseline views.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-vscode-plugin-v1`
    - [ ] `make lint-api ENV=test-feat-vscode-plugin-v1`
    - [ ] `make test-api ENV=test-feat-vscode-plugin-v1`
    - [ ] `make typecheck-ui ENV=test-feat-vscode-plugin-v1`
    - [ ] `make lint-ui ENV=test-feat-vscode-plugin-v1`
    - [ ] `make test-ui ENV=test-feat-vscode-plugin-v1`
    - [ ] `make build-api build-ui-image API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-vscode-plugin-v1`
    - [ ] `make clean test-e2e API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-vscode-plugin-v1`

- [ ] **Lot 2 — Local Tools + UX Hardening**
  - [ ] Implement local tools bridge (read/search/safe shell/checkpoint commands).
  - [ ] Attach local tool outputs to API orchestration resumption endpoints.
  - [ ] Add non-regression tests and UX hardening for plan progression.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-vscode-plugin-v1`
    - [ ] `make lint-api ENV=test-feat-vscode-plugin-v1`
    - [ ] `make test-api ENV=test-feat-vscode-plugin-v1`
    - [ ] `make typecheck-ui ENV=test-feat-vscode-plugin-v1`
    - [ ] `make lint-ui ENV=test-feat-vscode-plugin-v1`
    - [ ] `make test-ui ENV=test-feat-vscode-plugin-v1`
    - [ ] `make build-api build-ui-image API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-vscode-plugin-v1`
    - [ ] `make clean test-e2e API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-vscode-plugin-v1`

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
