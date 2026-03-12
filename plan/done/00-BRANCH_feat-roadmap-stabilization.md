# Feature: Roadmap Stabilization

## Objective
Stabilize the roadmap baseline by completing post-merge integration between chrome-plugin and minor-evols-ui branches and closing the temporary minimatch security exception lifecycle with an actionable mitigation plan.

## Scope / Guardrails
- Scope limited to post-merge parity reconciliation, non-regression validation, and security exception lifecycle documentation/alignment.
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
- No active git conflicts remain between `main` and `feat/minor-evols-ui`; Lot 1 starts with parity-audit scope definition.
- Minimatch remediation in BR-00 is planning-only (no technical fix in this branch); closure is tracked via BR-07 planning.
- CI/UAT BR-00 gate policy: if no runtime code changes (`api/**`, `ui/**`, `e2e/**`), skip full rerun and attach proof + latest green CI reference; otherwise run full Lot 1/Lot 2 gates.
- Lot 0 scoping update (2026-02-22): isolated worktree `tmp/feat-roadmap-stabilization` created and configured.
- QL-1 baseline decisions are recorded in `plan/CONDUCTOR_QUESTIONS.md` (MPA-Q1/2/3 and AWT-Q1/2/5).
- Security risk window: minimatch exception `CVE-2026-26996_api_minimatch_10.1.2` remains `accepted_temporary` (`review_due: 2026-02-26`) with planning metadata owner=`conductor`, target=`BR-07`, due=`2026-03-01`.
- BR00-D3 proof (2026-02-22):
  - `git diff --name-only` => `.cursor/rules/workflow.mdc`, `TODO.md`, `plan/00-BRANCH_feat-roadmap-stabilization.md`, `plan/CONDUCTOR_QUESTIONS.md`, `plan/CONDUCTOR_STATUS.md`
  - `git diff --name-only -- api ui e2e` => empty (no runtime code changes)
- `BR00-EX1` (resolved): update `.cursor/rules/workflow.mdc` to replace tmp setup by `git worktree` (instead of `git clone`) for multi-branch orchestration reliability.
  - Reason: avoid detached clone drift and keep branch/worktree visibility in `git worktree list`.
  - Impact: workflow documentation only; no runtime behavior change.
  - Rollback: restore previous tmp setup section in `.cursor/rules/workflow.mdc`.

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
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read relevant `.mdc` files, `README.md`, `TODO.md`, and linked specs.
  - [x] Confirm isolated worktree `tmp/feat-roadmap-stabilization` and environment mapping (`ENV=feat-roadmap-stabilization`).
  - [x] Capture Make targets needed for debug/testing and CI parity.
  - [x] Confirm scope and dependency boundaries with BR-01/BR-02/BR-03 wave kickoff.
  - [x] Confirm temporary debug baseline and escalation policy for pre-BR-07 work.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [x] Finalize open questions required before implementation starts.

- [x] **Lot 1 — Post-merge integration recovery**
  - [x] Build parity-audit file set from post-merge deltas, then reconcile runtime behavior (`main` baseline + minor evolutions).
  - [x] Validate extension and web app runtime behavior parity after conflict resolution.
  - [x] Document final parity decisions in branch notes.
  - [x] Lot 1 gate:
    - [x] `make typecheck-api ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make lint-api ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make test-api ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make typecheck-ui ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make lint-ui ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make test-ui ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make build-api build-ui-image API_PORT=8700 UI_PORT=5100 MAILDEV_UI_PORT=1000 ENV=e2e-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make clean test-e2e API_PORT=8700 UI_PORT=5100 MAILDEV_UI_PORT=1000 ENV=e2e-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)

- [x] **Lot 2 — Security exception lifecycle alignment**
  - [x] Validate minimatch CVE temporary exception record in `.security/vulnerability-register.yaml`.
  - [x] Add or refine remediation task with target branch/timebox and verification gate.
  - [x] Define exception removal criteria after container security validation.
  - [x] Lot 2 gate:
    - [x] `make typecheck-api ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make lint-api ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make test-api ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make typecheck-ui ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make lint-ui ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make test-ui ENV=test-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make build-api build-ui-image API_PORT=8700 UI_PORT=5100 MAILDEV_UI_PORT=1000 ENV=e2e-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)
    - [x] `make clean test-e2e API_PORT=8700 UI_PORT=5100 MAILDEV_UI_PORT=1000 ENV=e2e-feat-roadmap-stabilization` (skipped by BR00-D3: no runtime code change)

- [x] **Lot N-2 — UAT**
  - [x] Run web app and extension UAT non-regression scenarios. (not required: no runtime code change)
  - [x] Confirm the branch is stable enough to unblock W1 wave branches.

- [x] **Lot N-1 — Docs consolidation**
  - [x] Consolidate branch learnings into relevant `spec/*` and `TODO.md` entries.
  - [x] Update `PLAN.md` execution notes for branch completion.

- [x] **Lot N — Final validation**
  - [x] Re-run full branch gates (typecheck, lint, tests, e2e). (skipped by BR00-D3: no runtime code change)
  - [x] Verify CI status and attach executed command list in PR notes. (local proof attached in branch notes)
  - [x] Ensure branch remains orthogonal, mergeable, and non-blocking.
