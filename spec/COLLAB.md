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

### Workspace Membership Roles

- **`viewer`**: Can view all objects in workspace, cannot edit.
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

### Hidden Workspace Visibility

- Hidden workspaces must be **invisible** to `viewer` and `editor` members (not shown in the workspace list/table).
- Hidden workspaces are visible only to `admin` members of that workspace (so they can unhide or perform final deletion/export).

## Object Edition Locks

### Lock Model

- Lock scope: object-level (workspaceId + objectType + objectId).
- Lock acquisition: Automatic when first editor/admin enters edit view.
- Lock release: Automatic when user leaves view, or manual release, or unlock request granted.

### Unlock Request Flow

1. User B requests unlock from locked object.
2. API checks if another unlock request is already processing → refuse immediately if yes.
3. API sends SSE notification to current lock holder (User A): "User B requests unlock".
4. **Timeout behavior**: If no answer from User A within 2 seconds (fixed timeout, centralized as variable or env param), lock auto-transfers to User B.
5. **User A response**:
   - Accept: lock transfers to User B immediately.
   - Refuse: lock remains with User A.

### SSE Events

Reuse existing `/streams/sse` channel, add collaboration events:
- `lock_acquired`: Object is now locked by a user.
- `lock_released`: Object lock has been released.
- `unlock_requested`: Unlock request sent to current lock holder.
- `unlock_granted`: Unlock request accepted, lock transferred.
- `unlock_refused`: Unlock request refused, lock remains.
- `user_presence`: Active users on object (display collaborator list top-right).

## Comments

### Comment Model

- **Target**: Any object and any "data part" within an object (e.g., use case section, matrix cell).
- **Threading**: One-level replies only (no sub-replies).
- **Assignment**: Comments can be assigned via `@mention` (autocomplete restricted to workspace members).
- **Default assignee**: If no `@mention`, creator is the default assignee.
- **Closing**: Only the last assigned user can close a comment.

### UI Indicators

- Comment count badge on section headers.
- Clicking badge opens comment panel with relevant comments.

## Import/Export

### Archive Formats

- **`.topw`** (workspace): ZIP containing workspace JSON + organizations JSON + folders JSON + use cases JSON + comments JSON (optional) + documents (if any) + metadata (DB migration version).
- **`.topf`** (folder): ZIP containing folder JSON + use cases JSON + documents (if any).
- **`.topu`** (use case(s)): ZIP containing use cases JSON array + documents (if any).
- **`.topo`** (organization(s)): ZIP containing organization JSON (single or array) + documents (if any).

### Import Process

1. Create temporary schema.
2. Apply migrations up to version specified in archive metadata.
3. Import objects into temporary schema.
4. Validate relationships.
5. Move objects to target workspace.
6. Cleanup temporary schema.

### Export Options

- Include/exclude comments (checkbox).

## Permission Enforcement

### Mutation Endpoints

All mutation endpoints (POST/PUT/DELETE) check workspace membership role:
- **`viewer`**: 403 Forbidden for all mutations.
- **`editor`**: Allowed for object mutations (create/update/delete).
- **`admin`**: Allowed for all mutations + member management + workspace lifecycle.

### UI Enforcement (prevent attempts before API)

For a good UX and to avoid misleading feedback:
- **Viewer UI is read-only**:
  - Create actions are hidden/disabled (no "+" entry points).
  - Delete actions are hidden (no trash icon).
  - Inline editors (`EditableInput` and TipTap markdown) are locked (no typing, no autosave).
  - Direct navigation to creation pages is blocked (redirect with an explicit read-only message).
- **403 handling**:
  - If a mutation is still attempted (e.g. stale UI or manual calls), display a clear "read-only / insufficient permissions" message.

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
- `workspace_id` (FK workspaces.id)
- `object_type` ('organization'|'folder'|'usecase'|...)
- `object_id` (text)
- `locked_by_user_id` (FK users.id)
- `locked_at` (timestamp)
- `heartbeat_at` (timestamp, nullable): Updated every 30s when lock is active
- Unique index on (workspace_id, object_type, object_id)
- **Cleanup**: PostgreSQL jobs (updated at API startup) clean up expired locks (heartbeat timeout: 30s)

**Create `unlock_requests`**:
- `lock_id` (FK object_locks.id)
- `requested_by_user_id` (FK users.id)
- `status` ('pending'|'granted'|'refused'|'timeout')
- `requested_at` (timestamp)
- `resolved_at` (timestamp, nullable)

**Create `comments`**:
- `workspace_id` (FK workspaces.id)
- `context_type` ('organization'|'folder'|'usecase'|...)
- `context_id` (text)
- `section_key` (text, nullable): Specific section within object (e.g., 'description', 'matrix.cell.x.y')
- `created_by` (FK users.id)
- `assigned_to` (FK users.id, nullable)
- `status` ('open'|'closed')
- `parent_comment_id` (FK comments.id, nullable): For one-level replies
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

