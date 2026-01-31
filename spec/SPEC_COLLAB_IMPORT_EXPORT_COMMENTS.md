# SPEC: Collaboration Import/Export + Comments (Generic ZIP)

## Objective
Provide a generic import/export mechanism for collaboration data using a standard `.zip` archive with JSON payloads, independent of product branding, while preserving workspace scoping, documents, and comments.

## Scope
- Comments (create/reply/assign/close) for any object section.
- Import/Export as a generic ZIP format with JSON files and a manifest.
- Support export/import scopes: `workspace`, `folder`, `usecase`, `organization`, `matrix`.
- Optional inclusion of comments and documents.

## Non-Goals
- Cryptographic signing with public/private keys (integrity only, not authenticity).
- Multi-level threaded comments (one-level replies only).

## Archive Format (ZIP)

### Top-Level Structure
```
manifest.json
meta.json
workspaces.json
workspace_memberships.json
organizations.json
folders.json
use_cases.json
matrix.json
comments.json
documents/
  <workspace_id>/<context_type>/<context_id>/<document_id>-<filename>
```

### JSON Files
- `*.json` files are standard JSON.
- Each file contains either an array of objects or a single object, depending on scope.
- The archive contents are sufficient to map all relations without relying on filenames.

### Manifest
`manifest.json` contains:
```
{
  "export_version": "1.0",
  "schema_version": "<drizzle_migration_id>",
  "created_at": "2026-01-28T00:00:00Z",
  "scope": "workspace|folder|usecase|organization|matrix",
  "scope_id": "<id|null>",
  "include_comments": true,
  "include_documents": true,
  "files": [
    { "path": "organizations.json", "bytes": 1234, "sha256": "<hash>" }
  ],
  "manifest_hash": "<sha256 of manifest without manifest_hash>"
}
```

### Meta
`meta.json` contains human-readable metadata (optional):
```
{
  "title": "Exported workspace data",
  "notes": "Created by user <id>",
  "source": "top-ai-ideas",
  "warnings": []
}
```

## Integrity
- Use **SHA-256** for each file.
- `manifest_hash` is the SHA-256 of the manifest JSON without `manifest_hash`.
- Integrity failures should reject import with a clear error.

## Export Rules
- Export is performed via a single generic endpoint.
- Endpoint: `POST /api/v1/exports` (JSON body, response is a ZIP).
- The archive includes only data within the requested scope and current workspace.
- Relationships are preserved by IDs in JSON fields.
- Documents follow existing S3 layout and are bundled inside the ZIP with the same path.
 - **Permissions**:
   - Workspace export requires **admin** role.
   - Object export (folder/usecase/organization/matrix) allowed for **admin** and **editor** only.
   - Commenter/viewer cannot export.

### Scope Behavior
- `workspace`: all workspace-scoped data (organizations, folders, use cases, matrix, comments, documents).
- `folder`: the folder + related use cases + optional documents/comments.
- `usecase`: one or more use cases + related documents/comments.
- `organization`: one or more organizations + related folders/use cases/documents/comments.
- `matrix`: matrix config for the workspace (or for a folder if matrix is folder-scoped).

## Import Rules
- Import is performed via a single generic endpoint.
- Endpoint: `POST /api/v1/imports` (multipart form-data with `file` + optional `target_workspace_id`).
- The API is the sole owner of new IDs.
- Import must validate the manifest and file hashes before any DB writes.
 - **Permissions**:
   - Workspace import into a **new** workspace is allowed for any authenticated user (API creates workspace).
   - Workspace import into an **existing** workspace requires **admin** role.
   - Object import into an existing workspace allowed for **admin** and **editor** only.
   - Commenter/viewer cannot import.

### Target Workspace Rules
- If `target_workspace_id` is **not provided**:
  - API creates a new workspace.
  - All imported IDs are remapped to new IDs.
- If `target_workspace_id` **is provided**:
  - The workspace must exist.
  - The requester must be an **admin** of that workspace.
  - Data is merged into the workspace using new IDs (no UI-provided IDs).
- If the target workspace does not exist or user is not admin: **reject**.

### Conflict Strategy
- Default: create new records with new IDs and keep originals as references in `meta`.
- No overwrites unless explicitly specified by a future `mode` option.

## Comments
- Stored in `comments.json` when `include_comments=true`.
- Each comment has `context_type`, `context_id`, `section_key`, `assigned_to`, `status`, `thread_id`.
- Threads are **flat**: all messages in a thread share the same `thread_id`.
- `status` is **thread-level** (`open`/`closed`); resolving updates the entire thread.

## Documents
- Included when `include_documents=true`.
- Binary files are stored under `documents/` with the same S3-like layout:
  `documents/<workspace_id>/<context_type>/<context_id>/<document_id>-<filename>`
- `documents.json` is optional; document metadata can live in `context_documents` export.

## API Endpoints (Generic)
- `POST /exports`
  - Body: `{ scope, scope_id?, include_comments, include_documents }`
  - Response: ZIP stream
- `POST /imports`
  - Multipart: ZIP file
  - Body: `{ target_workspace_id?, mode? }`

## UI
- Provide export/import actions in workspace settings and object detail pages.
- Offer options:
  - Include comments
  - Include documents
  - Target workspace selector on import (optional)

## UAT
- Export `.zip` with/without comments and verify content.
- Import into new workspace (no target provided).
- Import into existing workspace (target selected).
- Validate documents and comments are present when requested.
