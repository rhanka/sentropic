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
organization_<uuid>.json
folder_<uuid>.json
usecase_<uuid>.json
matrix_<folder_id>.json
documents/
  <workspace_id>/<context_type>/<context_id>/<document_id>-<filename>
```

### JSON Files
- `workspaces.json` and `workspace_memberships.json` are arrays.
- `organization_*.json`, `folder_*.json`, `usecase_*.json`, `matrix_*.json` are single-object JSON files.
- Per-object JSON files may include a `comments` array when `include_comments=true`.
- `matrix_<folder_id>.json` uses the folder id as identifier (no separate matrix id).
- `matrix_config` and `executive_summary` are exported as JSON objects (not stringified).

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
  "include": ["comments", "documents", "organization", "organizations", "folders", "usecases", "matrix"],
  "export_kind": "organizations|folders",
  "files": [
    { "path": "organization_<uuid>.json", "bytes": 1234, "sha256": "<hash>" }
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
- `workspace`: all workspace-scoped data, filtered by `include[]` when provided.
- `folder`: the folder + related use cases + optional organization (if requested).
- `usecase`: one use case + related folder + optional documents/comments.
- `organization`: the organization + optional folders/use cases (controlled via `include[]`).
- `matrix`: matrix config for a folder.

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
- Comments are embedded under each object as `comments` when `include_comments=true`.
- Each comment has `context_type`, `context_id`, `section_key`, `assigned_to`, `status`, `thread_id`.
- Threads are **flat**: all messages in a thread share the same `thread_id`.
- `status` is **thread-level** (`open`/`closed`); resolving updates the entire thread.

## Comment Resolution Tool (Chat)

### Purpose
Provide an AI-assisted tool to analyze open comment threads in the current context and propose resolution actions. The tool can execute actions **only after explicit user confirmation**.

### Context Scoping (mimic existing tool context rules)
- `primaryContextType=usecase`: **strict** (use case only).
- `primaryContextType=folder`: current folder **+ child use cases**.
- `primaryContextType=organization`: current organization **+ child folders/use cases** (same logic as existing context expansion).
- `primaryContextType=matrix` / `executive_summary`: follow folder-based expansion rules.

### Roles & Permissions
- **Resolve** is allowed to:
  - Thread creator (role `commenter` or `editor`)
  - Workspace admin
- Viewer cannot resolve or execute tool actions.
- Editor can resolve when they are the thread creator.
- Admin can resolve any thread.

### Tool Contract (high level)
- A new context handler is expected (e.g., `context-comments.ts`) mirroring other `context-*` handlers.
- Tool output is **actionable** (batch allowed), but must always include a **confirmation step**:
  1) AI proposes a plan (list of actions).
  2) User explicitly validates.
  3) Actions are executed.

### Action Types (batch-enabled)
- Close thread (set status `closed`)
- Reassign thread (optional)
- Add a resolution note (optional)

### Traceability
When AI is used for a resolution action, a **visible trace** is stored (e.g., a system note in the thread) so collaborators know the action was AI-assisted.

### UI Behavior (Chat)
- Present the AI proposal as structured Markdown with a **clear confirmation prompt**.
- If possible, provide **fixed options** (Yes/No or a short list). If user responds with free text, the system re-prompts until a valid option is chosen.

## Documents
- Included when `include_documents=true`.
- Binary files are stored under `documents/` with the same S3-like layout:
  `documents/<workspace_id>/<context_type>/<context_id>/<document_id>-<filename>`
- `documents.json` is optional; document metadata can live in `context_documents` export.

## API Endpoints (Generic)
- `POST /exports`
  - Body: `{ scope, scope_id?, include_comments, include_documents, include?, export_kind? }`
  - `include` is an optional array to control related data (e.g., `folders`, `organizations`, `usecases`, `matrix`).
  - `export_kind` is used for workspace list exports (`organizations` or `folders`) to build the filename.
  - Response: ZIP stream
- `POST /imports/preview`
  - Multipart: ZIP file
  - Response: `{ scope, objects, has_comments, has_documents }`
  - `objects` contains arrays of `{ id, name }` for `organizations`, `folders`, `usecases`, `matrix`
- `POST /imports`
  - Multipart: ZIP file
  - Body: `{ target_workspace_id?, target_folder_id?, target_folder_create?, target_folder_source_id?, selected_types?, include_comments?, include_documents?, mode? }`
  - `selected_types` is an optional array (e.g. `['usecases']`) to import only selected object types.
  - `target_folder_create=true` creates a new folder from imported metadata when importing use cases.
  - `target_folder_source_id` picks which imported folder metadata to use for creation.

## UI
### Export
- Provide export actions in workspace settings and object detail pages.
- Offer options:
  - Include comments
  - Include documents
  - Include related objects (folders/organizations/usecases/matrix) when relevant

### Import
- Provide import actions in workspace settings and object detail pages.
- The import flow mirrors export and is **context-driven** by the current view.
- After selecting a ZIP file, show a **preview list** of objects found in the archive:
  - Display **name/title** (not IDs).
  - Allow **selecting which objects** to import.
- Provide a **target selector**:
  - Default target is the current view (e.g., current folder).
  - Targets are listed by **name/title**, not ID.
- Options:
  - Include comments (if present in ZIP)
  - Include documents (if present in ZIP)

#### View-specific rules
- `/dossiers/[id]`: import **use cases only** into the **current folder**.
  - Ignore any folder metadata from the ZIP.
  - Do **not** create a new folder during import.
- `/dossiers/[id]` can also select a different workspace and/or target folder:
  - If `target_folder_create=true`, a new folder is created using imported folder metadata.
  - If `target_folder_source_id` is set, use that imported folder metadata for the new folder.
- `/dossiers`: import **folders** into the current workspace.
- `/organisations`: import **organizations** into the current workspace.
- `/parametres`: import **workspace** into new or current workspace (role-gated).

## UAT
- Export `.zip` with/without comments and verify content.
- Import into new workspace (no target provided).
- Import into existing workspace (target selected).
- Validate documents and comments are present when requested.
