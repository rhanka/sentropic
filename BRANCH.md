# Fix: NPM publish bump-gate (machine-enforced + documented)

## Objective
Prevent the silent-skip bug where a commit that modifies `packages/<pkg>/src/**` but forgets to bump `packages/<pkg>/package.json` "version" reaches main, triggers the publish lane, hits the npm `already exists; skipping publish` branch, and the code never reaches npm. Enforce the rule via CI gate + document it in `rules/` + add to BRANCH template.

## Scope / Guardrails
- Scope limited to CI gate + workflow doc + BRANCH template.
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/fix-npm-publish-bump-gate`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `rules/workflow.md`
  - `plan/BRANCH_TEMPLATE.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/ci.yml` (BR-NPMG-EX1)

## Feedback Loop
- [ ] `acknowledge` BR-NPMG-EX1: add `enforce-package-bump` job to `.github/workflows/ci.yml`. Reason: this branch's whole purpose is wiring a CI gate; impact: additive job that runs on PRs only, gates merge; rollback: drop the job. No edit of existing jobs.

## AI Flaky tests
- Not applicable.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: small additive change in 3 files, single test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: no UAT — verified by triggering the gate on a synthetic test PR (or by inspecting the diff parser locally).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Create isolated worktree `tmp/fix-npm-publish-bump-gate`.
  - [x] Slot ports `API_PORT=9115`, `UI_PORT=5315`, `MAILDEV_UI_PORT=1215`, `ENV=fix-npm-publish-bump-gate` (not used in practice — CI/doc only).
  - [x] Declare BR-NPMG-EX1.

- [x] **Lot 1 — CI gate `enforce-package-bump`**
  - [x] Add job to `.github/workflows/ci.yml` that:
    - [x] Triggers on `pull_request` only.
    - [x] Computes the merge-base with `origin/${{ github.base_ref }}` and lists changed files in the PR diff.
    - [x] For each `packages/<pkg>/` with changes in `src/**`: extracts OLD version (from merge-base) and NEW version (from HEAD).
    - [x] Skips packages marked `"private": true`.
    - [x] Skips new packages (no OLD version) — handled via bootstrap workflow_dispatch.
    - [x] Fails with `::error::` if any non-private touched package has unchanged version.
    - [x] Allows changes outside `src/**` (e.g. README updates) without bump requirement.
  - [x] Lot gate:
    - [x] `make commit MSG="ci: add enforce-package-bump job"`.

- [ ] **Lot 2 — Documentation**
  - [ ] Add new section "Package publication" to `rules/workflow.md`:
    - [ ] Each `packages/<pkg>/` is published to npm under `@sentropic/<pkg>`.
    - [ ] Publishing happens automatically on merge to main via OIDC trusted publishers (no token needed).
    - [ ] **MANDATORY**: bump `packages/<pkg>/package.json` `version` semver-style on every PR that touches `packages/<pkg>/src/**`.
    - [ ] CI gate `enforce-package-bump` blocks merge if not respected.
    - [ ] First publish of a new package requires manual `workflow_dispatch bootstrap_publish_target=<pkg>` with `NPM_TOKEN` secret, followed by attaching trusted publisher OIDC on npmjs.com.
  - [ ] Add checkbox to `plan/BRANCH_TEMPLATE.md` Lot N "Final validation": `[ ] Bumped affected packages/<pkg>/package.json version (semver) if src changed`.
  - [ ] Lot gate:
    - [ ] `make commit MSG="docs: add package publication policy to rules/workflow.md and BRANCH template"`.

- [ ] **Lot 3 — PR + CI green + merge**
  - [ ] `git push origin fix/npm-publish-bump-gate`.
  - [ ] Open PR.
  - [ ] CI green (the new `enforce-package-bump` job runs on itself but no `packages/` paths changed → pass).
  - [ ] Merge.
  - [ ] Remove BRANCH.md before merge.
