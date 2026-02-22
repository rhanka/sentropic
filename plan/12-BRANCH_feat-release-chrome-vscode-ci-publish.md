# Feature: Release Chrome + VSCode CI Publish

## Objective
Deliver automated CI publishing for Chrome and VSCode plugins with release gating and artifact traceability.

## Scope / Guardrails
- Scope limited to CI workflows, plugin package generation/signing, release policy and approvals.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-release-chrome-vscode-ci-publish` `API_PORT=8712` `UI_PORT=5112` `MAILDEV_UI_PORT=1012`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.github/workflows/**`
  - `ui/**`
  - `e2e/**`
  - `scripts/**`
  - `plan/12-BRANCH_feat-release-chrome-vscode-ci-publish.md`
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
- REL-Q2: Tag-only release policy vs branch prerelease model.
- REL-Q3: Mandatory signing/provenance constraints.
- REL-Q5: Retention policy for release and pretest artifacts.

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
  - [ ] Confirm isolated worktree `tmp/feat-release-chrome-vscode-ci-publish` and environment mapping (`ENV=feat-release-chrome-vscode-ci-publish`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Plugin Packaging and Release Workflows**
  - [ ] Implement CI packaging for Chrome plugin and VSCode extension.
  - [ ] Implement publish jobs with explicit release gates and approvals.
  - [ ] Add secrets validation and fail-fast checks for publish credentials.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-ui ENV=test-feat-release-chrome-vscode-ci-publish`
    - [ ] `make lint-ui ENV=test-feat-release-chrome-vscode-ci-publish`
    - [ ] `make test-ui ENV=test-feat-release-chrome-vscode-ci-publish`
    - [ ] `make build-api build-ui-image API_PORT=8712 UI_PORT=5112 MAILDEV_UI_PORT=1012 ENV=e2e-feat-release-chrome-vscode-ci-publish`
    - [ ] `make clean test-e2e API_PORT=8712 UI_PORT=5112 MAILDEV_UI_PORT=1012 ENV=e2e-feat-release-chrome-vscode-ci-publish`

- [ ] **Lot 2 — Cross-Artifact Release Validation**
  - [ ] Add release orchestration ensuring compatible versions across UI/chrome/vscode artifacts.
  - [ ] Attach release metadata and provenance artifacts to each run.
  - [ ] Add final end-to-end dry-run workflow for reproducibility checks.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-ui ENV=test-feat-release-chrome-vscode-ci-publish`
    - [ ] `make lint-ui ENV=test-feat-release-chrome-vscode-ci-publish`
    - [ ] `make test-ui ENV=test-feat-release-chrome-vscode-ci-publish`
    - [ ] `make build-api build-ui-image API_PORT=8712 UI_PORT=5112 MAILDEV_UI_PORT=1012 ENV=e2e-feat-release-chrome-vscode-ci-publish`
    - [ ] `make clean test-e2e API_PORT=8712 UI_PORT=5112 MAILDEV_UI_PORT=1012 ENV=e2e-feat-release-chrome-vscode-ci-publish`

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
