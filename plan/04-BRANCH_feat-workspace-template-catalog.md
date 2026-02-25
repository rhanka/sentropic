# Feature: Workspace Template Catalog

## Objective
Launch BR-04 from a clean baseline and deliver a template-centric design + runtime foundation for `ai-ideas` and `todo`, with explicit separation between TODO domains, workflow stages, and agent steering semantics.

## Scope / Guardrails
- Scope limited to template registry, workspace template assignment, template runtime metadata projection, and design alignment with TODO roadmap semantics.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-workspace-template-catalog` `API_PORT=8704` `UI_PORT=5104` `MAILDEV_UI_PORT=1004`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `plan/04-BRANCH_feat-workspace-template-catalog.md`
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
- `BR04-EX1` (approved): update `PLAN.md` and `TODO.md` to reflect BR-03 rollback and BR-04 Wave 2 kickoff.
  - Reason: roadmap sync required after explicit product recadrage.
  - Impact: documentation and branch orchestration only, no runtime behavior change.
  - Rollback: revert BR-04 roadmap sync entries in `PLAN.md` and `TODO.md`.
- BR04-D1 (to freeze): `steer` means in-flight guidance message to an active agent run, not governance/approval mode.
- BR04-D2 (to freeze): split TODO semantics into `todo_tool` (assistant-executable) and `todo_user` (conductor/user-managed tasks).
- BR04-D3 (to freeze): workflow semantics are stage-based agent orchestration (ideas -> deep-dive -> synthesis/matrix), not settings-panel task CRUD.
- AWT-Q3: migration semantics when a workspace template changes while artifacts already exist.
- AWT-Q4: fallback semantics when assigned template is disabled or unavailable.
- Reset note (2026-02-25): BR-03 (`feat/todo-steering-workflow-core`, `uat/br03-local`) was reset to `origin/main` for clean restart.

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
- Rationale: BR-04 starts with design-first alignment and a narrow implementation foundation.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot when UI/plugin surface is impacted).
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline, reset, and Wave 2 kickoff**
  - [x] Confirm isolated worktree `tmp/feat-workspace-template-catalog` and env mapping (`ENV=feat-workspace-template-catalog`, ports 8704/5104/1004).
  - [x] Reset BR-03 working branches to clean baseline (`origin/main`) after product recadrage.
  - [x] Initialize BR-04 branches from `origin/main` (`feat/workspace-template-catalog`, `uat/br04-local`).
  - [x] Refactor active branch plan to design-first BR-04 sequence.
  - [ ] Freeze open semantic decisions (BR04-D1/D2/D3, AWT-Q3/Q4) with conductor before implementation.

- [ ] **Lot 1 — Domain design contract (authoritative)**
  - [ ] Define canonical glossary and invariants:
    - <feedback loop if required only>
      - `blocked` / `deferred` / `cancelled` / `attention`: message (requires clarification about ...)
      - `clarification` / `acknowledge` / `refuse`: explanation
    - `steer_message` = in-flight user guidance to an active run.
    - `governance_policy` = optional control/approval policy (separate concept).
    - `todo_tool` = assistant/tool runnable task unit.
    - `todo_user` = user/conductor task unit.
    - `workflow_template` = stage graph (`objects + agents + tools + transitions`).
  - [ ] Map current `ai-ideas` runtime to workflow stages:
    - stage 1: list opportunities/use cases.
    - stage 2: deepen/evaluate selected use cases.
    - stage 3: produce synthesis + prioritization matrix.
  - [ ] Define BR-04 inclusion/exclusion boundaries:
    - include template catalog + workspace assignment + runtime metadata projection.
    - exclude settings-level workflow control panel.
    - exclude full workflow execution engine and TODO runtime CRUD.
  - [ ] Publish design decisions in roadmap/spec docs (`PLAN.md`, `TODO.md`, and targeted `spec/**` if needed).
  - [ ] Lot 1 gate:
    - [ ] Design review sign-off captured in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).
    - [ ] `make typecheck-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make lint-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make typecheck-ui ENV=test-feat-workspace-template-catalog`
    - [ ] `make lint-ui ENV=test-feat-workspace-template-catalog`

- [ ] **Lot 2 — Template registry and assignment foundation**
  - [ ] Implement template registry model (stable keys/versions for `ai-ideas`, `todo`).
  - [ ] Implement workspace template assignment API with RBAC and validation.
  - [ ] Expose active template + capabilities/runtime metadata endpoint.
  - [ ] Add minimal UI exposure of active workspace template (outside workflow settings control UX).
  - [ ] Add API/UI tests for assignment, projection, and fallback behavior.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make lint-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make test-api ENV=test-feat-workspace-template-catalog`
    - [ ] `make typecheck-ui ENV=test-feat-workspace-template-catalog`
    - [ ] `make lint-ui ENV=test-feat-workspace-template-catalog`
    - [ ] `make test-ui ENV=test-feat-workspace-template-catalog`

- [ ] **Lot N-2 — UAT**
  - [ ] UAT-01 Workspace template visibility: verify active template and capabilities are visible on the expected UI surface.
  - [ ] UAT-02 Assignment flow: switch workspace template and confirm persistence after reload.
  - [ ] UAT-03 Non-regression: verify core `ai-ideas` flows remain functional after template metadata projection.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into the relevant `spec/*` files.
  - [ ] Update `PLAN.md` status/dependencies and `TODO.md` roadmap semantics.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
