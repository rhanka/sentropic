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
- `BR13-EX1` (approved): update `Makefile` to move production extension build-arg fallbacks out of `ui/Dockerfile`.
  - Reason: CI must be able to choose/override extension target URLs cleanly.
  - Impact: production extension defaults are now defined in `build-ui-image` variables and overridable in CI.
  - Rollback: restore Dockerfile ARG defaults and revert `build-ui-image` injected vars.
- `BR13-EX2` (approved): update `spec/**` and `PLAN.md` for Lot N-1 consolidation.
  - Reason: final branch closure requires permanent spec alignment and roadmap status/dependency traceability.
  - Impact: documentation-only updates; no runtime behavior or CI pipeline change.
  - Rollback: revert only BR13 documentation commits.

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

- [x] **Lot N-2 — UAT: Chrome extension developer distribution**
  - [x] Pre-flight (nominal root environment): `make -C /home/antoinefa/src/top-ai-ideas-fullstack down ENV=dev` then `make -C /home/antoinefa/src/top-ai-ideas-fullstack build-ext ENV=dev` then `make -C /home/antoinefa/src/top-ai-ideas-fullstack dev ENV=dev`, log in with a valid user, open `/settings`.
  - [x] UAT-01: Download the extension package from the Settings Chrome extension card.
  - [x] UAT-02: Load/install the unpacked extension in Chrome developer mode.
  - [x] UAT-03: Sign in to the current instance from the extension.
  - [x] UAT-04: Start a chat from the extension.
  - [x] UAT-05: Execute the `tab_info` tool successfully from the extension session.
  - [x] Exit criteria:
    - [x] UAT-01..UAT-05 validated.
    - [x] Result captured: 2026-02-23, tester `antoinefa`, status `OK`.

- [x] **Lot N-1 — Docs consolidation**
  - [x] Consolidate branch documentation updates into the relevant `spec/*` files.
  - [x] Update `PLAN.md` status and dependency notes after integration readiness.

- [x] **Lot N — Final validation**
  - [x] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [x] Verify CI status and attach executed command list in PR notes.
  - [x] Ensure branch remains orthogonal, mergeable, and non-blocking.

## Evidence Log
- API route implemented: `api/src/routes/api/chrome-extension.ts` and mounted in `api/src/routes/api/index.ts`.
- Env keys added: `CHROME_EXTENSION_DOWNLOAD_URL`, `CHROME_EXTENSION_VERSION`, `CHROME_EXTENSION_SOURCE` in `api/src/config/env.ts`.
- Packaging metadata generated in extension build output: `ui/chrome-ext/copy-assets.js` writes `manifest.json` with package version + `extension-metadata.json`.
- Packaging zip automation added: `ui/chrome-ext/package-extension-zip.js` creates `ui/static/chrome-extension/top-ai-ideas-chrome-extension.zip` with a root folder (`top-ai-ideas-chrome-extension/`).
- Build pipeline hardened for clean CI/container builds:
  - `ui/package.json` `build` now runs `svelte-kit sync && npm run build:ext && vite build`.
  - `ui/chrome-ext/tsconfig.json` added so extension build does not depend on pre-existing `.svelte-kit` files.
  - `ui/Dockerfile` installs `zip` in base image; production extension defaults moved to `Makefile` (`build-ui-image`) via overridable `VITE_EXTENSION_*_BUILD` variables and explicit Docker `--build-arg` forwarding.
- Settings UI integration refined in `ui/src/routes/settings/+page.svelte`:
  - localized developer warning text on Chrome extension card,
  - localized download tooltip,
  - icon CTA aligned with existing icon-button pattern.
- UI/API helper tests added:
  - `api/tests/api/chrome-extension-download.test.ts`
  - `ui/tests/utils/chrome-extension-download.test.ts`
- E2E settings coverage extended in `e2e/tests/06-settings.spec.ts` for download card success/error states.

### Lot N-1 docs consolidation evidence (2026-02-24)
- `BR13-EX2` declared in this file and mirrored in `plan/CONDUCTOR_QUESTIONS.md` before touching conditional paths.
- Spec consolidation done in `spec/SPEC_CHROME_PLUGIN.md`:
  - Added API contract section for `GET /api/v1/chrome-extension/download` (fallback/error/default behavior).
  - Updated build/distribution documentation to reflect current `build:ext` flow and zip output path.
- Roadmap consolidation done in `PLAN.md`:
  - Added `3.0) Branch readiness snapshots` with BR-13 `ready-for-push` status and BR-12 dependency note.

### Lot N final validation command log (2026-02-24)
- `make typecheck-api REGISTRY=local ENV=test-feat-chrome-plugin-download-distribution` -> failed (port collision `0.0.0.0:1080` already allocated).
- `make down REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed (cleanup before rerun).
- `make typecheck-api REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed.
- `make lint-api REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed.
- `make test-api REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed.
  - Non-AI suites passed.
  - AI suites (`tests/ai/**`) passed; no flaky allowlist exception used.
- `make typecheck-ui REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed.
- `make lint-ui REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed.
- `make test-ui REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed (`20` files, `175` tests).
- `make build-api build-ui-image REGISTRY=local API_PORT=8793 UI_PORT=5193 MAILDEV_UI_PORT=1093 ENV=e2e-feat-chrome-plugin-download-distribution` -> passed.
- `make clean REGISTRY=local API_PORT=8793 UI_PORT=5193 MAILDEV_UI_PORT=1093 ENV=e2e-feat-chrome-plugin-download-distribution` -> passed (pre-E2E reset).
- `make test-e2e REGISTRY=local E2E_SPEC=e2e/tests/06-settings.spec.ts WORKERS=2 RETRIES=0 MAX_FAILURES=1 API_PORT=8793 UI_PORT=5193 MAILDEV_UI_PORT=1093 ENV=e2e-feat-chrome-plugin-download-distribution` -> passed (`16` passed, `3` skipped).
- `make clean REGISTRY=local API_PORT=8793 UI_PORT=5193 MAILDEV_UI_PORT=1093 ENV=e2e-feat-chrome-plugin-download-distribution` -> passed (post-E2E reset).
- `TAIL=40 make logs-api REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed (healthy `/api/v1/health` loop).
- `TAIL=40 make logs-ui REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed (UI dev server healthy).
- `curl -s "https://api.github.com/repos/rhanka/top-ai-ideas-fullstack/actions/runs?branch=feat/chrome-plugin-download-distribution&per_page=1"` -> `total_count: 0` (no branch-scoped workflow run currently returned by API).
- `curl -s "https://api.github.com/repos/rhanka/top-ai-ideas-fullstack/actions/runs?per_page=1"` -> latest repository run visible (`main`, `completed`, `success`, run `22333136646`).
- `make down REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed (end-of-lot cleanup).
- `make ps REGISTRY=local API_PORT=8733 UI_PORT=5133 MAILDEV_UI_PORT=1033 ENV=test-feat-chrome-plugin-download-distribution` -> passed (no running services).
- `make down REGISTRY=local API_PORT=8793 UI_PORT=5193 MAILDEV_UI_PORT=1093 ENV=e2e-feat-chrome-plugin-download-distribution` -> passed (explicit E2E cleanup confirmation).
- `make ps REGISTRY=local API_PORT=8793 UI_PORT=5193 MAILDEV_UI_PORT=1093 ENV=e2e-feat-chrome-plugin-download-distribution` -> passed (no running services).
