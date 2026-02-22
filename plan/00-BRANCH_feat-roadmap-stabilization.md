# Feature: Roadmap Stabilization

## Objective
Stabilize the roadmap baseline by completing post-merge integration between chrome-plugin and minor-evols-ui branches and closing the temporary minimatch security exception lifecycle with an actionable mitigation plan.

## Scope / Guardrails
- Scope limited to integration conflict resolution, non-regression validation, and security exception lifecycle documentation/alignment.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-roadmap-stabilization` `API_PORT=8700` `UI_PORT=5100` `MAILDEV_UI_PORT=1000`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `.security/vulnerability-register.yaml`
  - `plan/00-BRANCH_feat-roadmap-stabilization.md`
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
- Confirm the canonical source for each of the 8 conflicted files before replaying deltas.
- Confirm if minimatch remediation can be delivered in this branch or only planned with fixed target date.
- Confirm CI/UAT scope required for extension + web app parity sign-off.
- Lot 0 scoping (2026-02-22): `tmp/feat-roadmap-stabilization` is not present yet; create it before Lot 1.
- W1 launch blocker (from `PLAN.md` QL-1): unresolved `MPA-Q1`, `MPA-Q2`, `MPA-Q3`, `AWT-Q1`, `AWT-Q2`, `AWT-Q5`.
- Security risk window: minimatch exception `CVE-2026-26996_api_minimatch_10.1.2` is still `accepted_temporary` with `review_due: 2026-02-26`; owner/branch/date for closure is still open.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: This branch is a prerequisite stabilization branch and should deliver one integrated baseline.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot when UI/plugin surface is impacted).
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Temporary Debug Baseline (before BR-07 delivery)
- Goal: reduce developer/user interruptions for UI debug and UX validation until the dedicated Playwright debug agent is shipped.
- Mandatory loop for each UI bug:
  1. Reproduce in branch environment and capture evidence (`steps`, `expected`, `actual`, screenshot/log extract).
  2. Run targeted checks first (`typecheck`, `lint`, focused `test-ui`, focused `test-e2e` when needed).
  3. Apply fix and re-run the same focused checks.
  4. Update branch notes with root cause and non-regression scope.
- Escalation policy:
  - Do not ask the user for routine debug steps already covered by evidence.
  - Ask only for product/UX decisions, missing credentials, or contradictory specs.
  - Batch questions once per lot using question IDs.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read relevant `.mdc` files, `README.md`, `TODO.md`, and linked specs.
  - [ ] Confirm isolated worktree `tmp/feat-roadmap-stabilization` and environment mapping (`ENV=feat-roadmap-stabilization`).
  - [x] Capture Make targets needed for debug/testing and CI parity.
  - [x] Confirm scope and dependency boundaries with BR-01/BR-02/BR-03 wave kickoff.
  - [ ] Confirm temporary debug baseline and escalation policy for pre-BR-07 work.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [ ] Finalize open questions required before implementation starts.

- [ ] **Lot 1 — Post-merge integration recovery**
  - [ ] Resolve the 8 conflicted files preserving extension runtime parity from `main` while replaying minor evolutions.
  - [ ] Validate extension and web app runtime behavior parity after conflict resolution.
  - [ ] Document final conflict decisions in branch notes.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-roadmap-stabilization`
    - [ ] `make lint-api ENV=test-feat-roadmap-stabilization`
    - [ ] `make test-api ENV=test-feat-roadmap-stabilization`
    - [ ] `make typecheck-ui ENV=test-feat-roadmap-stabilization`
    - [ ] `make lint-ui ENV=test-feat-roadmap-stabilization`
    - [ ] `make test-ui ENV=test-feat-roadmap-stabilization`
    - [ ] `make build-api build-ui-image API_PORT=8700 UI_PORT=5100 MAILDEV_UI_PORT=1000 ENV=e2e-feat-roadmap-stabilization`
    - [ ] `make clean test-e2e API_PORT=8700 UI_PORT=5100 MAILDEV_UI_PORT=1000 ENV=e2e-feat-roadmap-stabilization`

- [ ] **Lot 2 — Security exception lifecycle alignment**
  - [ ] Validate minimatch CVE temporary exception record in `.security/vulnerability-register.yaml`.
  - [ ] Add or refine remediation task with target branch/timebox and verification gate.
  - [ ] Define exception removal criteria after container security validation.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-roadmap-stabilization`
    - [ ] `make lint-api ENV=test-feat-roadmap-stabilization`
    - [ ] `make test-api ENV=test-feat-roadmap-stabilization`
    - [ ] `make typecheck-ui ENV=test-feat-roadmap-stabilization`
    - [ ] `make lint-ui ENV=test-feat-roadmap-stabilization`
    - [ ] `make test-ui ENV=test-feat-roadmap-stabilization`
    - [ ] `make build-api build-ui-image API_PORT=8700 UI_PORT=5100 MAILDEV_UI_PORT=1000 ENV=e2e-feat-roadmap-stabilization`
    - [ ] `make clean test-e2e API_PORT=8700 UI_PORT=5100 MAILDEV_UI_PORT=1000 ENV=e2e-feat-roadmap-stabilization`

- [ ] **Lot N-2 — UAT**
  - [ ] Run web app and extension UAT non-regression scenarios.
  - [ ] Confirm the branch is stable enough to unblock W1 wave branches.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into relevant `spec/*` and `TODO.md` entries.
  - [ ] Update `PLAN.md` execution notes for branch completion.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e).
  - [ ] Verify CI status and attach executed command list in PR notes.
  - [ ] Ensure branch remains orthogonal, mergeable, and non-blocking.
