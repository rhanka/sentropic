# Feature: W33 Dependabot Security Sweep

## Objective
- [x] Integrate the compatible dependency security bumps from PRs #448, #447, #443, #535, #525, #524, #516, #510, and the already-satisfied #345 into one batch PR to `main`.

## Scope / Guardrails
- [x] Work only in `tmp/worktrees/w33-dependabot-security-sweep` on `chore/w33-dependabot-security-sweep`.
- [x] Derive resolved versions from the named Dependabot branches or containerized npm lock generation.
- [x] Exclude PR #528 and do not replay PR #548; retain latest `origin/main` only as the integration base.
- [x] Make-only dependency, build, quality, and test commands; pass `ENV=test-w33-secu-sweep` last where required.
- [x] Do not merge, close superseded PRs, self-review, or claim approval.
- [x] Require independent Opus review, fresh green complete CI, and explicit owner GO before merge.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**
  - [ ] `BRANCH.md`
  - [ ] `api/package.json`
  - [ ] `api/package-lock.json`
  - [ ] `package-lock.json` (workspace lock coherence for the two direct manifest floors)
  - [ ] `ui/package.json`
  - [ ] `ui/package-lock.json`
  - [ ] `packages/focus/package.json` (verification only; no change if already `4.1.0`)
- [ ] **Forbidden Paths (must not change in this branch)**
  - [ ] `Makefile`
  - [ ] `docker-compose*.yml`
  - [ ] `.cursor/rules/**`
  - [ ] `.github/workflows/**`
  - [ ] `.security/**`
  - [ ] All application source, tests, specs, and unrelated manifests/lockfiles
- [ ] **Conditional Paths**
  - [ ] None
- [ ] **Exception process**
  - [ ] Declare any exception in `## Feedback Loop` before touching an unlisted path.

## Feedback Loop
- [x] `BRW33-EX1 attention`: npm lockfile metadata may exceed the 150-line commit guideline; keep only reproducible resolver output for the named bumps, inspect every hunk, and roll back by reverting the atomic lockfile commit.
- [x] `attention`: #345 is already satisfied on fresh `origin/main` with `packages/focus/package.json` and its root lock entry at Vitest `4.1.0`; verify without changing it.
- [x] `attention`: the PR is a batch integration candidate only and carries no approval or merge authorization.
- [x] `attention`: generated UI Vite caches are written as UID/GID `65534:65534` by the isolated service; `make down` plus `make clean-node-modules` was required before later Make-managed installs. No tracked file was affected.
- [x] `attention`: focused npm audits still report pre-existing high/critical findings in dependency paths outside the nine authorized PRs (including API `hono`/`form-data` and UI transitive Vite/PostCSS/NanoID/Vitest); this batch does not widen scope to repair them.

## AI Flaky tests
- [ ] Accept no flaky test without same-commit success evidence and explicit owner sign-off.
- [ ] Do not increase timeouts or weaken assertions.

## Orchestration Mode (AI-selected)
- [x] **Single integration branch, sole executor, no cherry-pick**
- [ ] **Multi-branch**
- [x] Rebase the integration branch on freshly fetched `origin/main` before push.

## UAT Management
- [x] No interactive UAT required for dependency metadata-only changes.
- [ ] Complete CI remains mandatory before any owner GO.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and evidence**
  - [x] Fetch latest `origin/main` and create the isolated linked worktree from `ed25c0628914c7a038a6650f3ee4d81bb8960758`.
  - [x] Pass `harness check branch` before edits.
  - [x] Capture PR heads, target versions, files, and exact lock integrity records.
  - [x] Confirm #528 and #548 are excluded from the branch diff.
  - [x] Confirm #345 is already satisfied on the integration base.

- [x] **Lot 1 — UI security dependency set**
  - [x] Update DOMPurify `3.4.3` to `3.4.14` in `ui/package.json` and its lock root.
  - [x] Update the root workspace lock entry for the UI manifest floor.
  - [x] Resolve `ws` `8.20.1` to `8.21.3`, `linkify-it` `5.0.0` to `5.0.2`, and `js-yaml` `4.1.1` to `4.3.1` in `ui/package-lock.json`.
  - [x] Inspect the UI lock diff and retain no unrelated dependency updates.
  - [x] Lot gate: `make typecheck-ui ENV=test-w33-secu-sweep` (0 errors; 6 existing warnings in 5 files).
  - [x] Lot gate: `make lint-ui ENV=test-w33-secu-sweep`.
  - [x] Lot gate: `make test-ui ENV=test-w33-secu-sweep` (76 files, 464 tests).

- [x] **Lot 2 — API security dependency set**
  - [x] Update `@hono/node-server` `1.19.14` to `1.19.15` in `api/package.json` and its lock root.
  - [x] Update the root workspace lock entry for the API manifest floor.
  - [x] Resolve Vite `8.0.13` to `8.2.2`, Nano ID `5.1.11` to `5.1.16` and `3.3.12` to `3.3.18`, and PostCSS `8.5.14` to `8.5.26` in `api/package-lock.json`.
  - [x] Inspect the API lock diff and retain no unrelated dependency updates.
  - [x] Lot gate: `make typecheck-api ENV=test-w33-secu-sweep`.
  - [x] Lot gate: `make lint-api ENV=test-w33-secu-sweep` (0 errors; 208 existing warnings).
  - [x] Lot gate: `make test-api-unit ENV=test-w33-secu-sweep` (110 files; 892 passed, 2 skipped).

- [x] **Lot 3 — Focus and security verification**
  - [x] Verify `packages/focus/package.json` remains on Vitest `4.1.0` with matching root lock resolution.
  - [x] Run `make typecheck-focus ENV=test-w33-secu-sweep`.
  - [x] Run `make test-focus ENV=test-w33-secu-sweep` (4 files, 97 tests).
  - [x] Run focused API and UI npm audit validation through repository Make targets; record the out-of-scope residual findings above.

- [ ] **Lot 4 — Rebase, PR, and complete CI**
  - [x] Run `make scope-check ENV=test-w33-secu-sweep` before every commit.
  - [x] Fetch and rebase on latest `origin/main` (`ed25c0628914c7a038a6650f3ee4d81bb8960758`); rerun branch and scope checks.
  - [ ] Push `chore/w33-dependabot-security-sweep` without merge authorization.
  - [ ] Open a clearly marked batch integration PR to `main` using this file as the body.
  - [ ] Launch the repository complete CI and report its run URL/status.
  - [ ] Report worktree, branch, commit, PR, CI, package versions, tests, and blockers through `loop-w33-secu-sweep` and the live conductor inbox.
