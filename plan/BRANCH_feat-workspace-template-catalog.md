# Feature: Workspace Template Catalog

## Objective
Deliver workspace multi-template foundations with at least ai-ideas and todo templates and template-bound defaults.

## Scope / Guardrails
- Scope limited to Template registry, workspace assignment, default toolsets/steering/profile wiring.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-workspace-template-catalog` `API_PORT=8704` `UI_PORT=5104` `MAILDEV_UI_PORT=1004`.

## Questions / Notes
- AWT-Q3: Automatic migration behavior when template changes.
- Define minimal template schema validation for W1.
- Define fallback behavior when assigned template is disabled.

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
  - [ ] Confirm isolated worktree `tmp/feat-workspace-template-catalog` and environment mapping (`ENV=feat-workspace-template-catalog`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Template Registry and Assignment**
  - [ ] Implement template catalog model and workspace assignment endpoint.
  - [ ] Seed base templates (ai-ideas, todo) with stable keys/versioning.
  - [ ] Add assignment validation and authorization checks.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make lint-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make test-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make typecheck-ui ENV=test-feat-workspace-template-catalog`
    - [ ] `make lint-ui ENV=test-feat-workspace-template-catalog`
    - [ ] `make test-ui ENV=test-feat-workspace-template-catalog`

- [ ] **Lot 2 — Runtime Projection in UI/API**
  - [ ] Project template defaults into workspace runtime configuration.
  - [ ] Expose active template and capabilities in settings/UI shell.
  - [ ] Add regression tests for switching templates without data corruption.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make lint-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make test-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make typecheck-ui ENV=test-feat-workspace-template-catalog`
    - [ ] `make lint-ui ENV=test-feat-workspace-template-catalog`
    - [ ] `make test-ui ENV=test-feat-workspace-template-catalog`

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
