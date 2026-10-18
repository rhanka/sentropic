# Feature: Fix artifacts 0.1.2 adapter and migration packaging

## Objective
- [ ] Make installed artifacts adapters and versioned SQL available to hosts without changing domain APIs.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/artifacts-012`; branch: `fix/artifacts-0.1.2-adapters-migrations`; base: `origin/main`.
- [x] Make-only, Docker-first; `ENV=test-artifacts-012` last; no merge, publication, or `make clean-all`.
- [x] No application services required; reserved ports API=9060, UI=5260, MAILDEV_UI=1160 remain unused.
- [x] Reference read only: Immo `SPEC_861C_ARTIFACT_HOST.md` section 2.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/package.json`
  - `packages/artifacts/README.md`
  - `packages/artifacts/probe/**`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/**`
  - `packages/artifacts/migrations/**`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare rationale, impact, and rollback in Feedback Loop before touching a forbidden path.

## Feedback Loop
- [x] BR012-EX1: allow only the existing packed-consumer Makefile recipe to install optional driver peers after proving core-only imports; impact limited to the disposable Docker consumer; rollback restores that recipe and probes together.
- [x] Track import belongs to the designated repository writer; this concurrent worktree updates only the mergeable branch plan.

## AI Flaky tests
- [x] No AI-dependent tests or timeout changes.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: implementation and final verification in this worktree.

## UAT Management (in orchestration context)
- [x] Package-only consumer qualification; no web, Chrome, or VS Code surface changes.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, branch template, package, adapters, migrations, packed probe, and host reference.
  - [x] Verify branch with Git and `harness check branch` before work.
  - [x] Confirm source manifest omits adapter exports and migration files.
  - [ ] Check published version through Docker/Make before bumping.
- [ ] **Lot 1 — Publishable package contract**
  - [ ] Add typed adapter exports and SQL resource export; include migrations; bump to 0.1.2.
  - [ ] Declare injected driver packages as optional peers and synchronize workspace lock metadata.
  - [ ] Document driver installation and ordered host-managed SQL execution in README; no package changelog exists.
- [ ] **Lot 2 — Packed-consumer regression**
  - [ ] Extend `packages/artifacts/probe/packed-consumer.mjs` to verify core without drivers and shipped SQL.
  - [ ] Add adapter imports/types resolution checks after explicit driver installation in the existing Make recipe.
  - [ ] Reproduce the packaging failure, then pass `make probe-artifacts-packed-consumer ENV=test-artifacts-012`.
- [ ] **Lot 3 — Final validation and handoff**
  - [ ] Run `make typecheck-artifacts lint-artifacts test-artifacts ENV=test-artifacts-012`.
  - [ ] Capture the full 0.1.2 `npm pack --dry-run` file list through a temporary Docker Make target.
  - [ ] Review final diff, run `make scope-check` before each atomic commit under 150 changed lines.
  - [ ] Push, open English PR using this plan, add execution-plan comment, inspect CI, report PR/head/files.
  - [ ] Owner-controlled merge and npm publication remain pending.
