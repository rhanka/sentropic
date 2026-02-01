# Collaboration Feature Specification

**Status**: Initial draft — will be completed during UAT phases.

**Related**: See `BRANCH.md` for implementation plan and constraints.

## Overview

Collaboration features enable multi-user workspace sharing with role-based access control, concurrent editing locks, comments, and import/export capabilities.

## Workspace Management

### Workspace Lifecycle

- **Create**: Users can create additional workspaces (beyond their default owned workspace). Creator automatically becomes `admin` member.
- **Hide/Unhide**: Workspaces can be hidden (soft delete) by `admin` members. Hidden workspaces remain accessible for unhide/export/final suppression.
- **Final Suppression**: Hard delete (cascade all data) is only possible for hidden workspaces, by `admin` members.
- **Remove `shareWithAdmin`**: The legacy `shareWithAdmin` field is removed (no longer useful with membership-based access).
- **No workspace edge-case**: If a user is removed from all workspaces, the UI redirects to `/parametres` and shows a warning; no new workspace is auto-created on login.

### Workspace Membership Roles

- **`viewer`**: Can view all objects in workspace, cannot edit.
- **`commenter`**: Can view all objects and create/edit comments, cannot edit objects.
- **`editor`**: Can view and edit all objects in workspace, cannot manage members or workspace lifecycle.
- **`admin`**: Can view/edit all objects, manage members (add/remove/change roles), hide/unhide workspace, perform final suppression/export.

### Workspace Selector UI

Replace dropdown selector with a table showing (column order):

1. **Selected state**: Checkmark icon if selected, empty otherwise.
2. **Workspace name**: Display name of the workspace.
3. **Role**: User's role in workspace (`viewer`/`editor`/`admin`).
4. **Visibility**: state icon (`eye` = visible, `eye-off` = hidden). Click toggles (admin-only). Tooltip indicates the action (hide vs unhide).
5. **(no title)**: delete/trash icon (admin-only). Always visible for admins, but enabled only when the workspace is hidden (server requires hidden before final deletion).

**Interaction**:
- Row is clickable to select workspace.
- Hover message on row: "Click to select workspace" (hover disabled on action buttons).
- Icons: icons only, no text/border (same style as existing icons).
- Workspace admins can rename the **selected** workspace in `/parametres` using an inline `EditableInput` (writes to `PUT /workspaces/:id`).
- **Same UI for all roles**: admin, editor, viewer share the same table layout and columns; admin-only actions are rendered but disabled for non-admins (tooltip "Réservé aux admins").

### Workspace Members UI

- Member role changes are done via select dropdown (admin-only).
- Removing a member uses a trash icon (not a close/cross), to match destructive action semantics.
- **Live updates**: workspace admin view listens to SSE events (`workspace_update`, `workspace_membership_update`) to refresh workspace list and members in real time.

### Hidden Workspace Visibility

- Hidden workspaces must be **invisible** to `viewer` and `editor` members (not shown in the workspace list/table).
- Hidden workspaces are visible only to `admin` members of that workspace (so they can unhide or perform final deletion/export).

### Hidden Workspace Navigation Lock (UI)

When an `admin` selects a **hidden** workspace:
- The user must be **restricted to the Settings/Paramètres page** until the workspace is made visible again.
- If the user tries to navigate elsewhere (via URL or navigation), they are redirected to `/parametres`.
- A persistent banner must be shown to explain: "workspace hidden — unhide to access other views".

## Object Edition Locks

### Lock Model (implemented - phase 1)

- **Scope**: object-level \(workspaceId + objectType + objectId\)
- **Storage**: single table `object_locks` with TTL (`expires_at`)
- **TTL**: 1 minute max, UI refresh every 30s
- **Write enforcement**: mutations (PUT/DELETE) are blocked if a lock exists and is held by another user → `409` with `{ code: 'OBJECT_LOCKED', lock }`

### Lock API (implemented - phase 1)

- `GET /api/v1/locks?objectType=...&objectId=...` → `{ lock }`
- `POST /api/v1/locks` → acquire/refresh (editor/admin only)
  - `201` `{ acquired: true, lock }`
  - `409` `{ acquired: false, lock }` (locked by another user)
- `DELETE /api/v1/locks?objectType=...&objectId=...` → release (owner or workspace admin)
- `POST /api/v1/locks/request-unlock` → marks an unlock request on the lock (best-effort UX signal)
- `POST /api/v1/locks/accept-unlock` → transfer lock to requester (owner/admin)
- `POST /api/v1/locks/force-unlock` → admin-only force release
- `POST /api/v1/locks/presence` → record presence on an object (viewer/editor/admin)
- `GET /api/v1/locks/presence?objectType=...&objectId=...` → list presence snapshot
- `POST /api/v1/locks/presence/leave` → remove presence on page leave

### Unlock Request Flow (current behavior)

- Unlock requests are stored directly on the lock row:
  - `unlock_requested_at`, `unlock_requested_by_user_id`, `unlock_request_message`
- The lock owner can **accept** by transferring the lock to the requester (no explicit "refuse").
- The request is cleared when the lock owner leaves the page (no timeout).

### Lock Lifecycle (SSE + cleanup)

- All locks are purged at API startup (no persistence across restarts).
- Locks are purged if a user has **no active SSE connections**.
- A periodic sweep removes expired locks and emits `lock_update` so clients can re-acquire.

### Lock UI (editor/admin)

- When an object is locked by another user, show a **compact lock badge** near the header actions:
  - A **lock icon** plus **avatar(s)** (rounded overlap). The top avatar is the lock owner.
  - Hover tooltip: “`n utilisateurs connectés, {Nom} verrouille le document, cliquer pour demander le déverrouillage`”.
  - Click on the badge triggers **request unlock** (no message prompt).
  - Admin-only **Force unlock** is available as a **secondary action inside the tooltip** (no visible button).
- When the current user owns the lock, show “**Vous éditez**” in the same compact badge.
- The avatar list **excludes the current user** but still counts them in `n utilisateurs connectés`.
- No auto-transfer/timeout/accept/refuse workflow yet (planned in next phase of Lot 2).

### Presence Badge (all roles)

- The compact badge is shown for **viewer/editor/admin** to display presence even in read-only mode.
- In read-only mode, **request unlock is disabled** and the tooltip omits the “cliquer pour demander le déverrouillage” wording.
- The read-only lock icon is hidden when the presence badge is visible (avoid duplicate indicators).
- When a user requests unlock, their avatar shows a **small key overlay** in the badge.
- The lock owner sees **"Déverrouiller pour {user}"** in the tooltip menu, and the unlock action is shown **only when a request exists**.

### SSE Events (implemented - phase 1)

Reuse existing `/streams/sse` channel:
- `lock_update` → `{ objectType, objectId, data: { lock } }`
- `presence_update` → `{ objectType, objectId, data: { users, total } }`

## Comments

### Comment Model

- **Target**: Any object and any "data part" within an object (e.g., use case section, matrix cell).
- **Threading**: Flat conversation per `thread_id` (no nested replies).
- **Assignment**: Comments can be assigned via `@mention` (autocomplete restricted to workspace members). Assignment is stored at the **thread level**.
- **Default assignee**: If no `@mention`, creator is the default assignee.
- **Resolution**: A thread can be **resolved** (`status=closed`) and later **reopened** (`status=open`). Resolution applies to the **whole thread**.
- **Resolve permissions**: Only the **thread creator** or a **workspace admin** can resolve/reopen.
- **Deletion**: Delete removes the root comment and its thread data (hard delete).

### UI Indicators

- Comment count badge on section headers.
- Clicking badge opens comment panel with relevant comments.
- Comment timestamps are displayed using the **browser timezone** while parsing the server `created_at` ISO string **with timezone offset**, so cross-timezone shifts are rendered correctly.
- Resolved threads are **excluded** from badge counts.

### Comments UI Behavior
- Comments menu lists **all threads for the current object view** (no section filter in the menu).
- Threads can be toggled to show **resolved** items; resolved items are shown **struck-through**.
- Resolving a thread moves selection to the **next open thread** in the same section, else the next open thread in another section; if none, selection is cleared.
- When a thread is resolved, the sub-header shows **"Resolved {date}"** instead of assignment.
- Comment composer is **disabled** for resolved threads and for `viewer` role (different placeholder).

## Import/Export

### Archive Format (ZIP)

Top-level files:
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

Notes:
- `workspaces.json` and `workspace_memberships.json` are arrays.
- Per-object JSON files are single objects and may include a `comments` array when requested.
- `matrix_<folder_id>.json` uses folder id (no separate matrix id).
- `matrix_config` and `executive_summary` are JSON objects (not stringified).

### Import Process

1. Validate `manifest.json` + file hashes.
2. Remap all IDs (API-owned).
3. Insert in dependency order (workspaces → orgs/folders/usecases → comments → documents).

### Export Options

- Include/exclude comments.
- Include/exclude documents.
- `include[]` can limit related data (e.g. `folders`, `organizations`, `usecases`, `matrix`).
- `export_kind` is used for workspace list exports (organizations or folders) to build filenames.

### Import UX (context-driven)

- After selecting a ZIP, show a **preview list** of objects (display name/title, not IDs).
- Allow **selecting objects** to import (checkboxes).
- Provide a **target selector** (type + object), defaulting to the current view context.
- Comments/documents options apply to selected objects only.

#### View-specific rules
- `/dossiers/[id]`: import **use cases** into the **current folder**.
  - Ignore folder metadata inside the ZIP.
  - Do **not** create a new folder during import.
- `/dossiers`: import **folders** into the current workspace.
- `/organisations`: import **organizations** into the current workspace.
- `/parametres`: import **workspaces** into new or current workspace (role-gated).

### Export Permissions

- **Workspace export**: admin only.
- **Object export** (folder/usecase/organization/matrix): admin and editor.
- **Commenter/viewer**: cannot export.

### Import Permissions

- **Workspace import into a new workspace**: any authenticated user can import; API creates the workspace.
- **Workspace import into current workspace**: admin only.
- **Object import into current workspace**: admin and editor.
- **Commenter/viewer**: cannot import.

## Lot 4 — Comments (table + UI + @mentions + close)

- DB: comments table + relations (object + section)
- API: CRUD comments + one-level replies
- API: @mention assignment with autocomplete (workspace users)
- API: close comment (only last assigned user; rule to confirm)
- UI: show comment indicator on header of the relevant "data part" cards

### Partial UAT (Lot 4) — to automate in E2E

- **User A creates comment:**
  - User A opens a use case detail page
  - User A creates a comment on a data section (e.g., "description" field)
  - Verify comment appears in the section header indicator
  - Verify comment creator is User A (default assignee if no @mention)
- **User B replies (one-level):**
  - User B opens the same use case
  - User B replies to User A's comment
  - Verify reply appears nested under User A's comment
  - Verify User B cannot reply to the reply (one-level only enforced)
- **User A assigns via @mention:**
  - User A edits the comment and types "@User B"
  - Verify autocomplete shows only workspace members (User A, User B)
  - Verify autocomplete does NOT show users from other workspaces
  - User A selects User B from autocomplete
  - Verify comment assignment updates to User B
  - Verify User B receives notification (if implemented)
- **User B closes comment:**
  - User B (last assigned user) closes the comment
  - Verify comment status changes to "closed"
  - Verify User A cannot close the comment (not the last assigned)
  - Verify only User B can reopen/close the comment
- **Comment indicators:**
  - User A creates multiple comments on different sections
  - Verify each section header shows comment count badge
  - Clicking badge opens comment panel with relevant comments
- **Export with/without comments:**
  - User A exports use case with "Include comments" → verify comments in ZIP
  - User A exports use case with "Exclude comments" → verify comments NOT in ZIP
  - User B imports both versions and verifies comment presence/absence

## Lot 5 — Finalization: schema/migration, docs, automated tests (run at end)

- Apply the **single planned schema evolution** (one migration file for entire branch - see Migration Strategy).
- Update `spec/DATA_MODEL.md` to match `api/src/db/schema.ts`.
- Generate/update OpenAPI artifacts if needed (`make openapi-*`).
- Create automated tests (only now):
  - **Regression test (circular imports / Ctrl+R crash):** ensure importing core UI modules in different orders does not throw `Cannot access 'session' before initialization`
    - Target modules: `ui/src/lib/utils/api.ts`, `ui/src/lib/stores/session.ts`, `ui/src/lib/stores/workspaceScope.ts`
    - Expected: no top-level import triggers store reads that require `session` initialization (Option B: scope passed explicitly to `apiRequest`)
  - `make test-api` coverage for roles/locks/comments/import-export
  - `make test-ui` coverage for core UI flows
  - `make test-e2e` for critical collaboration journeys
- **UAT automation**: all UAT scenarios below must be implemented in Playwright E2E.
- **API security tests**: cover role enforcement, workspace scoping, locks, documents, chat tools.
- Run full gates: `make typecheck lint test-api test-ui test-e2e`.

### Full UAT (final) — to automate in E2E

- **Complete workspace collaboration flow:**
  - User A creates "Workspace Delta" and adds User B as `editor`
  - User A creates an organization and folder in "Workspace Delta"
  - User B switches to "Workspace Delta" and creates a use case
  - User A and User B both view the use case simultaneously
  - User A acquires edit lock; User B sees locked view
  - User A edits use case; User B receives SSE updates
  - User B requests unlock; User A accepts; lock transfers to User B
  - User B creates a comment with @mention to User A
  - User A replies to comment; User B closes it
  - User A exports workspace with comments as `.topw`
  - User A hides "Workspace Delta"
  - User B tries to access → sees archived workspace
  - User A unhides "Workspace Delta"; User B can access again
  - User A performs final suppression; all data cascade-deleted
  - User B cannot access "Workspace Delta" anymore
- **Cross-workspace isolation:**
  - User A has "Workspace Epsilon" (private, no members)
  - User B has "Workspace Zeta" (private, no members)
  - Verify User A cannot see User B's data
  - Verify User B cannot see User A's data
  - Verify SSE updates are workspace-scoped (no cross-workspace leaks)
- **Role enforcement across all endpoints:**
  - User B (viewer) attempts all mutation endpoints → all blocked
  - User B (editor) attempts mutations → all succeed
  - User B (editor) attempts member management → blocked
  - User B (admin) attempts all operations → all succeed

## Permission Enforcement

### Mutation Endpoints

All mutation endpoints (POST/PUT/DELETE) check workspace membership role:
- **`viewer`**: 403 Forbidden for all mutations.
- **`editor`**: Allowed for object mutations (create/update/delete).
- **`admin`**: Allowed for all mutations + member management + workspace lifecycle.

### UI Enforcement (prevent attempts before API)

For a good UX and to avoid misleading feedback:
- **Viewer UI is read-only**:
  - Create actions are hidden/disabled (no "+" entry points). A **lock icon** is shown in the actions area with a tooltip explaining the read-only state.
  - Delete actions are hidden (no trash icon). A **lock icon** may replace destructive actions where relevant.
  - Inline editors (`EditableInput` and TipTap markdown) are locked (no typing, no autosave).
  - Direct navigation to creation pages is blocked (redirect with an explicit read-only message).
- **403 handling**:
  - If a mutation is still attempted (e.g. stale UI or manual calls), display a clear "read-only / insufficient permissions" message.

**Read-only lock icon placement (viewer UX)**:
- Shown in the actions area (where `+` / trash normally is) on:
  - `/organisations`, `/organisations/[id]`
  - `/dossiers`, `/dossiers/[id]`
  - `/cas-usage/[id]`
  - `/matrice`, `/dashboard`
- On `/dashboard`, the lock icon must be **hidden in print mode** (PDF export / printing).

**Endpoints to update**:
- `folders.ts`, `organizations.ts`, `use-cases.ts`, `documents.ts`, `chat.ts`, `tool-service.ts`.

## Data Model Changes

### Schema Evolution (Single Migration)

**Add to `workspaces`**:
- `hidden_at` (timestamp, nullable): When workspace was hidden (NULL = active).

**Remove from `workspaces`**:
- `share_with_admin` (boolean): No longer needed.

**Modify `workspaces`**:
- Drop UNIQUE constraint on `owner_user_id` (allow multiple workspaces per user).

**Create `workspace_memberships`**:
- `workspace_id` (FK workspaces.id)
- `user_id` (FK users.id)
- `role` ('viewer'|'editor'|'admin')
- `created_at` (timestamp)
- Unique index on (workspace_id, user_id)

**Create `object_locks`**:
- `id` (text, PK)
- `workspace_id` (FK workspaces.id)
- `object_type` ('organization'|'folder'|'usecase')
- `object_id` (text)
- `locked_by_user_id` (FK users.id)
- `locked_at` (timestamp)
- `expires_at` (timestamp, TTL)
- `unlock_requested_at` (timestamp, nullable)
- `unlock_requested_by_user_id` (FK users.id, nullable, ON DELETE SET NULL)
- `unlock_request_message` (text, nullable)
- Unique index on (workspace_id, object_type, object_id)

**Unlock requests table**: not created in phase 1 (currently stored on `object_locks`).

**Create `comments`**:
- `workspace_id` (FK workspaces.id)
- `context_type` ('organization'|'folder'|'usecase'|...)
- `context_id` (text)
- `section_key` (text, nullable): Specific section within object (e.g., 'description', 'matrix.cell.x.y')
- `created_by` (FK users.id)
- `assigned_to` (FK users.id, nullable)
- `status` ('open'|'closed')
- `thread_id`: Conversation identifier (flat conversation, no replies)
- `content` (text)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## Future Enhancements (Out of Scope for Current Branch)

- **User preference storage**: Store workspace selection in user preferences table (currently localStorage).
- **User invitations for non-existing users**: Send activation link email for new user registration (separate feature, deferred beyond Lot 1).

## UAT Progress

This specification will be updated as UAT scenarios are validated and edge cases discovered.

### Validated Scenarios

- (To be filled during UAT)

### Edge Cases / Questions

- (To be filled during UAT)

