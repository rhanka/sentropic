# Feature: Local scheduler spec erratum (first version 0.2.0)

## Objective
Add a dated erratum (2026-11-26) to `spec/SPEC_EVOL_LOCAL_SCHEDULED_TASKS.md` updating all `0.1.0` first-publication references to `0.2.0` and recording the Lot S1 CI registration move (`BR-LSCH-EX1a'`).

## Scope / Guardrails
- Scope limited to `spec/SPEC_EVOL_LOCAL_SCHEDULED_TASKS.md`.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/cm-release-0270` (`docs/local-scheduler-spec-erratum`).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_LOCAL_SCHEDULED_TASKS.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `packages/**`
  - `scripts/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- None.

## AI Flaky tests
- None (docs-only branch).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single docs-only branch)
- [ ] **Multi-branch**
- Rationale: Single documentation file change.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, and `.h2a/reviews/pr1080-opus.md`.
  - [x] Create branch `docs/local-scheduler-spec-erratum` from `origin/main` in `tmp/cm-release-0270`.
  - [x] Confirm scope boundaries (`spec/SPEC_EVOL_LOCAL_SCHEDULED_TASKS.md` only).

- [x] **Lot 1 — Spec erratum & 0.2.0 correction**
  - [x] Add dated erratum (`2026-11-26`) covering `0.2.0` (`V-1`) and Lot S1 CI registration (`BR-LSCH-EX1a'`).
  - [x] Update all five `0.1.0` references in §4.2, §4.3, §7.2, and §7.3 to `0.2.0`.
  - [x] Update §7.2 scope-exception and lot rows for `BR-LSCH-EX1a'` / `BR-LSCH-EX1b`.

- [x] **Lot N — Final validation**
  - [x] Verify zero remaining `0.1.0` references in `spec/SPEC_EVOL_LOCAL_SCHEDULED_TASKS.md`.
  - [x] Run `make scope-check ENV=local-scheduler-fu`.
  - [ ] Remove `BRANCH.md` in final commit, push, open PR, and watch CI checks until green.
