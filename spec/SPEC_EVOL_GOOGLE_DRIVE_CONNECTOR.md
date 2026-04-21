# SPEC EVOL - Google Drive Connector

Status: Draft for BR-16a Lot 0.

Owner branch: `feat/gdrive-sso-indexing-16a`.

Related roadmap entry: BR-16a `feat/gdrive-sso-indexing`.

## Objective

Implement the first document connector slice for Google Drive: user-scoped Google OAuth, Drive file selection, in-situ indexing, and chat retrieval through existing document tooling.

The source document remains in Google Drive. Entropic may store connector metadata, extracted text chunks, embeddings, sync status, and source references, but must not copy the original Drive binary into S3 as the canonical source.

## Non-Goals

- Do not implement SharePoint, OneDrive, or a generic multi-provider connector framework in BR-16a. BR-16b owns that expansion.
- Do not migrate local upload behavior away from S3-compatible storage.
- Do not build automatic background sync, Google Workspace Events, or webhook handling in the MVP.
- Do not request broad Drive scopes unless explicitly approved.
- Do not implement full RAG product behavior outside the `documents` tool integration required for indexed Drive references.

## Current Local Baseline

Current local document flow:

- `api/src/routes/api/documents.ts` accepts local file uploads, stores bytes in S3-compatible storage, inserts `context_documents`, and queues document summary work.
- `api/src/db/schema.ts` defines `contextDocuments` with required `storageKey`, metadata/status, JSONB `data`, and optional `jobId`.
- `api/src/services/tool-service.ts` reads `contextDocuments`, fetches local bytes through `storage-s3`, extracts text, and exposes `documents.list`, `documents.get_summary`, `documents.get_content`, and `documents.analyze`.
- `api/src/services/chat-service.ts` enables the `documents` tool when the active context has attached documents and enforces context matching when tool calls execute.
- `ui/src/lib/utils/documents.ts` exposes list/upload/delete/download helpers for local documents.
- Existing encrypted secret precedent is `api/src/services/provider-connections.ts` plus `api/src/services/secret-crypto.ts`, storing user-scoped encrypted payloads through `settingsService`.

Implication:

- BR-16a must introduce a source-aware document access path. Existing local documents keep `storageKey` and S3 behavior. Google Drive documents use a connector source reference and an extraction/indexing path that does not require a local binary copy.

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

- `context_documents` extensions for source-aware documents:
  - `source_type` = `local | google_drive`
  - `connector_account_id`
  - `external_file_id`
  - `external_url`
  - `external_mime_type`
  - `external_revision_id`
  - `sync_status` = `pending | indexed | stale | failed`
  - `last_synced_at`

- `document_chunks`
  - `id`
  - `document_id`
  - `chunk_index`
  - `content`
  - `embedding`
  - `metadata`
  - `created_at`

Implementation note:

- `context_documents.storage_key` is currently required. BR-16a must either make it nullable for non-local sources or introduce a compatible sentinel strategy with all S3 call sites guarded by `source_type`. Nullable `storage_key` is cleaner but has a wider migration/test surface.

## Content Extraction Strategy

Supported first pass:

- Google Docs: export as Markdown or plain text, then extract text.
- Google Sheets: export as CSV or XLSX depending on current parser support.
- Google Slides: export as plain text or PDF depending on current parser support.
- PDFs and uploaded Drive binaries: download transiently from Drive and extract text in memory; do not persist the binary to S3 as canonical storage.

Constraints:

- `files.export` has export-size limits for Google Workspace documents; indexing must surface `failed` with a clear user-visible error if export is too large.
- Exported/transient bytes should be discarded after extraction.
- Stored chunks must include source metadata sufficient for citation/debug: file ID, name, MIME type, revision/version when available, export MIME, and sync timestamp.

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

## Chat and Retrieval Integration

MVP behavior:

- `documents.list` includes local and Google Drive documents with `source_type`, `sync_status`, and source metadata.
- `documents.get_summary` works after indexing has completed.
- `documents.get_content` reads indexed extracted content/chunks for Google Drive docs instead of S3.
- `documents.analyze` can use extracted indexed content for Google Drive docs.
- Permission checks must preserve existing workspace/context restrictions and additionally verify that the document belongs to a connected account for the current user/workspace.

## UI Surface

Minimum UI:

- A Google Drive connection state in the document panel or settings-adjacent connector panel.
- A "Connect Google Drive" action.
- A Drive file selection action using Google Picker.
- Selected Drive files appear alongside local documents with source and sync status.
- Manual resync and disconnect states.

Avoid in BR-16a:

- Full Drive folder browser.
- Multi-account management UX beyond the current user connection.
- Background sync configuration.

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

- BR16a-Q1: Provide Google Cloud OAuth client ID/secret, redirect URI, consent screen mode, test users, and enabled APIs.
- BR16a-Q2: Confirm default scope: recommended `drive.file` plus Picker. Escalate only if full Drive listing is required.
- BR16a-Q3: Choose token storage: dedicated connector table with encrypted payload vs user-scoped `settings` keys. Recommendation: dedicated connector table for account lifecycle plus encrypted secret payload.
- BR16a-Q4: Confirm sync strategy. Recommendation: manual/on-demand indexing plus explicit resync in MVP.
- BR16a-Q5: Decide whether `storage_key` becomes nullable for `google_drive` source documents, or whether BR-16a uses a guarded sentinel strategy.

## Current Recommendation

Build BR-16a as a narrow Google Drive connector:

- OAuth + Picker + `drive.file`.
- Dedicated connector account state.
- Source-aware document rows.
- In-situ extraction and chunk/index storage.
- Existing `documents` tool as the unified chat access path.

Defer broad Drive scopes, automatic sync, SharePoint/OneDrive, and generic connector UI until the Google Drive slice is merged and validated.
