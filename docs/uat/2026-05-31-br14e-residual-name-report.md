# BR-14e Residual Name Report

Branch: `chore/sentropic-codebase-finalization`
Date: 2026-05-31

## Closed In BR-14e

- User-facing application name defaults now use `Sentropic`.
- API/UI npm package identities and lockfiles now use `sentropic-*`.
- Chrome and VSCode self-hosted extension metadata, artifact names, storage keys, command/config/runtime namespaces, and dead production hosts now use `sentropic`.
- Build and CI source image names now build directly as `sentropic-api`, `sentropic-ui`, and `sentropic-e2e`; the CI retag bridge was removed.
- Local dev/test document buckets now default to `sentropic-docs-dev` and `sentropic-docs-test`.

## Intentional Repo Residuals

| Category | Paths | Reason | Disposition |
| --- | --- | --- | --- |
| Business-case references | `README.md`, selected product/spec docs | `Top AI Ideas` remains the name of the first business application running on Sentropic. | Keep. Do not rewrite as project identity. |
| Historical evidence | `docs/uat/2026-05-28-decommission-top-ai-ideas-37d.md`, `plan/done/**`, older branch plans | These are audit records of already executed work. | Keep verbatim. |
| Regression guards | `api/tests/unit/auth/*`, `ui/tests/utils/*` | Tests assert old names do not reappear. | Keep as negative guards. |
| CSS/runtime compatibility identifiers | `ui/src/app.css`, `ui/src/lib/stores/themePreference.ts`, `ui/src/lib/components/ChatWidget.svelte`, `ui/src/lib/components/chat/AppChatPanel.svelte`, `ui/vscode-ext/extension.ts`, `ui/vscode-ext/webview-entry.ts`, related tests | `topai-theme-*`, `topai-chat-*`, and `topai-vscode-root` are stylesheet/container identifiers, not public brand, package, command, or config identity. | Keep for BR-14e. Rename only in a dedicated CSS compatibility pass with visual regression checks. |
| Upstream protocol fixture identifiers | `api/src/upstream/injected-script.ts`, `ui/src/lib/upstream/*`, `ui/tests/upstream/*` | `__topai_bridge`, `__topai_badge`, and `topai.chrome.runtime` are internal bridge/protocol identifiers from the upstream-tooling layer. | Keep for BR-14e. Rename only with upstream protocol migration coverage. |
| Generated artifacts | `.graphify/**` if regenerated locally | Generated inventory output will reintroduce old historical strings. | Exclude from manual edits; regenerate after naming work if needed. |

## Operator Residuals

- Live `DOC_STORAGE_BUCKET` is provided by sealed/runtime configuration, not by SQL schema. Repo evidence: documents store bucket-relative `storage_key`; `getDocumentsBucketName()` resolves the bucket from env at read time.
- No SQL migration is required for uploaded documents.
- Generated DOCX/PPTX job results may persist `storageBucket`; old completed jobs can point at the old bucket, so the old bucket must stay readable through the cutover window.
- Operator handoff for live bucket migration:
  1. Confirm current live `DOC_STORAGE_BUCKET` from the cluster.
  2. Create the target bucket, expected name `sentropic-docs`.
  3. Copy all objects preserving keys.
  4. Reseal/cut over `DOC_STORAGE_BUCKET=sentropic-docs`.
  5. Verify download/export of a pre-existing document and upload/download of a new document.
  6. Delete the old bucket only after verification and rollback-window expiry.
- Google Cloud OAuth redirect/client allowlists are out-of-repo state. Confirm `https://sentropic.sent-tech.ca/api/v1/google-drive/oauth/callback` is present and old hostnames are removed or retained only as intentional redirects.

## BR-14d Closure Input

BR-14d transition operations are already realized by BR-37c/BR-37d for DNS, k8s, serverless, database, and deploy workflow cleanup. After BR-14e, the remaining non-git handoff is the document-bucket migration and out-of-repo console verification above.
