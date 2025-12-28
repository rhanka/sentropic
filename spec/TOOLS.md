# Tools (Chat) — Inventory & Roadmap

This document is the single checklist for **chat tools**: what is already implemented and what remains to implement.

## Implemented ✅

### Web tools (available in all views)
- [x] `web_search`
- [x] `web_extract`

### Organizations tools
- [x] `organizations_list` (supports `idsOnly` + `select`)
- [x] `organization_get` (supports `select`)
- [x] `organization_update` (single-entity update; blocked in read-only workspace)

### Folders tools
- [x] `folders_list` (supports optional `organizationId`, `idsOnly` + `select`)
- [x] `folder_get` (supports `select`)
- [x] `folder_update` (single-entity update; blocked in read-only workspace)

### Folder → Use cases list tools
- [x] `usecases_list` (folder-scoped list; supports `idsOnly` + `select` on `use_cases.data`)

### Executive summary tools (stored on `folders.executiveSummary`)
- [x] `executive_summary_get` (supports `select`)
- [x] `executive_summary_update` (updates selected fields; blocked in read-only workspace)

### Matrix tools (stored on `folders.matrixConfig`)
- [x] `matrix_get`
- [x] `matrix_update` (replaces matrixConfig; blocked in read-only workspace)

## Implemented wiring / behavior ✅

### Contexts enabled in API (tool availability)
- [x] `primaryContextType=usecase`: use case tools + web tools
- [x] `primaryContextType=organization`: organizations tools (+ folders_list) + web tools
- [x] `primaryContextType=folder`: folder tools + usecases_list + executive summary tools + matrix tools + organization_get (restricted) + web tools
- [x] `primaryContextType=executive_summary`: executive summary tools + usecases_list + folder_get + matrix_get + organization_get (restricted) + web tools

### Security / scope rules
- [x] Workspace scope enforced via `workspaceId` in ToolService queries
- [x] Read-only workspace disables mutation tools (update tools)
- [x] Context-id matching for detail contexts (prevents cross-object writes)
- [x] Folder list context (`primaryContextType=folder` without id) allows read-only:
  - [x] `folder_get(folderId=...)`
  - [x] `usecases_list(folderId=...)`
  - [x] `executive_summary_get(folderId=...)`
  - [x] `matrix_get(folderId=...)`
- [x] Folder → organization read-only constraint:
  - [x] `organization_get` is allowed from `folder`/`executive_summary` only if `organizationId` matches the folder’s `organizationId`

### UI context wiring
- [x] `/organisations` (organizations list) sends `primaryContextType=organization` (no id)
- [x] `/organisations/[id]` sends `primaryContextType=organization` + `primaryContextId`
- [x] `/dossiers` (folders list) sends `primaryContextType=folder` (no id)
- [x] `/dossiers/[id]` sends `primaryContextType=folder` + `primaryContextId`
- [x] `/cas-usage` uses `currentFolderId` and sends `primaryContextType=folder` + `primaryContextId=currentFolderId`
- [x] `/cas-usage/[id]` sends `primaryContextType=usecase` + `primaryContextId`
- [x] `/dashboard` sends `primaryContextType=folder` + `primaryContextId=currentFolderId` (dashboard syncs `currentFolderId`)
- [x] `/matrice` sends `primaryContextType=folder` + `primaryContextId=currentFolderId`

### UI live refresh (SSE)
- [x] Dashboard listens to `folder_update` and refreshes executive summary + matrix via `loadMatrix(folderId)`

## Remaining / Not implemented ⬜

### Naming migration (Option B)
- [x] Add alias tool `usecase_get` (detail) for `read_usecase`
- [x] Add alias tool `usecase_update` (single-entity) for `update_usecase_field`
- [x] Update prompts to prefer `usecase_get`/`usecase_update` (legacy names still supported)
- [ ] Deprecate/remove `read_usecase`/`update_usecase_field` once stable

### Use case detail: matrix + organization access (read-only)
- [ ] From `primaryContextType=usecase`, allow:
  - [ ] read-only access to parent folder matrix (`matrix_get`) **with secure folderId derivation**
  - [ ] read-only access to parent folder organization (`organization_get`) **with secure folderId derivation**

### Matrix view: richer access to use cases + organization + folder
- [ ] Add explicit “matrix view” tool contract:
  - [ ] use case detail reads from matrix view with folder scoping (`usecase_get` with folder ownership check)
  - [ ] organization reads from matrix view (read-only, via folder.organizationId)

### Batch / destructive tools (⚠ high-impact)
- [ ] `organizations_create_batch`
- [ ] `organizations_update_batch`
- [ ] `organizations_delete_batch`
- [ ] Folder batch create/update/delete tools
- [ ] Use case batch operations (translate-all, batch delete, etc.)
- [ ] Dry-run and explicit confirmation pattern for high-impact tools

### AI-assisted “populate” tools (⚠ high-impact)
- [ ] Organization AI populate / enrich batch from chat tools
- [ ] Folder AI populate (create folders + generate use cases) from chat tools
- [ ] Cost/limits safeguards + job queue integration for AI actions


