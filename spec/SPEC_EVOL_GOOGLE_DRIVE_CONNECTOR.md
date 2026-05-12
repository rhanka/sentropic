# SPEC EVOL - Google Drive Connector

Status: Consolidated after BR-16a UAT.

Owner branch: `feat/gdrive-sso-indexing-16a`.

Related roadmap entry: BR-16a `feat/gdrive-sso-indexing`.

## Objective

BR-16a implements the first document connector slice for Google Drive: user-scoped Google OAuth, Drive file search/selection, in-situ summarization/indexing through the current `document_summary` flow, and chat retrieval through existing document tooling.

The source document remains in Google Drive. Sentropic may store connector metadata, source references, sync status, extracted metadata, summaries, and detailed summaries, but must not copy the original Drive binary into S3 as the canonical source.

## Final BR-16a Contract

- Google Drive is a user-scoped connector. Each Sentropic user connects their own Google account for a workspace; shared Drive documents are attachable only when the acting Google account already has access.
- Settings owns connector lifecycle (`Connect` / `Disconnect`) and public readiness. Chat and entity document surfaces only import documents from the connected source.
- Google Picker is the BR-16a selection surface. The backend resolves Picker file IDs, verifies metadata/access, and stores source references in `context_documents`.
- Local uploads stay S3-backed. Google Drive documents stay in situ with `source_type=google_drive`, nullable `storage_key`, connector account linkage, Drive file IDs, visible source metadata, sync status, and summary fields.
- The existing `document_summary` queue remains the indexing path. BR-16a adds source-aware document loading but does not add stored chunks, embeddings, or semantic vector retrieval.
- Native Google Workspace ingestion is text-first for summaries and tools. User downloads are separate reusable exports: Google Docs to DOCX, Google Sheets to XLSX, and Google Slides to PPTX.
- Public connection status validates token readiness, refreshes expired access tokens when possible, and reports a disconnected/error state when authorization cannot be refreshed.
- The `documents` API/tooling remains the unified surface for local and Google Drive documents.
- SharePoint/OneDrive, sharing assistance, change notifications/polling, and direct Google Docs/Slides editing tools remain deferred to later connector branches.

## Non-Goals

- Do not implement SharePoint, OneDrive, or a generic multi-provider connector framework in BR-16a. BR-16b owns that expansion.
- Do not migrate local upload behavior away from S3-compatible storage.
- Do not build automatic background sync, Google Workspace Events, or webhook handling in the MVP.
- Do not request broad Drive scopes unless explicitly approved.
- Do not implement full RAG product behavior, stored embeddings, or semantic vector retrieval in BR-16a.
- Do not implement Google Drive sharing assistance, shared-drive collaboration refinements, or direct Google Docs/Slides editing tools in BR-16a. BR-16c owns that follow-up.

## Current Local Baseline

Current local document flow:

- `api/src/routes/api/documents.ts` accepts local file uploads, stores bytes in S3-compatible storage, inserts `context_documents`, and queues document summary work.
- `api/src/db/schema.ts` defines `contextDocuments` with required `storageKey`, metadata/status, JSONB `data`, and optional `jobId`.
- `api/src/services/queue-manager.ts` processes `document_summary` jobs by loading document bytes, calling `extractDocumentInfoFromDocument`, generating a summary, and storing `summary`, `summaryLang`, extracted metadata, and optional `detailedSummary` in `context_documents.data`.
- `api/src/services/tool-service.ts` reads `contextDocuments`, fetches local bytes through `storage-s3`, extracts text, and exposes `documents.list`, `documents.get_summary`, `documents.get_content`, and `documents.analyze`.
- For very long documents, `documents.analyze` uses runtime chunking and merge calls. It does not use stored embeddings.
- `api/src/services/chat-service.ts` enables the `documents` tool when the active context has attached documents and enforces context matching when tool calls execute.
- `ui/src/lib/utils/documents.ts` exposes list/upload/delete/download helpers for local documents.
- Existing encrypted secret precedent is `api/src/services/provider-connections.ts` plus `api/src/services/secret-crypto.ts`, storing user-scoped encrypted payloads through `settingsService`.

Implication:

- BR-16a must introduce a source-aware document access path. Existing local documents keep `storageKey` and S3 behavior. Google Drive documents use a connector source reference and the same queue/tool semantics, with Drive export/download replacing S3 byte loading when the source is Google Drive.
- BR-16a must also separate **ingestion exports** from **user download exports** for native Google Workspace files:
  - ingestion remains text-first for the summarization/RAG pipeline (`Google Docs -> Markdown`, `Sheets -> CSV`, `Slides -> plain text`);
  - user-facing downloads must export native Google Workspace files to reusable Office binaries (`Google Docs -> DOCX`, `Sheets -> XLSX`, `Slides -> PPTX`) and preserve the source filename instead of leaking internal `.md/.csv/.txt` artifacts;
  - document download responses must expose `Content-Disposition` to the browser and include both ASCII `filename` and UTF-8 `filename*` attachment metadata so the UI download helper can save the source filename instead of falling back to a technical identifier.

## Official Google References

- Drive scopes and sensitivity: https://developers.google.com/drive/api/guides/api-specific-auth
- OAuth 2.0 web server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Google Picker overview: https://developers.google.com/drive/picker/guides/overview
- Google Picker display guide: https://developers.google.com/drive/api/guides/picker
- Google Workspace Drive MIME types: https://developers.google.com/workspace/drive/api/guides/mime-types
- Export MIME types: https://developers.google.com/workspace/drive/api/guides/ref-export-formats
- `files.export`: https://developers.google.com/drive/api/v3/reference/files/export

## OAuth and Scope Strategy

Recommended MVP:

- Use Google Picker for user selection.
- Use Google Picker's search/browse UI so the user can find Drive documents without Sentropic implementing server-side Drive listing in BR-16a.
- Request `https://www.googleapis.com/auth/drive.file` as the default Drive scope.
- Use the OAuth web server flow with `access_type=offline` so manual resync, downloads, and tool reads can refresh authorization after the browser session token expires.
- Use `include_granted_scopes=true`.
- Keep `state` signed and scoped to `{ userId, workspaceId, nonce, returnPath }`.

Rationale:

- Google recommends the narrowest scopes possible.
- `drive.file` is the non-sensitive per-file scope suitable for files opened or selected by the user through Picker.
- Broad scopes such as `drive.readonly`, `drive.metadata.readonly`, and `drive` are restricted and can require heavier verification/security review.

Open decision:

- If the UX requires server-side browsing/listing without Picker, BR-16a must explicitly escalate scope review because metadata/listing scopes can become restricted.

## Google Cloud Provisioning via Playwright MCP

Decision BR16a-Q2: Codex performs Google Cloud provisioning through Playwright MCP attached to a user-launched Chromium CDP session.

User command for a dedicated Chromium CDP session:

```bash
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/sentropic-google-cloud-cdp --no-first-run --no-default-browser-check
```

Fallback if the binary is named `google-chrome`:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/sentropic-google-cloud-cdp --no-first-run --no-default-browser-check
```

Codex/Playwright should connect to `http://127.0.0.1:9222`, use the already authenticated Google session, and create/verify the OAuth app configuration with user approval.

### OAuth Client Ports and SDLC URLs

Google OAuth redirect URIs are exact matches, including scheme, host, port, path, and trailing slash. Google Picker and OAuth JavaScript origins also require explicit origins; wildcard ports are not allowed. Local branch ports therefore need to be deterministic and recorded before provisioning.

Use these Google Auth Platform values for BR-16a provisioning:

- App name: `Sentropic`.
- Preferred support/contact email: `admin@sent-tech.ca`.
- Temporary support email fallback only if the Google Console selector does not expose `admin@sent-tech.ca`: `fabien.antoine@gmail.com`.
- Test user while the app is in Testing mode: `fabien.antoine@gmail.com`.
- Authorized domain: `sent-tech.ca`.
- Current production JavaScript origin: `https://top-ai-ideas.sent-tech.ca`.
- Current production redirect URI: `https://top-ai-ideas-api.sent-tech.ca/api/v1/google-drive/oauth/callback`.
- Future canonical `sentropic.sent-tech.ca` hostnames remain part of the BR-14d DNS/runtime transition and must not be used by BR-16a CD until they resolve and route to the app/API.
- Root local dev/UAT JavaScript origin: `http://localhost:5173`.
- Root local dev/UAT redirect URI: `http://localhost:8787/api/v1/google-drive/oauth/callback`.
- BR-16a five-slot sub-agent JavaScript origins: `http://localhost:5280` through `http://localhost:5284`.
- BR-16a five-slot sub-agent redirect URIs: `http://localhost:9080/api/v1/google-drive/oauth/callback` through `http://localhost:9084/api/v1/google-drive/oauth/callback`.
- Every branch slot that starts the API for live OAuth must set `GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL=http://localhost:<API_PORT>` so the runtime emits the exact registered redirect URI. For BR-16a slot 0, use `GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL=http://localhost:9080`.

Remote UAT/staging uses hostnames, not local sub-agent ports. When a remote UAT hostname exists, add its exact JavaScript origin and exact callback URI to the OAuth client once and keep local branch ports reserved for development/test lanes only.

The branch-wide port-slot convention is defined in `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, and summarized in `PLAN.md`. New sub-agent launch packets must use the slot convention instead of inventing ad hoc ports.

Provisioning result on 2026-04-22 for Google Cloud project `sent-tech`:

- `picker.googleapis.com` enabled.
- `drive.googleapis.com` enabled.
- Google Auth Platform created for app `Sentropic`.
- Support email fallback used: `fabien.antoine@gmail.com`; the console support-email selector did not expose `admin@sent-tech.ca` because it only showed the acting user and no managed Google Group. `admin@sent-tech.ca` was used as the project contact email.
- Audience: External / Testing.
- Test user added: `fabien.antoine@gmail.com`.
- OAuth web client created: `Sentropic Web App`.
- OAuth client ID: `924600787940-bc4tfvq52lseekjr090ic2e6k4gl4r8f.apps.googleusercontent.com`.
- API key created: `Sentropic Google Picker`; the key value is not recorded in repository docs.
- API key restrictions: HTTP referrers `https://top-ai-ideas.sent-tech.ca/*`, future `https://sentropic.sent-tech.ca/*` once BR-14d activates DNS/routing, `http://localhost:5173/*`, and `http://localhost:5280/*` through `http://localhost:5284/*`.
- API key API restrictions: Google Drive API and Google Picker API.
- Obsolete local port entries `http://localhost:5116`, `http://localhost:8716/api/v1/google-drive/oauth/callback`, and `http://localhost:5116/*` were removed from Google Cloud on 2026-04-22.

### Runtime Credential Bootstrap (traceable)

Provisioning in Google Cloud is not enough. The target runtime must also expose or store these values so BR-16a can run live:

- `GOOGLE_DRIVE_CLIENT_ID` or setting `google_drive_oauth_client_id`
- `GOOGLE_DRIVE_CLIENT_SECRET` or setting `google_drive_oauth_client_secret`
- `GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL` or setting `google_drive_oauth_callback_base_url`
- `GOOGLE_DRIVE_PICKER_API_KEY` or setting `google_drive_picker_api_key`
- optional `GOOGLE_DRIVE_PICKER_APP_ID` or setting `google_drive_picker_app_id` (the backend derives the Google Cloud numeric app ID from the OAuth client ID when omitted)

Local runtime note:

- The live UAT runtime must pass these values into the API container explicitly. In the current local setup, that means `docker-compose.yml` must forward `GOOGLE_DRIVE_*` plus `AUTH_CALLBACK_BASE_URL`; otherwise the branch code compiles but the live OAuth/Pickers paths stay untestable.

Production runtime note:

- BR-16a does not change the GitHub CD deployment model. `deploy-api` must keep the historical image-deploy behavior and must not push Scaleway container-level `secret-environment-variables`.
- Production Google Drive runtime secrets are provisioned at the Scaleway namespace level, aligned with the existing production secret model used by database/TLS, mail, auth, model-provider, storage, and webauthn settings.
- The required Google Drive runtime keys are `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL`, `GOOGLE_DRIVE_PICKER_API_KEY`, and optional `GOOGLE_DRIVE_PICKER_APP_ID`.
- Current routed production values use the web origin `https://top-ai-ideas.sent-tech.ca` and API callback base `https://top-ai-ideas-api.sent-tech.ca` until BR-14d completes the `sentropic.sent-tech.ca` DNS/runtime transition.
- Before BR-16a is remerged, the cleaned branch must pass an out-of-CD production deployment validation that proves API boot/migrations, mail sending, Google OAuth, Picker, Drive import, indexing, and download behavior, followed by rollback unless the user explicitly keeps the branch image for UAT.

Traceable proof commands on a target runtime:

1. Record authenticated Playwright state against the runtime with a verified user:

```bash
make exec-playwright-dev CMD="DEV_PLAYWRIGHT_AUTH_EMAIL=<verified-user-email> npx playwright test --config playwright.dev.config.ts tests/dev/00-record-auth.spec.ts --workers=1 --retries=0 --reporter=list --grep '<verified-user-email>'" PLAYWRIGHT_DEV_UI_PORT=<playwright-ui-port> API_PORT=<api-port> UI_PORT=<ui-port> MAILDEV_UI_PORT=<maildev-port> ENV=<env>
```

2. Run the live-readiness browser/API probe:

```bash
make test-e2e-dev E2E_SPEC=e2e/tests/dev/01-google-drive-live-readiness.spec.ts PLAYWRIGHT_DEV_UI_PORT=<playwright-ui-port> API_PORT=<api-port> UI_PORT=<ui-port> MAILDEV_UI_PORT=<maildev-port> ENV=<env>
```

Expected outcomes:

- If credentials are still missing, the spec proves the current UX branch by asserting the inline error `Google Drive OAuth is not configured.` after clicking `Connect Google Drive`.
- If OAuth credentials are present, the spec proves readiness by asserting that the connect action leaves the current page and targets Google OAuth.
- If an account is already connected, the spec proves the connected branch and picker readiness probe (`200` with picker config, or `503` with explicit picker misconfiguration).

Validation boundary:

- This traceable readiness flow proves credential/bootstrap correctness, connected-account persistence, and whether the chat composer can leave the app toward Google or surface a deterministic inline error.
- It does not replace the final Lot 5 product UAT for selecting a real Drive file, indexing it, and retrieving facts through chat.

Observed lane caveat on 2026-04-27:

- The generic helper target `make record-dev-playwright-auth ...` is not sufficient evidence on the BR-16a seeded lane because its default lane user `admin@sent-tech.ca` currently has `users.email_verified=false`, which produces a session cookie later rejected by `validateSession()`.
- The verified seeded user `e2e-user-a@example.com` is suitable for branch-lane traceable proof. This is only for branch-lane validation; root UAT must still use the real target user/session after live Google credentials are injected.

## Proposed Data Model

Minimum durable objects:

- `document_connector_accounts`
  - `id`
  - `workspace_id`
  - `user_id`
  - `provider` = `google_drive`
  - `status` = `connected | disconnected | error`
  - `account_email`
  - `account_subject`
  - `scopes`
  - `token_secret_ref` or encrypted token payload
  - `created_at`, `updated_at`, `last_error`

Settings integration:

- `document_connector_accounts` is the source of truth for per-user/per-workspace Google account state.
- Public connection readiness must validate the encrypted token material, refresh expired access tokens when possible, and report `status=error` / `connected=false` when authorization has expired, been revoked, or cannot be refreshed.
- Refresh failures must store a sanitized `last_error` and clear unusable token material when Google rejects the refresh token, so Settings cannot show a stale connected state while Drive operations fail.
- `settings` remains the place for global connector configuration and encrypted/admin-managed OAuth client configuration when not provided by environment variables.
- Do not duplicate account lifecycle state in `settings`.
- Account rows must reference the same workspace/user concepts already used by app settings, RBAC, and document contexts.

- `context_documents` extensions for source-aware documents:
  - `source_type` = `local | google_drive`
  - `connector_account_id`
  - `external_file_id`
  - `external_url`
  - `external_mime_type`
  - `external_revision_id`
  - `sync_status` = `pending | indexed | stale | failed`
  - `last_synced_at`

Implementation note:

- `context_documents.storage_key` is currently required. BR-16a must either make it nullable for non-local sources or introduce a compatible sentinel strategy with all S3 call sites guarded by `source_type`. Nullable `storage_key` is cleaner but has a wider migration/test surface.

### Q5 Schema Clarification

`context_documents.storage_key` currently means "object key in S3-compatible storage." Google Drive rows do not have an S3 object key if documents remain in situ.

Options:

- 5A: Add `source_type` and make `storage_key` nullable. This keeps one document table and makes the invariant honest: local docs have S3 keys; Drive docs have Drive refs. It requires auditing every S3 call site and guarding by source type.
- 5B: Keep `storage_key` required and store a sentinel such as `gdrive://<fileId>`. This reduces migration shape but creates a misleading value and risks accidental S3 calls unless every path is guarded.
- 5C: Keep `context_documents` local-only and add a separate linked Google document table. This avoids nullable `storage_key` but creates a split document model and more joins for the `documents` tool.

Decision: 5A selected for BR-16a.

## Content Extraction Strategy

Supported first pass:

- Google Docs: use Drive `files.export` to Markdown or plain text, then pass text into the existing extraction/summarization path.
- Google Sheets: use Drive `files.export` to CSV or XLSX depending on parser support; if multi-sheet export is needed, define sheet handling explicitly before implementation.
- Google Slides: use Drive `files.export` to plain text or PDF depending on fidelity needs; text extraction is enough for BR-16a summarization.
- PDFs, DOCX, PPTX, and other uploaded Drive binaries: use Drive download transiently, then pass bytes into `extractDocumentInfoFromDocument`. Do not persist the binary to S3 as canonical storage.
- Text-like files: download transiently and decode like current text/markdown handling.

Constraints:

- `files.export` has export-size limits for Google Workspace documents; indexing must surface `failed` with a clear user-visible error if export is too large.
- Exported/transient bytes should be discarded after extraction.
- Stored metadata must include source information sufficient for citation/debug: file ID, name, MIME type, revision/version when available, export MIME, and sync timestamp.
- User-visible document lists must keep source-facing metadata, not export-facing metadata:
  - filename = Drive source name
  - type label = source Drive MIME / Google Workspace type
  - export suffixes such as `.md`, `.csv`, and `.txt` must not leak into list surfaces
- `files.size` from the Drive file resource should be treated as the official visible size when Google provides it, including for native Google Workspace files; the exported Markdown / CSV / plain-text artifact remains internal and must not replace the source-facing size in list surfaces.

Deferred to BR-16c:

- Direct Google Docs editing tool equivalent to the current DOCX/freeform publishing path.
- Google Slides/PPT generation or editing tool equivalent to `pptxgenjs`/presentation generation.
- Workspace sharing assistance for Drive docs.
- Change detection UX and automatic summary regeneration policies.

## API Surface

Candidate routes:

- `GET /api/v1/google-drive/connection`
- `POST /api/v1/google-drive/oauth/start`
- `GET /api/v1/google-drive/oauth/callback`
- `POST /api/v1/google-drive/disconnect`
- `POST /api/v1/google-drive/files/resolve-picker-selection`
- `POST /api/v1/documents/google-drive`
- `POST /api/v1/documents/:id/resync`

The `documents` API should remain the unified document surface for chat contexts. Google-specific routes handle OAuth, account state, and Drive file metadata resolution.

Search policy:

- BR-16a search happens through Google Picker in the browser.
- The backend resolves selected file IDs and verifies metadata/access.
- Server-side Drive search/listing is not part of BR-16a unless the scope decision is reopened.

## Chat and Retrieval Integration

MVP behavior:

- `documents.list` includes local and Google Drive documents with `source_type`, `sync_status`, and source metadata.
- `documents.get_summary` works after the existing `document_summary` queue has completed.
- `documents.get_content` loads Drive content on demand through export/download when full content is needed.
- `documents.analyze` loads Drive content on demand and uses existing runtime chunking/merge behavior for long documents.
- Permission checks must preserve existing workspace/context restrictions and additionally verify that the document belongs to a connected account for the current user/workspace.

No stored embeddings are introduced in BR-16a.

## UI Surface

Minimum UI:

- Settings owns Google Drive connection lifecycle for the current user/workspace.
- Chat and entity document surfaces own document import only.
- Google Drive import actions live next to the existing document attach controls.
- If disconnected, Google Drive import actions must not silently fail; they must direct the user toward the settings connector surface.
- Drive file search/selection uses Google Picker.
- Selected Drive files appear alongside local documents with source and sync status.
- Manual resync remains available on the unified document surfaces.

Current UI baseline relevant to the BR-16a UX follow-up:

- `ui/src/routes/settings/+page.svelte` uses top-level settings cards with `rounded border border-slate-200 bg-white p-6`, then nested neutral cards (`rounded border border-slate-200 bg-slate-50 p-3/p-4`) for sub-sections.
- The closest existing pattern for connector status/configuration is the admin-only provider connections card in settings. It already shows per-provider readiness, account label, lifecycle buttons, and inline error text.
- `ui/src/lib/components/MenuPopover.svelte` is the canonical lightweight popover menu component already reused by the chat composer and other UI menus.
- `ui/src/lib/components/ChatPanel.svelte` currently mixes three concerns inside one composer menu: local file upload, Google Drive connection lifecycle, and Google Drive import.
- `ui/src/lib/components/DocumentsBlock.svelte` is reused on folders, organizations, initiatives, and creation flows, but today exposes only local file upload.
- `ui/src/lib/components/FileMenu.svelte` is not the right abstraction for BR-16a document sources: it is an action menu (`new/import/export/delete`), not a source selector (`local file` vs `Google Drive`).

Current BR-16a implementation status after UAT:

- The visible "Import from Google Drive" entry is live and attaches Drive selections to the chat session document list.
- Google Drive lifecycle ownership now lives in a user-scoped Settings `Connectors` card rather than the chat composer.
- `DocumentsBlock` now exposes the same source choices as the chat composer (`From computer` / `From Google Drive`) through the same shared source-menu contract.
- Deterministic browser validation now exists without live Google secrets:
  - `e2e/tests/04-google-drive-composer.spec.ts` covers the import-only chat composer path plus the redirect to Settings when the user is disconnected.
  - `e2e/tests/04-google-drive-settings-documents.spec.ts` covers Settings lifecycle actions and `DocumentsBlock` source-menu visibility/routing.
- Live root pre-UAT validation is now completed on the target runtime. The real Google OAuth path was exercised end to end with a connected user account, working picker config, live Google Picker listing, and a real Drive file attachment back into the chat composer.
- User UAT is accepted for BR-16a on the root runtime with the real Google account, real Drive documents, native Google Workspace imports/downloads, indexing, retrieval, and disconnect behavior.

Implemented UX delta for BR-16a:

- Add a new user-visible `Connectors` section to settings.
  - This section must follow the existing settings card style, not invent a special layout.
  - The Google Drive card now shows connection state, connected account label/email when available, lifecycle CTA (`Connect` or `Disconnect`), and inline error text when lifecycle actions fail.
  - This card is user-scoped, not admin-only. It complements rather than replaces the existing admin provider-connections area.
- Move Google Drive lifecycle ownership out of the chat composer.
  - The chat composer now keeps Google Drive import only.
  - `Disconnect Google Drive` is removed from the chat composer menu.
  - When disconnected, Google Drive import actions remain discoverable and route the user toward the settings connector surface instead of embedding lifecycle controls inline in the chat menu.
  - The disconnected CTA copy is explicit (`Connect Google Drive in Settings`) and deep-links to the connector card anchor (`/settings#google-drive-connectors`) instead of a generic Settings landing.
- Generalize the `+` document affordance across chat and entity document surfaces.
  - Chat composer and `DocumentsBlock` now expose the same source choices: `From computer` and `From Google Drive`.
  - `MenuPopover` is reused for this source chooser.
  - BR-16a now uses a thin shared `DocumentSourceMenu.svelte` wrapper on top of `MenuPopover`; `FileMenu.svelte` remains untouched.
  - Keep backend contracts unchanged at the transport level: local upload continues through `/documents`, Google Drive attach continues through `/documents/google-drive`.
  - Both surfaces must refresh Google Drive connection state when the source menu opens, so a reconnect performed in Settings is reflected immediately without a root reload.
- Navigation implementation detail for the web app:
  - Shared surfaces (`ChatPanel`, `DocumentsBlock`) keep using the repo navigation adapter, not direct `$app/navigation` imports, so the Chrome extension build remains unaffected.
  - The SvelteKit root layout must initialize that adapter so web-app deep-links use client-side `goto` instead of `window.location.href`.

Avoid in BR-16a:

- Full Drive folder browser.
- Multi-account management UX beyond the current user connection.
- Background sync configuration.
- Direct Google Docs/Slides editing.

## Test Plan

Unit/API tests:

- OAuth start builds signed state and requested scopes.
- OAuth callback rejects invalid state and stores encrypted token payload.
- Disconnect removes token material and marks account disconnected.
- Picker selection resolution persists a Google Drive document reference.
- Indexing service extracts supported Google source types through mocked Drive clients.
- `documents` tool returns Google Drive docs in list and reads indexed content without S3 calls.
- Permission-denied cases for disconnected users, wrong workspace, wrong context, and stale connector account.

UI tests:

- Connection state helper renders connected/disconnected/error states.
- File selection helper calls the right API and includes credentials/auth headers.
- Document list displays source and sync status.
- Browser-grade mocked UX validation lives in `e2e/tests/04-google-drive-composer.spec.ts` and covers connect, mocked picker import, disconnect, and OAuth configuration errors inside the composer.
- Settings tests must cover the user-scoped Google Drive connector card state (`disconnected`, `connected`, lifecycle pending/error) using the same card conventions already present on the settings page.
- Document-surface tests must cover the shared source chooser contract on `DocumentsBlock` and the chat composer (`From computer` vs `From Google Drive`), plus the absence of a disconnect CTA in chat.

UAT:

- Open Settings and verify the new `Connectors` section follows the existing settings card style.
- Connect Google account from Settings.
- Confirm the callback returns to the UI host, not the API host.
- Return to Settings and verify connected state plus account label/email.
- Open the chat composer and confirm Google Drive import is available there without any disconnect action.
- When disconnected, click the chat/DocumentsBlock CTA and confirm the app lands directly on `Settings > Google Drive`, without a full-page reload blink.
- Select one Google file through Picker from the chat composer and attach it.
- Open one entity document surface (`DocumentsBlock` on folder, organization, or initiative) and verify the `+` affordance exposes both local upload and Google Drive import.
- Select one Google file through Picker from an entity document surface and attach it.
- Index at least one selected file.
- Ask chat a factual question whose answer is present in the selected Drive document.
- Disconnect Google account from Settings and confirm Google Drive import paths no longer proceed until reconnection.

## Open Decisions Before Implementation

Current validation: `1A 2A 3C 4A 5A 6A 7B 8A-revised 9A 10A`.

| Code | Decision | Options |
| --- | --- | --- |
| 1 | Drive selection and OAuth scope | 1A selected: Google Picker + `drive.file`, with search through Picker. |
| 2 | Google Cloud provisioning | 2A selected: Codex provisions through Playwright MCP over user-launched Chromium CDP. |
| 3 | Google account ownership | 3C selected: each user connects Google; shared files/drives respect the acting user's Google rights. Sharing assistance deferred to BR-16c. |
| 4 | Token storage | 4A selected: dedicated connector account table plus encrypted token payload, linked to settings for global connector config. |
| 5 | Non-local document schema | 5A selected: nullable `storage_key` + `source_type`. |
| 6 | Sync strategy | 6A selected for BR-16a: manual/on-demand indexing + explicit resync. BR-16c refines notifications/polling and queued summary regeneration. |
| 7 | MVP formats | 7B selected: Docs, Sheets, Slides, PDFs, and text-like files, with Google export for native files and current generalist parser for binaries. |
| 8 | Indexing depth | 8A revised selected: extend current `document_summary` flow, no embeddings. |
| 9 | UI entry point | 9A selected: Google Drive action next to paperclip in the existing document panel. |
| 10 | Local branch naming | 10A selected: keep `feat/gdrive-sso-indexing-16a`. |

## Current Recommendation

Build BR-16a as a narrow Google Drive connector:

- OAuth + Picker search + `drive.file`.
- Dedicated connector account state.
- Source-aware document rows.
- Source-aware `document_summary` indexing: extracted metadata, summary, detailed summary, sync status, and source refs.
- Existing `documents` tool as the unified chat access path.

Defer broad Drive scopes, automatic sync, SharePoint/OneDrive, direct Google Docs/Slides editing, Google sharing assistance, and generic connector UI until the Google Drive slice is merged and validated.
