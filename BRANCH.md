# Feature: Chrome Plugin Download Distribution

## Objective
Deliver a fast distribution path for the Chrome plugin: package artifact generation and in-app download access from `/settings`, with an instance-configured download URL.

## Scope / Guardrails
- Scope limited to plugin packaging flow, download metadata exposure, and settings UI integration.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-chrome-plugin-download-distribution` `API_PORT=8713` `UI_PORT=5113` `MAILDEV_UI_PORT=1013`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `scripts/**`
  - `plan/13-BRANCH_feat-chrome-plugin-download-distribution.md`
  - `plan/DEBUG_TICKETS.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `spec/**`, `PLAN.md`, `TODO.md` (docs consolidation or roadmap sync only)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in this file before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.
  - Mirror exception in `plan/CONDUCTOR_QUESTIONS.md`.

## Questions / Notes
- Distribution default for fast delivery: unsigned zip artifact for developer side-load.
- URL source of truth: server-side config (instance-level), exposed via API to the settings page.
- Signed CRX and store publication remain out of this branch (handled later by release branch).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: This branch is a focused delivery slice and should stay independently mergeable.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the branch worktree environment before push (after each lot when UI/plugin surface is impacted).
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Keep branch local (commit allowed), do not push before user UAT sign-off.
  - Run user UAT against the branch environment (`ENV=feat-<slug>`, dedicated ports).
  - After `UAT OK`, push branch and continue PR/CI flow.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read relevant `.mdc` files, `README.md`, `TODO.md`, and linked specs.
  - [x] Confirm isolated worktree `tmp/feat-chrome-plugin-download-distribution` and environment mapping (`ENV=feat-chrome-plugin-download-distribution`).
  - [x] Capture Make targets needed for debug/testing and CI parity.
  - [x] Confirm scope and dependency boundaries with upstream branches.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [x] Finalize open questions required before implementation starts.

- [x] **Lot 1 — Packaging + Download Metadata API**
  - [x] Add/align packaging flow for a downloadable Chrome plugin artifact (zip) with versioned output.
  - [x] Expose API metadata endpoint for latest artifact (`version`, `downloadUrl`, optional `sha256`).
  - [x] Add guardrails for missing/invalid download base URL configuration.
  - [x] Lot 1 gate:
    - [x] `make typecheck-api REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [x] `make lint-api REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make test-api ENV=test-feat-chrome-plugin-download-distribution` (not run; scoped endpoint suite used for this branch slice)
    - [x] `make test-api-endpoints SCOPE=tests/api/chrome-extension-download.test.ts REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [x] `make typecheck-ui REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [x] `make lint-ui REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make test-ui ENV=test-feat-chrome-plugin-download-distribution` (not run; scoped UI suite used for this branch slice)
    - [x] `make test-ui SCOPE=tests/utils/chrome-extension-download.test.ts REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`

- [x] **Lot 2 — Settings UI Download Integration**
  - [x] Add a settings section with plugin version + download CTA.
  - [x] Use metadata API to build instance-aware URL dynamically in UI.
  - [x] Add/update E2E coverage for settings download flow and error states.
  - [x] Lot 2 gate:
    - [x] `make typecheck-api REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [x] `make lint-api REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make test-api ENV=test-feat-chrome-plugin-download-distribution` (not run; scoped endpoint suite used for this branch slice)
    - [x] `make test-api-endpoints SCOPE=tests/api/chrome-extension-download.test.ts REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [x] `make typecheck-ui REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [x] `make lint-ui REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [ ] `make test-ui ENV=test-feat-chrome-plugin-download-distribution` (not run; scoped UI suite used for this branch slice)
    - [x] `make test-ui SCOPE=tests/utils/chrome-extension-download.test.ts REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution`
    - [x] `make build-api build-ui-image REGISTRY=local API_PORT=8713 UI_PORT=5113 MAILDEV_UI_PORT=1013 ENV=e2e-feat-chrome-plugin-download-distribution`
    - [x] `make test-e2e REGISTRY=local E2E_SPEC=e2e/tests/06-settings.spec.ts WORKERS=2 RETRIES=0 MAX_FAILURES=1 API_PORT=8793 UI_PORT=5193 MAILDEV_UI_PORT=1093 ENV=e2e-feat-chrome-plugin-download-distribution` (16 passed, 3 skipped)

- [ ] **Lot N-2 — UAT: Settings Chrome Plugin card**
  - [ ] Pre-flight (branch env up, Settings Chrome Plugin card):
    - [ ] Feature-branch workspace: `make -C /home/antoinefa/src/top-ai-ideas-fullstack/tmp/feat-chrome-plugin-download-distribution dev API_PORT=8713 UI_PORT=5113 MAILDEV_UI_PORT=1013 ENV=feat-chrome-plugin-download-distribution`
    - [ ] Root `ENV=dev` preflight (config parity for Settings Chrome Plugin card):
      - [ ] Option A (remote URL): set `CHROME_EXTENSION_DOWNLOAD_URL` (and optional `CHROME_EXTENSION_VERSION`, `CHROME_EXTENSION_SOURCE`) in `/home/antoinefa/src/top-ai-ideas-fullstack/.env`, then verify URL reachability (`curl -I "$CHROME_EXTENSION_DOWNLOAD_URL"` returns `2xx`/`3xx`).
      - [ ] Option B (local package fallback pipeline for Settings Chrome Plugin card):
        1) [ ] Build extension artifacts.
        2) [ ] Package the zip at the instance-served path `/chrome-extension/top-ai-ideas-chrome-extension.zip`.
        3) [ ] Restart API (`make -C /home/antoinefa/src/top-ai-ideas-fullstack down ENV=dev` then `make -C /home/antoinefa/src/top-ai-ideas-fullstack dev ENV=dev`) and verify the Settings Chrome Plugin card loads with download CTA.
    - [ ] UAT fusion branch (local): `make -C /home/antoinefa/src/top-ai-ideas-fullstack up API_PORT=8893 UI_PORT=5293 MAILDEV_UI_PORT=1193 REGISTRY=local ENV=uat-br13-local`
    - [ ] Login with a valid user and open `/settings`.
  - [ ] UAT-01 Settings Chrome Plugin card is visible:
    - [ ] Settings Chrome Plugin card title and description are rendered in `/settings`.
    - [ ] Download button is visible and enabled when metadata loads.
  - [ ] UAT-02 Settings Chrome Plugin card metadata rendering:
    - [ ] Version is displayed (`settings.chromeExtension.versionLabel` + value).
    - [ ] Source is displayed (`settings.chromeExtension.sourceLabel` + value).
  - [ ] UAT-03 Settings Chrome Plugin card download URL behavior:
    - [ ] Download CTA uses URL returned by `/api/v1/chrome-extension/download`.
    - [ ] Clicking CTA opens the configured download target in a new tab.
  - [ ] UAT-04 Settings Chrome Plugin card error/fallback behavior:
    - [ ] With missing/invalid `CHROME_EXTENSION_DOWNLOAD_URL`, the card shows the API/fallback error state.
    - [ ] Retry button is visible in error state.
  - [ ] UAT-05 Settings Chrome Plugin card recovery path:
    - [ ] After fixing config, restarting API, and refreshing/retrying, error state clears and CTA is restored.
  - [ ] Exit criteria:
    - [ ] UAT-01..UAT-05 all validated.
    - [ ] Result captured in this file (date + tester + notes).

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into the relevant `spec/*` files.
  - [ ] Update `PLAN.md` status and dependency notes after integration readiness.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
  - [ ] Ensure branch remains orthogonal, mergeable, and non-blocking.

## Evidence Log
- API route implemented: `api/src/routes/api/chrome-extension.ts` and mounted in `api/src/routes/api/index.ts`.
- Env keys added: `CHROME_EXTENSION_DOWNLOAD_URL`, `CHROME_EXTENSION_VERSION`, `CHROME_EXTENSION_SOURCE` in `api/src/config/env.ts`.
- Packaging metadata generated in extension build output: `ui/chrome-ext/copy-assets.js` now writes `manifest.json` with package version + `extension-metadata.json`.
- Settings UI integration: `ui/src/routes/settings/+page.svelte` with download card and loading/error/retry states.
- UI/API helper tests added:
  - `api/tests/api/chrome-extension-download.test.ts`
  - `ui/tests/utils/chrome-extension-download.test.ts`
- E2E settings coverage extended in `e2e/tests/06-settings.spec.ts` for download card success/error states.
