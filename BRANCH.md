# Feature: Aggregate CI results without blocking skipped checks

## Objective
- [x] Add `ci-gate` as the authoritative merge check, accepting only successful, skipped, or neutral results and rejecting failed, cancelled, missing, or unknown results.

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
  - `.github/REQUIRED_CHECKS.md`
  - `spec/SPEC_EVOL_CI_PUBLISHABLE_MANIFEST_GUARD.md`
  - `scripts/ci/publishable-ci-wiring.test.mjs` (directly blocking CI compatibility assertion)
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
  - [x] BRCG-EX1 (harness-compatible alias BR0-EX1) approved by the brief and review corrections: add and harden only the aggregate job in `.github/workflows/ci.yml`; rationale: path-filtered checks need one unconditional result; impact: one read-only runner after PR validation; rollback: remove its required context before reverting the added job.

## Feedback Loop
- [x] BRCG-EX1 — acknowledgement, owner: conductor, 2026-10-10; workflow exception explicitly authorized in `.h2a/inputs/brief.md`.
- [x] Exclude all `publish-*` and `bootstrap-publish`: they publish artifacts on main or explicit dispatch, outside PR validation.
- [x] Exclude `verify-train-lock-integrity`: main-only registry verification after publication; no PR artifact exists yet.
- [x] Exclude `deploy-preprod`: main-only deployment after image publication, outside PR validation.
- [x] BRCG-F1 — resolved: inventory isolation applies to every job except `ci-gate`, which must enforce inventory validation; evidence: initial scoped reproduction failed, and all 21 current wiring tests pass.
- [x] BRCG-F2 — M1: rename CI policy documentation to `.github/REQUIRED_CHECKS.md` and update its spec link so GitHub continues selecting the root `README.md`; verify the branch README endpoint after push.
- [x] BRCG-F3 — M2 and minor corrections implemented and locally verified: complete gate inventory/always/leaf guards, isolation exception limited to the gate, and rejection of missing/unknown results; final pushed-head CI evidence belongs in `.h2a/report.md`.
- [x] Minor permissions nit: retain `contents: read`, as explicitly required by the brief and accepted by review; the committed guard will lock that permission set.
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
  - [x] Print every dependency result and reject failures, cancellations, missing/unknown results, and empty input.
  - [x] `make -f /tmp/ci-aggregate-gate-checks.mk test-ci-gate validate-ci-gate ENV=test-ci-aggregate-gate`: nine extracted-shell fixtures passed; success/skipped/neutral and their mix exit 0; failure/cancelled and three mixed failure cases exit 1; every dependency summary is asserted.
  - [x] The same check parses YAML in a Node container, asserts 38 exact dependencies and minimal permissions, and proves all 63 existing jobs and top-level workflow settings unchanged.
  - [x] `make check-ci-version-filters check-e2e-inventory ENV=test-ci-aggregate-gate`: passed, including all 56 numbered E2E specs.
  - [x] Adapt `scripts/ci/publishable-ci-wiring.test.mjs` to the aggregate consumer; `make test-publishable-manifests test-qualify-published-install ENV=test-ci-aggregate-gate` passed all 84 manifest and 18 qualification fixture tests.
- [x] **Lot 2 — Documentation and PR handoff**
  - [x] Document required contexts and conductor migration in `.github/REQUIRED_CHECKS.md`; align the manifest guard spec's branch-protection instructions.
  - [x] Run `make scope-check ENV=test-ci-aggregate-gate` before every commit; BRCG-EX1 uses numeric alias BR0-EX1 for the Harness parser.
  - [x] Push the branch, open PR #661 with this plan as its body, and post the four-step execution plan as the first PR comment.
  - [x] Verify corrected PR CI, including `ci-gate`: run 38052186766 passed on `1cd43bef88e36a11a65a2b523b27a78e306b59a8` with 57 successful and 25 skipped jobs; final bookkeeping-head CI evidence is recorded in `.h2a/report.md` after push.
  - [x] Write `.h2a/report.md` with dependency/exclusion inventory, exact contexts, PR, CI evidence, and open questions for the conductor; update its final CI evidence before handoff.
  - [x] Leave `BRANCH.md` removal, merge, and branch-protection migration to the conductor, as required by the brief.
- [x] **Lot 3 — Review corrections**
  - [x] M1: rename `.github/README.md` to `.github/REQUIRED_CHECKS.md`, update scope/spec links, and record the post-push GitHub README selection in `.h2a/report.md`.
  - [x] M2: commit the gate inventory/always/context/permissions/leaf assertions in `scripts/ci/publishable-ci-wiring.test.mjs`, already run by CI.
  - [x] Guard verification: unchanged workflow passes; ten mutations (including an omitted future job and removed `always()`) fail the actual committed test in an isolated container fixture.
  - [x] Minor result validation: 13 extracted-shell fixtures pass, including missing, null, unknown, and empty inputs; unacceptable jobs receive error annotations.
  - [x] Minor isolation: only `ci-gate` is exempt from inventory isolation; no job may depend on the aggregate gate.
  - [x] Minor CI bookkeeping: record the qualified review-fix SHA/run above, refresh the PR body from this file, and keep exact final bookkeeping-head verification in `.h2a/report.md`.
  - [x] Minor permissions: retain the brief's `contents: read` contract and enforce it in the committed test.
  - [x] `make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs ENV=test-ci-aggregate-gate`: all 21 wiring tests pass; full `make test-publishable-manifests ENV=test-ci-aggregate-gate`: all 85 fixtures pass.
