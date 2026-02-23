# Feature: Chrome Plugin Download Distribution

## Objective
Deliver a fast distribution path for the Chrome plugin: package artifact generation and in-app download access from `/settings`, with an instance-configured download URL.

## Scope / Guardrails
- Scope limited to plugin packaging flow, download metadata exposure, and settings UI integration.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-chrome-plugin-download-distribution` `API_PORT=8713` `UI_PORT=5113` `MAILDEV_UI_PORT=1013`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `scripts/**`
  - `plan/13-BRANCH_feat-chrome-plugin-download-distribution.md`
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
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in this file before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.
  - Mirror exception in `plan/CONDUCTOR_QUESTIONS.md`.

## Questions / Notes
- Distribution default for fast delivery: unsigned zip artifact for developer side-load.
- URL source of truth: server-side config (instance-level), exposed via API to the settings page.
- Signed CRX and store publication remain out of this branch (handled later by release branch).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: This branch is a focused delivery slice and should stay independently mergeable.

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
  - [ ] Confirm isolated worktree `tmp/feat-chrome-plugin-download-distribution` and environment mapping (`ENV=feat-chrome-plugin-download-distribution`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Packaging + Download Metadata API**
  - [ ] Add/align packaging flow for a downloadable Chrome plugin artifact (zip) with versioned output.
  - [ ] Expose API metadata endpoint for latest artifact (`version`, `downloadUrl`, optional `sha256`).
  - [ ] Add guardrails for missing/invalid download base URL configuration.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make lint-api ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make test-api ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make typecheck-ui ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make lint-ui ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make test-ui ENV=test-feat-chrome-plugin-download-distribution`

- [ ] **Lot 2 — Settings UI Download Integration**
  - [ ] Add a settings section with plugin version + download CTA.
  - [ ] Use metadata API to build instance-aware URL dynamically in UI.
  - [ ] Add/update E2E coverage for settings download flow and error states.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make lint-api ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make test-api ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make typecheck-ui ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make lint-ui ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make test-ui ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make build-api build-ui-image API_PORT=8713 UI_PORT=5113 MAILDEV_UI_PORT=1013 ENV=e2e-feat-chrome-plugin-download-distribution`
    - [ ] `make clean test-e2e API_PORT=8713 UI_PORT=5113 MAILDEV_UI_PORT=1013 ENV=e2e-feat-chrome-plugin-download-distribution`

- [ ] **Lot N-2 — UAT**
  - [ ] Verify end-user path: open settings and download plugin artifact from configured instance URL.
  - [ ] Verify fallback/error message when metadata endpoint is unavailable.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into the relevant `spec/*` files.
  - [ ] Update `PLAN.md` status and dependency notes after integration readiness.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
  - [ ] Ensure branch remains orthogonal, mergeable, and non-blocking.
