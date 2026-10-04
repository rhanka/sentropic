# Feature: Migrate UI tooling to Tailwind 4 and svelte-check 4

## Objective
- [ ] Remove GHSA-vfj7-8cjw-p6xm from the UI tree without acceptances or scanner changes, preserving appearance and behavior.

## Scope / Guardrails
- [x] Owner decision: migration first; Tailwind 3 to 4 and svelte-check 3 to 4.
- [x] Worktree: `tmp/ui-sca-fix`; branch: `feat/ui-tailwind4-svelte-check4`; base: `origin/main`.
- [x] Environment: `API_PORT=9493 UI_PORT=5693 MAILDEV_UI_PORT=1593 ENV=test-ui-tw4`; ENV always last.
- [x] Make-only tooling, Docker-first, English artifacts; never ENV=dev or clean-all.
- [x] No vulnerability acceptance, scanner-policy change, or increased E2E timeout.
- [x] Preserve web, auth, chat, Chrome extension, and VSCode webview design.
- [x] Atomic commits below 150 lines; generated lockfile-only exceptions documented below.
- [x] Push/open PR after local qualification; wait for CI; do not merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `ui/**`
  - `e2e/tests/06-tooling-visual-parity.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `api/package-lock.json`
  - `apps/auth-idp/web/**`
  - `Makefile`
  - `.security/**`
- **Exception process**:
  - [x] Declare reason, impact, and rollback before conditional edits.

## Feedback Loop
- [x] BR-TW4-EX1 — owner-authorized manifests/locks: remove vulnerable tooling chains; impact: dependency resolutions; rollback: revert manifest and generated lock commits together.
- [x] BR-TW4-EX2 — generated lockfile-only commits may exceed 150 lines; impact: one generated artifact per commit; rollback: revert its lockfile commit.
- [x] BR-TW4-EX3 — `.security/**` generated scan evidence only; impact: ignored artifacts; rollback: regenerate; no register or policy edits.
- [x] BR-TW4-EX4 — standalone IdP web tooling/config if its audit retains the same chain; impact: auth-screen build; rollback: revert its migration and lock.

## AI Flaky tests
- [x] No timeout increases or new flaky acceptance; record failures with exact evidence.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; builder executes lots; owner-provided reviewer examines reports read-only.
- [ ] Multi-branch.

## UAT Management (in orchestration context)
- [ ] Compare identical-data before/after screenshots for login, home/dashboard, list, detail, and chat using existing Playwright through make.
- [ ] Qualify web/Chrome/VSCode artifacts and retain evidence in `.h2a/build/`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and migration design**
  - [x] Read prior investigation, new brief, MASTER/workflow/testing/security, and template.
  - [x] Verify renamed branch mechanically with `harness check branch`.
  - [x] Confirm assigned ports are free before starting services.
  - [ ] Read official upgrade path; inventory CSS sources, theme tokens, changed utilities.
  - [ ] Capture five baseline pages via `e2e/tests/06-tooling-visual-parity.spec.ts`.
  - [ ] Write `.h2a/build/lot0_report.md`; commit scoped plan and capture harness.
- [ ] **Lot 1 — UI tooling and CSS migration**
  - [ ] Upgrade UI Tailwind/svelte-check; CSS-first PostCSS integration for all Vite builds.
  - [ ] Replace directives/config with CSS theme/source declarations and preserve custom colors and affected v3 defaults.
  - [ ] Audit/adapt renamed utilities, borders/rings, spacing/dividers, hover, preflight.
  - [ ] Regenerate root/standalone UI locks through make; commit generated locks separately.
  - [ ] Verify UI SCA removes braces; write `.h2a/build/lot1_report.md`.
- [ ] **Lot 2 — Related trees and qualification**
  - [ ] Audit API and standalone UI/IdP trees; migrate same-chain consumers as required.
  - [ ] Build UI web/Chrome/VSCode via `make build-ui` and production image for E2E.
  - [ ] Run `make typecheck`, `make lint`, `make test-ui`, and all SCA targets.
  - [ ] Capture after migration and compare all five pages; report differences.
  - [ ] Run full `make test-e2e` with assigned ports/ENV; investigate/fix failures.
  - [ ] Write `.h2a/build/lot2_report.md`; resolve review and scope findings.
- [ ] **Lot 3 — PR and CI**
  - [ ] Push branch/create PR to main with this plan and concrete validation evidence.
  - [ ] Wait for CI/fix failures; write lot3 report and final `.h2a/report.md`.
  - [ ] Stop isolated services and verify no branch containers remain.
  - [x] Keep BRANCH.md and leave the PR unmerged, as explicitly instructed.

## Deferred to BR-XX
- [x] Unrelated dependency upgrades, product changes, and container-register cleanup.
