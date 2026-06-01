# Feature: Cowork Desktop UI Image Version Fix

## Objective
Ensure the UI image tag changes when the Cowork desktop binary inputs change, so CI publishes a UI image that actually contains `ui/static/cowork-desktop/*`.

## Scope / Guardrails
- Scope limited to UI image version hashing for Cowork desktop distribution artifacts.
- No migrations.
- Make-only workflow, no direct Docker commands for project operations.
- Branch development happens in isolated worktree `tmp/fix-cowork-desktop-ui-image-version`.
- Tests use read-only static checks and CI verification; no root `dev` environment.
- In every `make` command, `ENV=<env>` is passed as the last argument when an `ENV` is needed.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `Makefile`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/src/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - `BR206-EX1`: Touch `Makefile`, normally forbidden, because `UI_VERSION` is defined there and currently omits Cowork desktop binary inputs. Impact is limited to cache invalidation and registry tag selection for UI images. Rollback is reverting the `UI_VERSION` input list change.

## Feedback Loop
- `attention`: Production static URL still returns 404 after PR #206 because CD reused an existing UI image tag; the root cause is the `UI_VERSION` hash excluding Cowork desktop packaging inputs.

## AI Flaky tests
- No AI tests required for this Makefile-only cache key fix.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: One Makefile change with focused verification.

## UAT Management (in orchestration context)
- No manual UAT required; deployment verification is HTTP smoke plus static artifact URL check after CI/CD.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Create isolated worktree `tmp/fix-cowork-desktop-ui-image-version`.
  - [x] Confirm scope boundaries and declare `BR206-EX1`.

- [x] **Lot 1 — Version hash fix**
  - [x] Add Cowork desktop packaging inputs to `UI_VERSION`.
  - [x] Red check: static assertion fails before the change.
  - [x] Green check: static assertion passes after the change.
  - [x] Verify `make version ENV=fix-cowork-desktop-ui-image-version`.
  - [x] Verify `git diff --check`.

- [ ] **Lot 2 — PR and CD**
  - [ ] Create PR with this `BRANCH.md` as body.
  - [ ] Verify PR CI.
  - [ ] Remove `BRANCH.md`.
  - [ ] Merge to main.
  - [ ] Verify main CD.
  - [ ] Verify `https://sentropic.sent-tech.ca/cowork-desktop/sentropic-cowork-windows-x64.zip`.
