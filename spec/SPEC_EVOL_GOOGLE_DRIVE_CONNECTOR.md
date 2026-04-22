# SPEC EVOL - Google Drive Connector

Status: Draft for BR-16a Lot 0.

Owner branch: `feat/gdrive-sso-indexing-16a`.

Related roadmap entry: BR-16a `feat/gdrive-sso-indexing`.

## Objective

Implement the first document connector slice for Google Drive: user-scoped Google OAuth, Drive file search/selection, in-situ summarization/indexing through the current `document_summary` flow, and chat retrieval through existing document tooling.

The source document remains in Google Drive. Entropic may store connector metadata, source references, sync status, extracted metadata, summaries, and detailed summaries, but must not copy the original Drive binary into S3 as the canonical source.

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
- Use Google Picker's search/browse UI so the user can find Drive documents without Entropic implementing server-side Drive listing in BR-16a.
- Request `https://www.googleapis.com/auth/drive.file` as the default Drive scope.
- Use the OAuth web server flow with `access_type=offline` only if manual resync must work when the user is not actively connected.
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
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/entropic-google-cloud-cdp --no-first-run --no-default-browser-check
```

Fallback if the binary is named `google-chrome`:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/entropic-google-cloud-cdp --no-first-run --no-default-browser-check
```

Codex/Playwright should connect to `http://127.0.0.1:9222`, use the already authenticated Google session, and create/verify the OAuth app configuration with user approval.

### OAuth Client Ports and SDLC URLs

Google OAuth redirect URIs are exact matches, including scheme, host, port, path, and trailing slash. Google Picker and OAuth JavaScript origins also require explicit origins; wildcard ports are not allowed. Local branch ports therefore need to be deterministic and recorded before provisioning.

Use these Google Auth Platform values for BR-16a provisioning:

- App name: `Entropic`.
- Preferred support/contact email: `admin@sent-tech.ca`.
- Temporary support email fallback only if the Google Console selector does not expose `admin@sent-tech.ca`: `fabien.antoine@gmail.com`.
- Test user while the app is in Testing mode: `fabien.antoine@gmail.com`.
- Authorized domain: `sent-tech.ca`.
- Production JavaScript origin: `https://entropic.sent-tech.ca`.
- Production redirect URI: `https://entropic.sent-tech.ca/api/v1/google-drive/oauth/callback`.
- Root local dev/UAT JavaScript origin: `http://localhost:5173`.
- Root local dev/UAT redirect URI: `http://localhost:8787/api/v1/google-drive/oauth/callback`.
- Current BR-16a legacy conductor JavaScript origin: `http://localhost:5116`.
- Current BR-16a legacy conductor redirect URI: `http://localhost:8716/api/v1/google-drive/oauth/callback`.
- BR-16a five-slot sub-agent JavaScript origins: `http://localhost:5280` through `http://localhost:5284`.
- BR-16a five-slot sub-agent redirect URIs: `http://localhost:9080/api/v1/google-drive/oauth/callback` through `http://localhost:9084/api/v1/google-drive/oauth/callback`.

Remote UAT/staging uses hostnames, not local sub-agent ports. When a remote UAT hostname exists, add its exact JavaScript origin and exact callback URI to the OAuth client once and keep local branch ports reserved for development/test lanes only.

The branch-wide port-slot convention is defined in `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, and summarized in `PLAN.md`. New sub-agent launch packets must use the slot convention instead of inventing ad hoc ports.

Provisioning result on 2026-04-22 for Google Cloud project `sent-tech`:

- `picker.googleapis.com` enabled.
- `drive.googleapis.com` enabled.
- Google Auth Platform created for app `Entropic`.
- Support email fallback used: `fabien.antoine@gmail.com`; the console support-email selector did not expose `admin@sent-tech.ca` because it only showed the acting user and no managed Google Group. `admin@sent-tech.ca` was used as the project contact email.
- Audience: External / Testing.
- Test user added: `fabien.antoine@gmail.com`.
- OAuth web client created: `Entropic Web App`.
- OAuth client ID: `924600787940-bc4tfvq52lseekjr090ic2e6k4gl4r8f.apps.googleusercontent.com`.
- API key created: `Entropic Google Picker`; the key value is not recorded in repository docs.
- API key restrictions: HTTP referrers `https://entropic.sent-tech.ca/*`, `http://localhost:5173/*`, `http://localhost:5116/*`, and `http://localhost:5280/*` through `http://localhost:5284/*`.
- API key API restrictions: Google Drive API and Google Picker API.

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

- Google Drive actions next to the existing paperclip/document attach control.
- If disconnected: "Connect Google Drive".
- If connected: "Import from Google Drive" or "Attach from Google Drive" with a Google Drive icon.
- Drive file search/selection uses Google Picker.
- Selected Drive files appear alongside local documents with source and sync status.
- Manual resync and disconnect states.

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

UAT:

- Connect Google account.
- Select one Google Doc through Picker.
- Index it.
- Ask chat a factual question whose answer is present in the selected Drive document.
- Disconnect Google account and confirm the document cannot be refreshed or read from Drive.

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
