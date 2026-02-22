# Feature: Release UI npm + Playwright Pretest

## Objective
Deliver automated UI npm publishing and a Playwright pretest/debug stage in CI to catch UI regressions before release.

## Scope / Guardrails
- Scope limited to CI workflows, package metadata/versioning, pretest harness and artifacts.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-release-ui-npm-and-pretest` `API_PORT=8707` `UI_PORT=5107` `MAILDEV_UI_PORT=1007`.

## Questions / Notes
- REL-Q1: Final npm package names/scopes.
- REL-Q4: Minimum pretest gate required for W1.
- Define release trigger policy for prerelease vs stable.

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
  - [ ] Confirm isolated worktree `tmp/feat-release-ui-npm-and-pretest` and environment mapping (`ENV=feat-release-ui-npm-and-pretest`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — UI Package Publish Automation**
  - [ ] Implement CI job for npm publish with release-safe guards.
  - [ ] Add package versioning and provenance checks.
  - [ ] Document rollback strategy for failed publish attempts.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make lint-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make test-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make build-api build-ui-image API_PORT=8707 UI_PORT=5107 MAILDEV_UI_PORT=1007 ENV=e2e-feat-release-ui-npm-and-pretest`
    - [ ] `make clean test-e2e API_PORT=8707 UI_PORT=5107 MAILDEV_UI_PORT=1007 ENV=e2e-feat-release-ui-npm-and-pretest`

- [ ] **Lot 2 — Playwright Pretest Agent**
  - [ ] Add pretest stage executing targeted UI smoke/debug scenarios.
  - [ ] Collect screenshots/videos/logs and attach them to CI runs.
  - [ ] Enforce release blocking on pretest critical failures.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make lint-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make test-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make build-api build-ui-image API_PORT=8707 UI_PORT=5107 MAILDEV_UI_PORT=1007 ENV=e2e-feat-release-ui-npm-and-pretest`
    - [ ] `make clean test-e2e API_PORT=8707 UI_PORT=5107 MAILDEV_UI_PORT=1007 ENV=e2e-feat-release-ui-npm-and-pretest`

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
