# Branch Plan Stub: BR-14e Sentropic Codebase Finalization

Current coordination source:

- `spec/SPEC_EVOL_SENTROPIC_BR14_ORCHESTRATION.md`
- Execution file: `tmp/chore-sentropic-codebase-finalization/BRANCH.md`

Branch:

- BR-14e `chore/sentropic-codebase-finalization`

Status (2026-05-31): ACTIVE. Absorbs the `handover-rebrand-top-ai-ideas-to-sentropic` note (the "rebrand Top AI Ideas -> Sentropic" work is this branch, not a new one). BR-14a/14b/14c are merged, so this is a full display + machine identity sweep, not a phased display-only branch. BR-14d ops are already REALIZED via BR-37c/37d (see `plan/14d`); BR-14e owes BR-14d a residual-name report and any name-only residual disposition.

Ordering rule:

- BR-14e runs after BR-14c, BR-14b, and BR-14a have settled package/runtime/chat boundaries (complete as of PR #141, PR #158, PR #164).
- The **display-name** and **package/slug** sweeps both run in this branch because the dependency gates are closed.
- BR-14e runs before any BR-14d closure, so the residual-name report exists when BR-14d is dispositioned.

Canonical name: **`Sentropic`** (exact casing). Domain `sentropic.sent-tech.ca`. WebAuthn `WEBAUTHN_RP_NAME` is already `Sentropic` in the k8s ConfigMap; align code defaults to match.

## Inventory commands

```bash
# Display name (user-facing)
git grep -in "top ai ideas" -- ui/ api/ packages/
# Machine slug
git grep -in "top-ai-ideas" -- ui/ api/ packages/
# Broader residual patterns (needs triage / allowlist)
git grep -inE "TOP_AI|topai|top_ai|@top-ai" -- ui/ api/ packages/
```

Baseline measured on `main` 2026-05-30 and rechecked during Claude 14e recovery: display = **44 occ / 20 files**; slug = **64 occ / 33 files** inside `ui/ api/ packages/`; broader patterns = **552 raw matches** (mostly DB/env/fixture/generated residuals - classify, do not blind-rename); `entropiq` = **0**.

## Lot 1 - Display-name sweep (`Top AI Ideas` -> `Sentropic`), 44 occ / 20 files

- Locales: `ui/src/locales/fr.json` (5), `ui/src/locales/en.json` (5) — landing/welcome titles, `reportTitle`, and the SENT-tech marketing paragraphs (`p1/p2/p3`); substitute the brand only, keep the SENT-tech sentences intact.
- Auth emails (live via Scaleway TEM): `api/src/services/magic-link.ts` (3), `api/src/services/email-verification.ts` (3) — subjects + signatures ("L'équipe Top AI Ideas").
- API surface: `api/src/openapi/export.ts` (OpenAPI title "Top AI Ideas API"), `api/src/app.ts`, `api/src/routes/auth/session.ts`, `api/src/services/webauthn-config.ts` (RP-name default still `'Top AI Ideas'`).
- Report: `api/src/services/docx-service.ts` (2) — "Top AI Ideas Report" / "Rapport Top AI Ideas".
- Extensions (displayName/description/titles): `ui/vscode-ext/package.json` (7), `ui/vscode-ext/extension.ts`, `ui/chrome-ext/manifest.json` (3, name/desc only — NOT the ID), `ui/chrome-ext/popup.html` (2), `ui/chrome-ext/sidepanel.html`, `ui/chrome-ext/content.ts` (3), `ui/chrome-ext/background.ts`, `ui/chrome-ext/extension-auth.ts`.
- Web app titles: `ui/src/routes/+layout.svelte`, `ui/src/routes/dashboard/+page.svelte`.
- Tests asserting the old name: `api/tests/utils/auth-helper.ts` (update fixtures to "Sentropic").

## Lot 2 - Slug/package sweep (`top-ai-ideas`), 64 occ / 33 files

- npm package names + lockfiles: `api/package.json`, `ui/package.json`, `api/package-lock.json`, `ui/package-lock.json` → **BR14e-EX1**.
- Self-hosted extension IDs / config keys: `ui/chrome-ext/manifest.json`, `ui/chrome-ext/extension-config.ts`, `ui/vscode-ext/package.json`, `ui/vscode-ext/scripts/openvscode-dev-entrypoint.sh` → **BR14e-EX2**. No public store publication exists; local users must re-auth/re-config.
- Extension/runtime prefixes currently using `topai` or `topAiIdeas` are part of Lot 2 triage; rename stale project identity to `sentropic*`, but keep only explicitly justified compatibility/runtime identifiers in the residual report.
- OAuth/download paths + clients: `api/src/routes/api/chrome-extension.ts`, `api/src/routes/api/vscode-extension.ts`, `api/src/routes/api/import-export.ts`, `ui/src/lib/config.ts`, `ui/src/lib/core/api-client.ts`, `ui/chrome-ext/{package-extension-zip.js,background.ts,content.ts}`, `ui/vscode-ext/{package-vsix.js,webview-entry.ts}`, `ui/src/lib/components/ChatWidget.svelte`.
- Functional dead-host fix: replace `top-ai-ideas[-api].sent-tech.ca` extension defaults/matches with `sentropic.sent-tech.ca` and `/api` where required.
- Test fixtures: `api/tests/{api,unit}/*.test.ts` (chrome/vscode/google-drive/import-export/workspaces/chat-permissions), `ui/tests/utils/*.test.ts`.
- Locale slug refs: `ui/src/locales/{en,fr}.json` (2 each).
- CI/infra residuals: `SOURCE_*_IMAGE_NAME=top-ai-ideas-*` in `.github/workflows/ci.yml`, `Makefile`, and compose defaults → **BR14e-EX3**.

## Lot 3 - Infra image rename

- Rename build/source image names to `sentropic-*` in `Makefile`, `docker-compose*.yml`, and `.github/workflows/ci.yml`.
- Remove the BR-37 retag bridge while keeping k8s image refs stable (`deploy/k8s/30-api.yaml`, `deploy/k8s/40-ui.yaml` already use `sentropic-*`).
- Grep `IMAGE_NAME` repo-wide before gates.

## Lot 4 - Tests/fixtures + local gates

- Update remaining test fixtures and assertions under `api/tests/**`, `ui/tests/**`, and `e2e/tests/**`, including `e2e/tests/06-settings.spec.ts` download URL assertions and `e2e/tests/fixtures/README.md`.
- Verify no `.com` vs `.ca` assertion is changed without behavior reason.
- Run typecheck, lint, API tests, UI tests, and local image build gates before UAT.

## Lot 5 - Living docs + generated/historical exclusions

- Update living docs only: `README.md`, `TODO.md`, and non-historical `TRANSITION.md` lines.
- Keep historical evidence verbatim (`docs/uat/2026-05-28-decommission-*`, `plan/done/**`).
- Exclude `.graphify/**` generated artifacts from manual edits; record them in the residual report.
- Preserve intentional business-case references where `Top AI Ideas` means the first application built on Sentropic.

## Lot 6 - Bucket/operator residual handling

- Triage the 552 broader-pattern matches: allowed residuals (business-case references, historical docs, already-migrated env var names) vs to-rename.
- Produce the residual-name report consumed by BR-14d closure.
- Bucket note: DB stores bucket-relative `storage_key`, not bucket names; generated job results may keep `storageBucket`, so old completed jobs require keeping the old bucket readable until age-out or verified migration.
- Operator handoff: real `DOC_STORAGE_BUCKET` confirmation, object copy, reseal/cutover, and old-bucket deletion require SCW/cluster credentials; do not delete the old bucket before verification.

## Gotchas (from handover)

- Deploy is automatic: merging to `main` publishes `:main` and `deploy-k8s` rolls it out -> verify live UI + a real email at `sentropic.sent-tech.ca` after merge (not green-CI-only).
- WebAuthn is safe to rebrand: RP **ID** is `sent-tech.ca` (k8s ConfigMap), so changing display/RP-**name** does not invalidate existing passkeys.
- Emails are live (Scaleway TEM): smoke an actual magic-link + verification email after deploy.
- CI is flaky on AI shards / occasional e2e (documented flaky-accepted): rerun the same command on the same commit and record the signature if needed.

Before implementation:

- `BRANCH.md` created from `plan/BRANCH_TEMPLATE.md` (done - lots above mirrored there).
- Temporary design file `spec/BRANCH_SPEC_EVOL.md` recorded the interrupted Claude 14e adversarial pass; it is consolidated into `BRANCH.md` and the BR-14e residual-name report before final validation.
- Operator follow-up (non-blocking, from BR-37d): delete unused GitHub secrets `DATABASE_URL_PROD`, `DB_SSL_CA_PEM_B64`.
