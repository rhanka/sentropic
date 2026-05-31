# BRANCH: chore/sentropic-codebase-finalization

<!-- STRICT TEMPLATE — no ### headers, no prose paragraphs, checkbox-only tasks. Bugs go in ## Feedback Loop. -->

## Meta
- Branch: `chore/sentropic-codebase-finalization`
- BR-ID: BR-14e
- Base: `main`
- Mode: mono-branch
- ENV: `br14e`
- Ports: API `8714`, UI `5114`, Maildev `1014`

## Objective
- Final Sentropic naming sweep: replace stale `Top AI Ideas` display names and `top-ai-ideas` machine identities across UI/API/build metadata; fix dead extension hosts; classify residuals for BR-14d closure.

## Scope
- In: `ui/`, `api/`, root/app package metadata, self-hosted Chrome/VSCode extension metadata, build image source names, living docs, `PLAN.md`, `plan/14d`, `plan/14e`.
- Out: chat/LLM package architecture already settled by BR-14a/14b/14c; live DNS/serverless decommission already realized by BR-37c/37d; live bucket migration is operator handoff unless credentials are explicitly provided.

## Branch Scope Boundaries
- Allowed Paths:
  - `ui/**`
  - `api/**`
  - `packages/**`
  - `e2e/**`
  - `README.md`
  - `TODO.md`
  - `TRANSITION.md`
  - `docs/**`
  - `spec/BRANCH_SPEC_EVOL.md`
  - `PLAN.md`
  - `plan/14d-BRANCH_chore-sentropic-transition-ops.md`
  - `plan/14e-BRANCH_chore-sentropic-codebase-finalization.md`
  - `BRANCH.md`
- Forbidden Paths:
  - `.cursor/rules/**`
- Conditional Paths:
  - `api/package.json`, `ui/package.json`, `api/package-lock.json`, `ui/package-lock.json` (npm package rename - BR14e-EX1)
  - `ui/chrome-ext/manifest.json`, `ui/vscode-ext/package.json`, `ui/chrome-ext/extension-config.ts`, `ui/vscode-ext/scripts/openvscode-dev-entrypoint.sh` (self-hosted extension identity/storage keys - BR14e-EX2)
  - `Makefile`, `docker-compose*.yml`, `.github/workflows/ci.yml` (source image rename / retag removal - BR14e-EX3)
  - `deploy/k8s/**` (sealed secret or bucket handoff note only if credentials/operator path are confirmed - BR14e-EX4)

## Plan / Todo
- [x] Lot 0: baseline + scope freeze (worktree, branch file, scope measured on main)
- [x] Lot 0: sync PLAN.md + plan/14d (record BR-37c/37d realization of transition ops)
- [x] Lot 0: fold handover finalization scope into plan/14e
- [x] Lot 0: recover interrupted Claude 14e session and fold verified spec decisions into `BRANCH.md` + `plan/14e`
- [x] Lot 1: display-name sweep (`Top AI Ideas` -> `Sentropic`, 44 occurrences / 20 files)
  - [x] Update tests first where assertions pin the old brand: `api/tests/utils/auth-helper.ts`, focused auth/email/report fixtures if present.
  - [x] Update locales `ui/src/locales/fr.json`, `ui/src/locales/en.json`.
  - [x] Update auth email subjects/signatures: `api/src/services/magic-link.ts`, `api/src/services/email-verification.ts`.
  - [x] Update API titles/defaults: `api/src/openapi/export.ts`, `api/src/app.ts`, `api/src/routes/auth/session.ts`, `api/src/services/webauthn-config.ts`.
  - [x] Update DOCX report title: `api/src/services/docx-service.ts`.
  - [x] Update extension display strings and document titles: `ui/vscode-ext/package.json`, `ui/vscode-ext/extension.ts`, `ui/chrome-ext/manifest.json`, `ui/chrome-ext/popup.html`, `ui/chrome-ext/sidepanel.html`, `ui/chrome-ext/content.ts`, `ui/chrome-ext/background.ts`, `ui/chrome-ext/extension-auth.ts`.
  - [x] Update web page titles: `ui/src/routes/+layout.svelte`, `ui/src/routes/dashboard/+page.svelte`.
  - [x] Gate: `make typecheck-api typecheck-ui API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=br14e`; `make lint-api lint-ui API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=br14e`.
- [ ] Lot 2: machine identity + slug + dead-host fix (`top-ai-ideas` -> `sentropic`)
  - [ ] Update tests first where URLs/package IDs/source markers are asserted: `api/tests/**`, `ui/tests/**`, `e2e/tests/06-settings.spec.ts`, `e2e/tests/fixtures/README.md`.
  - [ ] Apply BR14e-EX1: rename app package names `top-ai-ideas-api` -> `sentropic-api`, `top-ai-ideas-ui` -> `sentropic-ui`; regenerate lockfiles through make/Docker only.
  - [ ] Apply BR14e-EX2: rename self-hosted Chrome/VSCode extension IDs, artifact names, storage keys (`topAiIdeas:*` -> `sentropic:*`), DOM host id (`top-ai-ideas-ext` -> `sentropic-ext`), VSCode command/config/runtime prefixes currently using `topai`, and VSCode dev extension id.
  - [x] Fix dead production extension hosts to `https://sentropic.sent-tech.ca` with `/api` where required: `ui/chrome-ext/extension-config.ts`, `ui/chrome-ext/background.ts`, `ui/chrome-ext/content.ts`, `ui/src/lib/components/ChatWidget.svelte`, `ui/chrome-ext/manifest.json`.
  - [x] Update download paths/artifact names: `api/src/routes/api/chrome-extension.ts`, `api/src/routes/api/vscode-extension.ts`, `ui/chrome-ext/package-extension-zip.js`, `ui/vscode-ext/package-vsix.js`.
  - [x] Update import/export `source` marker and locale slug references.
  - [ ] Gate: `make test-api ENV=test-br14e`; `make test-ui ENV=test-br14e`.
- [ ] Lot 3: infrastructure source image rename (BR14e-EX3)
  - [ ] Rename build/source image names to `sentropic-*` in `Makefile`, `docker-compose*.yml`, `.github/workflows/ci.yml`.
  - [ ] Remove now-unneeded CI retag bridge while keeping k8s image names/tags stable.
  - [ ] Verify `deploy/k8s/30-api.yaml` and `deploy/k8s/40-ui.yaml` already reference `sentropic-*`.
  - [ ] Gate: `make build-api build-ui-image API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=br14e`.
- [ ] Lot 4: tests/fixtures + full local gates
  - [ ] Update all remaining brand/slug fixtures in `api/tests/**`, `ui/tests/**`, `e2e/tests/**`, including download URL assertions and fixture docs.
  - [ ] Verify no `.com` vs `.ca` assertion is accidentally changed without behavior reason.
  - [ ] Run `make typecheck-api typecheck-ui ENV=br14e`.
  - [ ] Run `make lint-api lint-ui ENV=br14e`.
  - [ ] Run `make test-api ENV=test-br14e`.
  - [ ] Run `make test-ui ENV=test-br14e`.
  - [ ] Run `make build-api build-ui-image API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=br14e`.
- [ ] Lot 5: living docs + generated/historical exclusions
  - [ ] Update living docs only: `README.md`, `TODO.md`, non-historical `TRANSITION.md` lines.
  - [ ] Exclude historical evidence docs and generated `.graphify/**` from manual rebrand.
  - [ ] Keep business-case references to Top AI Ideas only where they describe the first application running on Sentropic.
- [ ] Lot 6: bucket/operator residual handling (BR14e-EX4 if touched)
  - [ ] Confirm from repo evidence that there is no SQL bucket migration: DB stores bucket-relative `storage_key`; generated job results may persist `storageBucket`.
  - [ ] Produce operator handoff steps for `DOC_STORAGE_BUCKET`: confirm live value, copy objects to `sentropic-docs`, reseal/cutover, verify pre-existing download/export and new upload, delete old bucket only after verification.
  - [ ] Do not change sealed secrets or live buckets unless credentials and explicit operator path are available.
  - [ ] Produce residual-name report for BR-14d including historical docs, in-the-wild export marker compatibility, Google console operator check, old bucket migration, generated `.graphify/**`, and any deferred live ops.
  - [ ] Delete or consolidate `spec/BRANCH_SPEC_EVOL.md` before final validation.
- [ ] Lot N: final validation, UAT, PR
  - [ ] `make typecheck-api typecheck-ui ENV=br14e`
  - [ ] `make lint-api lint-ui ENV=br14e`
  - [ ] `make test-api ENV=test-br14e`
  - [ ] `make test-ui ENV=test-br14e`
  - [ ] `make build-api build-ui-image API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=br14e`
  - [ ] `make clean test-e2e API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=e2e-br14e`
  - [ ] UAT web: landing/login titles, magic-link and verification emails, DOCX report title show `Sentropic`.
  - [ ] UAT Chrome: rebuilt extension displays `Sentropic`, config resolves `sentropic.sent-tech.ca`, auth and tab-tool round-trip work after storage-key reset.
  - [ ] UAT VSCode: rebuilt `.vsix` displays `Sentropic` and chat webview connects.
  - [ ] Push PR with `BRANCH.md` body; verify CI; remove `BRANCH.md` before merge.

## Feedback Loop
- BR14e-Q1: Lot 2 phasing after BR-14a/14b. Owner: user. Status: closed - BR-14a/14b/14c are merged; full sweep proceeds in this branch.
- BR14e-EX1: Package/lockfile rename. Reason: stale app package identities remain `top-ai-ideas-*`. Impact: lockfiles and package metadata change; CI package-bump gate unaffected because no `packages/*/src/**` change is planned. Rollback: revert package metadata and regenerated lockfiles. Status: approved by branch plan.
- BR14e-EX2: Self-hosted extension identity/storage rename. Reason: no public store publication exists; distribution is self-hosted download. Impact: existing local extension users re-auth/re-config; this also clears cached dead-host config. Rollback: revert extension metadata, storage keys, and artifact names. Status: approved by branch plan.
- BR14e-EX3: Source image rename across Makefile/compose/CI. Reason: remove residual `top-ai-ideas-*` source images and retag bridge. Impact: a missed image ref can break build/deploy; build and k8s rollout proof required before merge. Rollback: revert Makefile/compose/CI image-name changes. Status: approved by branch plan.
- BR14e-EX4: Bucket/secret operator path. Reason: old `top-ai-ideas-docs` bucket may remain in sealed runtime config. Impact: live data move requires SCW/cluster credentials and copy-verify-cutover discipline; no DB migration because DB stores bucket-relative keys. Rollback: keep old bucket readable and revert `DOC_STORAGE_BUCKET`. Status: operator handoff unless credentials are explicitly provided.
- BR14e-F1: Codex adversarial review during Claude session failed/retried due model/account/API instability. Status: documented in `spec/BRANCH_SPEC_EVOL.md`; continue with verified local evidence and normal gates.
- BR14e-F2: Lot 1 typecheck/lint gates passed with existing warnings only. Commands: `make typecheck-api typecheck-ui API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=br14e`; `make lint-api lint-ui API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=br14e`. Status: acknowledge.
- BR14e-F3: Lot 2 API slug/download/export targeted gate passed. Commands: `make test-api-unit SCOPE="tests/api/chrome-extension-download.test.ts tests/api/vscode-extension-download.test.ts tests/api/vscode-extension-token.test.ts tests/unit/google-drive-oauth.test.ts tests/api/google-drive-oauth.test.ts tests/api/import-export.test.ts tests/api/workspaces.test.ts" API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-br14e`. Status: acknowledge.
- BR14e-F4: Lot 2 UI host/artifact targeted gates passed. Commands: `make test-ui SCOPE=tests/utils/sentropic-extension-contract.test.ts API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-br14e`; `make test-ui SCOPE=tests/utils/chrome-extension-download.test.ts API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-br14e`; `make test-ui SCOPE=tests/utils/extension-auth-ui.test.ts API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-br14e`; `make exec-ui CMD="node --check chrome-ext/package-extension-zip.js" API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-br14e`; `make exec-ui CMD="node --check vscode-ext/package-vsix.js" API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-br14e`. Status: acknowledge.
