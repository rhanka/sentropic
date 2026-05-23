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
- [ ] `acknowledge` BR-NPMG-EX2: extend `Makefile` `publish-<pkg>` (OIDC) recipes with the full set of `GITHUB_*` env vars required by npm's sigstore provenance validation (event_name, run_id, run_attempt, server_url, repository_id, repository_owner_id, workflow, workflow_ref, workflow_sha). Reason: `publish-llm-mesh@0.1.1` failed on main rerun with `npm error code E422 Error verifying sigstore provenance bundle` due to empty/undefined values; impact: additive `-e` flags in 6 recipes; rollback: drop the new flags. Token-mode recipes unchanged.
- [ ] `acknowledge` BR-NPMG-EX3: switch the whole project to strict MIT license. Replace root `LICENSE`, replace/create `packages/<pkg>/LICENSE` for all 6 published packages, set `"license": "MIT"` (SPDX) in each `packages/<pkg>/package.json`, bump 5 packages 0.1.0 → 0.1.1 (license is part of published metadata; tarball is rebuilt). Reason: the current "MIT with Commercial Restrictions" custom license is ambiguous for npm consumers and incompatible with the SPDX identifier; impact: license becomes fully permissive (OSI-approved MIT); rollback: revert LICENSE + license field + version bumps.

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

- [x] **Lot 2 — Documentation**
  - [x] Added new section "Package Publication (MANDATORY)" to `rules/workflow.md`.
  - [x] Added "Bumped affected packages/<pkg>/package.json version" checkbox to `plan/BRANCH_TEMPLATE.md` Lot N.
  - [x] Lot gate:
    - [x] `make commit MSG="docs: add package publication policy to rules/workflow.md and BRANCH template"`.

- [x] **Lot 3 — Provenance env vars (Makefile)**
  - [x] Added `-e GITHUB_EVENT_NAME -e GITHUB_RUN_ID -e GITHUB_RUN_ATTEMPT -e GITHUB_SERVER_URL -e GITHUB_REPOSITORY_ID -e GITHUB_REPOSITORY_OWNER_ID -e GITHUB_WORKFLOW -e GITHUB_WORKFLOW_REF -e GITHUB_WORKFLOW_SHA` to the 6 `publish-<pkg>` (OIDC) Makefile recipes (llm-mesh, chat-ui, chat-core, events, contracts, flow).
  - [x] Token-mode recipes unchanged.
  - [x] Lot gate:
    - [x] `git diff Makefile` shows only additive `-e GITHUB_*` per OIDC recipe (54 lines added, 9 per recipe × 6).
    - [x] `make commit MSG="fix(make): propagate full GITHUB_* env to npm publish for sigstore provenance"`.

- [ ] **Lot 4 — Strict MIT license**
  - [ ] Replace root `LICENSE` with OSI-standard MIT text (Copyright 2025 Fabien Antoine).
  - [ ] Replace `packages/llm-mesh/LICENSE` and `packages/flow/LICENSE` with the same strict MIT text.
  - [ ] Create `packages/{chat-core,chat-ui,contracts,events}/LICENSE` with the same strict MIT text.
  - [ ] In each `packages/<pkg>/package.json`, change `"license": "SEE LICENSE IN LICENSE"` → `"license": "MIT"` (SPDX identifier).
  - [ ] Bump `packages/{chat-core,chat-ui,contracts,events,flow}/package.json` version `0.1.0 → 0.1.1` to force npm republish with the new LICENSE in tarball. llm-mesh stays at 0.1.1 (already targeted, will republish via the lane).
  - [ ] Lot gate:
    - [ ] `git diff` shows: 1 root LICENSE rewritten + 6 per-pkg LICENSE created/rewritten + 6 license fields + 5 version bumps.
    - [ ] `make commit MSG="chore(license): switch to strict MIT, bump packages 0.1.0 -> 0.1.1"`.

- [ ] **Lot 5 — PR + CI green + merge**
  - [ ] `git push origin fix/npm-publish-bump-gate`.
  - [ ] Open PR.
  - [ ] CI green (the new `enforce-package-bump` job runs on itself but no `packages/` paths changed → pass).
  - [ ] Merge.
  - [ ] Remove BRANCH.md before merge.
