# Feature: Aggregate CI results without blocking skipped checks

## Objective
- [x] Add `ci-gate` as the authoritative merge check, rejecting failed or cancelled dependencies and accepting successful, skipped, or neutral results.

## Scope / Guardrails
- [x] Work only in `feat/ci-aggregate-gate`, isolated worktree `tmp/ci-aggregate-gate`, based on `origin/main`.
- [x] Preserve every existing job, condition, permission, publication path, and deployment behavior.
- [x] Use Make for checks/builds; no Python; `ENV=test-ci-aggregate-gate` is always the last Make argument.
- [x] No service stack or ports are needed; root `ENV=dev` remains reserved for user UAT.
- [x] Keep commits below 150 changed lines, selectively stage files, and commit through `make commit`.
- [x] Stop at an open PR to `main` with green CI; merging and repository settings belong to the conductor.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.github/README.md`
  - `spec/SPEC_EVOL_CI_PUBLISHABLE_MANIFEST_GUARD.md`
  - `.h2a/report.md` (ignored handoff artifact)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `api/**`
  - `ui/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml`
- **Exception process**:
  - [x] BRCG-EX1 (harness-compatible alias BR0-EX1) approved by the task brief: add only the aggregate job to `.github/workflows/ci.yml`; rationale: path-filtered checks need one unconditional result; impact: one read-only runner after PR validation; rollback: remove its required context before reverting the added job.

## Feedback Loop
- [x] BRCG-EX1 — acknowledgement, owner: conductor, 2026-10-10; workflow exception explicitly authorized in `.h2a/inputs/brief.md`.
- [x] Exclude all `publish-*` and `bootstrap-publish`: they publish artifacts on main or explicit dispatch, outside PR validation.
- [x] Exclude `verify-train-lock-integrity`: main-only registry verification after publication; no PR artifact exists yet.
- [x] Exclude `deploy-preprod`: main-only deployment after image publication, outside PR validation.
- [ ] After merge, conductor replaces required contexts with exactly `changes`, `enforce-package-bump`, `validate-publishable-manifests`, `ci-gate`; do not retain path-filtered individual contexts or alter settings from this branch.

## AI Flaky tests
- [x] Preserve existing job-level `continue-on-error` behavior; no new exception or accepted flaky result is introduced.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one additive workflow change; no commit transfer or additional implementation agent required.

## UAT Management (in orchestration context)
- [x] CI-only change: web, Chrome, and VSCode UAT require no product interaction.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Read rules, task brief, project overview, priorities, branch template, and current CI job inventory.
  - [x] Mechanically validate branch with `harness check branch` and declare BRCG-EX1 before editing the workflow.
- [x] **Lot 1 — Aggregate merge gate**
  - [x] Add `ci-gate` with 38 explicit needs covering every PR validation/build/test/security job, `if: always()`, and `contents: read`.
  - [x] Print every dependency result and return nonzero exactly when any dependency failed or was cancelled.
  - [x] `make -f /tmp/ci-aggregate-gate-checks.mk test-ci-gate validate-ci-gate ENV=test-ci-aggregate-gate`: nine extracted-shell fixtures passed; success/skipped/neutral and their mix exit 0; failure/cancelled and three mixed failure cases exit 1; every dependency summary is asserted.
  - [x] The same check parses YAML in a Node container, asserts 38 exact dependencies and minimal permissions, and proves all 63 existing jobs and top-level workflow settings unchanged.
  - [x] `make check-ci-version-filters check-e2e-inventory ENV=test-ci-aggregate-gate`: passed, including all 56 numbered E2E specs.
- [ ] **Lot 2 — Documentation and PR handoff**
  - [x] Document required contexts and conductor migration in `.github/README.md`; align the manifest guard spec's branch-protection instructions.
  - [ ] Run `make scope-check ENV=test-ci-aggregate-gate` before every commit.
  - [ ] Push the branch, open the PR with this plan as its body, and post the concise execution plan as the first PR comment.
  - [ ] Verify all PR CI gates pass, including `ci-gate`; record review evidence and the exact head SHA.
  - [ ] Write `.h2a/report.md` with dependency/exclusion inventory, exact contexts, PR, CI evidence, and open questions for the conductor.
  - [x] Leave `BRANCH.md` removal, merge, and branch-protection migration to the conductor, as required by the brief.
