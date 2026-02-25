# Feature: Release UI npm + Playwright Pretest

## Objective
Deliver automated UI npm publishing and an integrated automated debug assistant for UI with systematic CI artifacts (screens/videos/logs) and packaged exploratory scenarios, plus a developer-usable debug path during branch development.

## Scope / Guardrails
- Scope limited to CI workflows, package metadata/versioning, pretest harness and artifacts.
- W1 delivery is `v1` only (focused scope): small packaged scenario set + mandatory artifacts + blocking policy on critical failures.
- Out of scope for W1: autonomous broad crawling, full visual diff platform, or large scenario catalog redesign.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-release-ui-npm-and-pretest` `API_PORT=8707` `UI_PORT=5107` `MAILDEV_UI_PORT=1007`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.github/workflows/**`
  - `ui/**`
  - `e2e/**`
  - `scripts/**`
  - `plan/07-BRANCH_feat-release-ui-npm-and-pretest.md`
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
- REL-Q1: Final npm package names/scopes.
- REL-Q4: Minimum pretest gate required for W1.
- Define release trigger policy for prerelease vs stable.
- Confirm target size for the packaged exploratory scenario set in W1 (`3-5` critical journeys recommended).

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

## Debug and UX Validation Practices (target state in this branch)
- Provide a self-serve debug path for developers before CI publish:
  - one repeatable entrypoint for focused UI debug runs,
  - reproducible artifact bundle (logs/screenshots/videos),
  - concise UX validation checklist tied to key user journeys.
- Keep user requests minimal:
  - collect technical evidence before escalating,
  - batch product/UX questions per lot.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read relevant `.mdc` files, `README.md`, `TODO.md`, and linked specs.
  - [ ] Confirm isolated worktree `tmp/feat-release-ui-npm-and-pretest` and environment mapping (`ENV=feat-release-ui-npm-and-pretest`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — UI Package Publish Automation**
  - [ ] Implement CI job for npm publish with release-safe guards.
    - <feedback loop if required only>
      - `blocked` / `deferred` / `cancelled` / `attention`: message (requires clarification about ...)
      - `clarification` / `acknowledge` / `refuse`: explanation
  - [ ] Add package versioning and provenance checks.
  - [ ] Document rollback strategy for failed publish attempts.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make lint-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make test-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make build-api build-ui-image API_PORT=8707 UI_PORT=5107 MAILDEV_UI_PORT=1007 ENV=e2e-feat-release-ui-npm-and-pretest`
    - [ ] `make clean test-e2e API_PORT=8707 UI_PORT=5107 MAILDEV_UI_PORT=1007 ENV=e2e-feat-release-ui-npm-and-pretest`

- [ ] **Lot 1.5 — Developer Self-Serve Debug Harness**
  - [ ] Add a documented make-based entrypoint for targeted UI debug runs (local branch env, not CI-only).
  - [ ] Define a standard debug evidence bundle (`steps`, logs, screenshot/video links).
  - [ ] Add a compact UX validation checklist (critical flows) executed before escalation.
  - [ ] Lot 1.5 gate:
    - [ ] `make typecheck-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make lint-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make test-ui SCOPE=<focused-spec> ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make test-e2e E2E_SPEC=<focused-spec> API_PORT=8707 UI_PORT=5107 MAILDEV_UI_PORT=1007 ENV=e2e-feat-release-ui-npm-and-pretest`

- [ ] **Lot 2 — Playwright Pretest Agent**
  - [ ] Implement integrated automated debug assistant contract (input: scenario set, output: structured debug report + artifacts).
  - [ ] Add pretest stage executing targeted UI smoke/debug scenarios.
  - [ ] Package exploratory scenarios as reusable profiles (`critical-path`, `auth`, `workspace-core`).
  - [ ] Collect screenshots/videos/logs and attach them to CI runs.
  - [ ] Enforce release blocking on pretest critical failures.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make lint-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make test-ui ENV=test-feat-release-ui-npm-and-pretest`
    - [ ] `make build-api build-ui-image API_PORT=8707 UI_PORT=5107 MAILDEV_UI_PORT=1007 ENV=e2e-feat-release-ui-npm-and-pretest`
    - [ ] `make clean test-e2e API_PORT=8707 UI_PORT=5107 MAILDEV_UI_PORT=1007 ENV=e2e-feat-release-ui-npm-and-pretest`

- [ ] **Lot N-2** UAT
  - [ ] Web app (splitted by sublist for each env)
    - [ ] <Instruction by env before testing>
    - [ ] <Detailed evol tests>
    - [ ] <Detailed non reg tests>

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into the relevant `spec/*` files.
  - [ ] Update `PLAN.md` status and dependency notes after integration readiness.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
