# Feature: Chrome Upstream Multi-Tab + Voice

## Objective
Extend Chrome upstream control to multi-tab orchestration and voice commands with explicit permission and consent safeguards.

## Scope / Guardrails
- Scope limited to Tab registry, tab-scoped orchestration, voice capture/transcription/intent pipeline.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-chrome-upstream-multitab-voice` `API_PORT=8711` `UI_PORT=5111` `MAILDEV_UI_PORT=1011`.

## Questions / Notes
- CHU-Q3: Conflict resolution when multiple tabs match intent.
- CHU-Q4: Voice provider/runtime constraints for privacy and performance.
- CHU-Q5: Session timeout and forced re-approval policy.

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
  - [ ] Confirm isolated worktree `tmp/feat-chrome-upstream-multitab-voice` and environment mapping (`ENV=feat-chrome-upstream-multitab-voice`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Multi-Tab Orchestration**
  - [ ] Implement tab registry and tab-scoped command targeting.
  - [ ] Implement arbitration rules for active/background tab control.
  - [ ] Add rollback-safe checkpoint markers for multi-tab command chains.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make lint-api ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make test-api ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make typecheck-ui ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make lint-ui ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make test-ui ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make build-api build-ui-image API_PORT=8711 UI_PORT=5111 MAILDEV_UI_PORT=1011 ENV=e2e-feat-chrome-upstream-multitab-voice`
    - [ ] `make clean test-e2e API_PORT=8711 UI_PORT=5111 MAILDEV_UI_PORT=1011 ENV=e2e-feat-chrome-upstream-multitab-voice`

- [ ] **Lot 2 — Voice Control Integration**
  - [ ] Implement voice capture and transcription bridge in extension runtime.
  - [ ] Map voice intents to safe tool actions with explicit confirmation gates.
  - [ ] Add integration tests and UAT cases for voice + multi-tab flows.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make lint-api ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make test-api ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make typecheck-ui ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make lint-ui ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make test-ui ENV=test-feat-chrome-upstream-multitab-voice`
    - [ ] `make build-api build-ui-image API_PORT=8711 UI_PORT=5111 MAILDEV_UI_PORT=1011 ENV=e2e-feat-chrome-upstream-multitab-voice`
    - [ ] `make clean test-e2e API_PORT=8711 UI_PORT=5111 MAILDEV_UI_PORT=1011 ENV=e2e-feat-chrome-upstream-multitab-voice`

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
