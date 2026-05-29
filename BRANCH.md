# Fix: bump Playwright to ^1.60.0 to fix recurring `build-e2e` hang

## Objective
Unblock CI by bumping `@playwright/test` from `^1.55.1` (resolved 1.58.1) to `^1.60.0`
so the e2e Docker image build no longer hangs on the Playwright browser/CDN step
that has started failing intermittently against the older client.

## Scope / Guardrails
- Scope limited to `e2e/package.json`, `e2e/package-lock.json`, and `Makefile` (new `lock-e2e` target).
- Make-only workflow, no direct Docker commands on host.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in worktree `tmp/fix-playwright-bump`.
- No service stack started by this branch (lock regen + CI only).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `e2e/package.json`
  - `e2e/package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit `FIX-PWB-EXn` exception)**:
  - `Makefile`
  - `.github/workflows/**`
- **Exception process**:
  - `FIX-PWB-EX1` — `Makefile`: add `lock-e2e` target (mirror of `lock-root`) so e2e lock can be regenerated through `make` without bypassing the make-only rule. Risk: minimal (new target, no change to existing); rollback: revert the added block.

## Feedback Loop
- `FIX-PWB-EX1` `acknowledge` — `Makefile` `lock-e2e` target added, rationale above.

## AI Flaky tests
- Not applicable: no AI tests modified.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single-file capability fix).
- [ ] Multi-branch
- Rationale: 3-file orthogonal fix.

## UAT Management
- Not applicable: no user-facing change.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`.
  - [x] Worktree `tmp/fix-playwright-bump` created from `origin/main` (HEAD `a817aed8`).
  - [x] Confirm scope and `FIX-PWB-EX1` exception for `Makefile`.

- [x] **Lot 1 — Add `make lock-e2e` target**
  - [x] Add `.PHONY: lock-e2e` target in `Makefile` after `lock-root`, mirroring its pattern.
  - [x] Uses `node:24-slim` (matches `e2e/Dockerfile` base) with `--legacy-peer-deps --package-lock-only --ignore-scripts`.

- [x] **Lot 2 — Bump Playwright to `^1.60.0`**
  - [x] Edit `e2e/package.json` `devDependencies."@playwright/test"`: `^1.55.1` -> `^1.60.0`.
  - [x] Run `make lock-e2e` to regenerate `e2e/package-lock.json`.
  - [x] Verify lock: `@playwright/test 1.60.0` and `playwright-core 1.60.0`.

- [ ] **Lot N-2 — CI gate**
  - [ ] Push branch, open PR, wait for full CI green (especially `build-e2e` no longer hangs).
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] N/A (self-documenting Makefile target + this BRANCH.md).
- [ ] **Lot N — Final validation & merge**
  - [ ] Remove `BRANCH.md`, merge via merge commit (repo policy §0).
