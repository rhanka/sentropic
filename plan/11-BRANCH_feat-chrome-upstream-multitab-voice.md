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
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-chrome-upstream-multitab-voice` `API_PORT=8711` `UI_PORT=5111` `MAILDEV_UI_PORT=1011`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `plan/11-BRANCH_feat-chrome-upstream-multitab-voice.md`
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
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

## Questions / Notes
- CHU-Q3: Conflict resolution when multiple tabs match intent.
- CHU-Q4: Voice provider/runtime constraints for privacy and performance.
- CHU-Q5: Session timeout and forced re-approval policy.

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
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Multi-Tab Orchestration**
  - [ ] Implement tab registry and tab-scoped command targeting.
    - <feedback loop if required only>
      - `blocked` / `deferred` / `cancelled` / `attention`: message (requires clarification about ...)
      - `clarification` / `acknowledge` / `refuse`: explanation
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

- [ ] **Lot N-2** UAT
  - [ ] Web app (splitted by sublist for each env)
    - [ ] <Instruction by env before testing>
    - [ ] <Detailed evol tests>
    - [ ] <Detailed non reg tests>
  - [ ] Chrome plugin (if impacted)
    - [ ] <Instruction by env before testing>
    - [ ] <Detailed evol tests>
    - [ ] <Detailed non reg tests>

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into the relevant `spec/*` files.
  - [ ] Update `PLAN.md` status and dependency notes after integration readiness.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
