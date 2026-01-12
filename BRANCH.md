# Feature: Collaboration (Workspace sharing, object edition locks, comments, import/export)

## Objective
Implement the "Collaboration" scope from `TODO.md` (lines 96–119):
- Workspace sharing (create/delete workspaces, manage member roles)
- Object edition locks (single editor, locked view for others, unlock request flow)
- Live updates for viewers/locked editors via SSE
- Import/export (workspace, folder, use cases, organizations) with dedicated file extensions
- Comments (threaded one-level replies, @mentions, close workflow, export option with/without comments)

Out of scope:
- Any `TODO.md` items outside "Collaboration"
- Broad refactors not required by the feature set

## Constraints / Guardrails (branch-specific)
- **Make-only execution** (Docker-first): do not run `npm/node/docker` directly; use `make` targets only.
- **Single data model evolution** in this branch: plan all schema changes together, then apply once.
- **No destructive DB/system actions without ⚠ approval**.
- **UAT data protection**: do not run `make test-ui`, `make test-api`, `make test-e2e` until the final "Tests" phase (tests are expected to reset/seed DB and may break in-progress UAT data).
- **Quality gates per lot**: run `make typecheck` and `make lint` after each lot (safe checks).
- **Atomic commits**: avoid multiple commits for the same feature/lot; keep changes minimal and scoped.
- **English-only for code/docs** (per `.cursor/rules/MASTER.mdc`); user discussion stays in French.

## Design Decisions (confirmed)

### Workspace Selection & Storage
- **Selection storage**: localStorage for this branch (future: user preference in DB - see `spec/COLLAB.md` / `TODO.md`).
- **Default workspace initialization**: If no localStorage/preference exists, use the most recently created non-hidden workspace.
- **All workspaces hidden**: Redirect to Settings/Paramètres with alert message in workspace section. If user is not admin of these workspaces, user must create a new workspace.

### Migration Strategy
- **Single migration file** for entire branch: all schema changes must be planned together and applied in one migration.
- **Reset strategy**: If migration needs restart during branch development, use:
  ```bash
  make clean db-restore dev BACKUP_FILE=app-2026-01-09T20-27-13.dump SKIP_CONFIRM=true
  ```
- **Existing data migration**: Automatically create `admin` membership for existing workspace owners during migration.

### Lock Management
- **Heartbeat timeout**: 30 seconds.
- **Lock cleanup**: PostgreSQL jobs (to be updated at API startup).
- **Unlock request timeout**: 2 seconds (fixed, but centralize as variable or env param).

### Implementation Notes
- **User invitations for non-existing users**: Deferred beyond Lot 1 (not urgent).
- **Workspace lifecycle**: replace "soft delete / restore" with "hide / unhide" semantics.
  - Hidden workspaces are accessible from parameters for unhide/final suppression/export.
  - Final suppression (hard delete with cascade) is only possible for hidden workspaces.
- **ShareWithAdmin removal**: the `shareWithAdmin` field will be removed (no longer useful with membership-based access).
- **Workspace selector UI**: replace dropdown selector with a table showing:
  - Selected state (checkmark if selected, empty otherwise).
  - Workspace name.
  - User's role in workspace (`viewer`/`editor`/`admin`).
  - Action buttons (icons only, no text/border, same style as existing icons from `@lucide/svelte`):
    - Hide/unhide button (visible for admin role only).
    - Delete button (visible for admin role only, only when workspace is hidden).
  - Row is clickable to select workspace (hover message: "Click to select workspace"; hover disabled on action buttons). 
- Member invitation model:
  - Add by existing user email only, or allow pending invitations for non-existing users? OK add separate featur for non existing users invite (the mail will be an activation link and new user will be ask for his device)
  - Which roles exactly: `viewer`, `editor`, `admin` (as in TODO)? yes
- Object lock scope:
  - What constitutes a "view/object" (organization page, folder page, use case page, matrix view, executive summary section)? yes all that
  - Lock granularity: object-level only, or section-level within an object ("data part of object")? object level scope for now (you can prepare object level for the future)
- SSE integration:
  - Reuse existing SSE channels/events, or introduce a dedicated "collaboration" stream? reuse the ONLY SSE CHANNEL, but you can creat collab event
  - Expected client behavior when receiving updates while locked (auto-refresh vs toast + manual refresh)? display collab users on top right
- Import/export contents:
  - What is included for each extension:
    - `topw` (workspace) = JSON + optional docs (in a zip with topw ext)
    - `topf` (folder) = folder JSON + use cases JSON + docs? yes, in a zip (with topf ext)
    - `topu` / `topo` = single/multi entities? topu=topusecase(s) topo=toporganization(s)
  - Versioning / backward compatibility strategy for exported archives? use db migration version as meta data in zip. when importing, create a tmp schema for import and apply migrations. then moves the object where it shall
- Comments:
  - Which "data parts" can be commented (matrix cell, executive summary section, use case field, etc.)? ALL parts - let begind with Use case parts
  - Closing rule: "closed by the last attributed user" — should the creator be allowed if no assignee? => AS WRITTEN IN TODO THE CREATOR IS THE DEFAULT ASSIGNEE

- Workspace admin role semantics:
  - Workspace membership role `admin` can manage members and perform workspace lifecycle actions (hide / unhide / final suppression / export), even if not the owner.
  - `admin_app` must NOT be treated as a workspace admin:
    - `admin_app` retains platform user-approval capability (account approvals).
    - `admin_app` can list workspaces and user↔workspace memberships if needed.
    - Workspace-level management (members, hide/unhide, delete) requires workspace membership role `admin` for the target workspace.

## Plan / Lots (implementation order)

### Lot 0 — Branch doc + discovery (no behavioral changes)
- [x] Document scope and constraints in `BRANCH.md` (this file)
- [x] Identify existing "workspace" concepts in DB/API/UI (avoid duplicate concepts)
- [x] Map existing SSE plumbing and event patterns to reuse

**Existing baseline (already in repo):**
- DB already has a `workspaces` table and most business tables are `workspace_id` scoped.
- Current model is effectively **1:1 user ↔ owned workspace** because `workspaces.owner_user_id` is **UNIQUE**.
- Non-admin users always operate on their owned workspace (`ensureWorkspaceForUser()`).
- `admin_app` can read other workspaces only when `workspaces.share_with_admin=true` (query param `workspace_id`) — **this will be removed**.
- UI currently exposes:
  - Workspace name + `shareWithAdmin` toggle (owner-only, via `/me` PATCH) — **this will be removed**.
  - Admin scope selector for `admin_app` (stored in `localStorage` and sent as `workspace_id`) — **will be replaced by workspace table selector**.
- SSE (`/streams/sse`) already supports `workspace_id` for `admin_app` scoped reads.

**Discovery findings (Lot 0):**
- **Schema gaps (to add in single migration):**
  - `workspaces` table exists but lacks `hidden_at` column (needed for hide/unhide; nullable, timestamp when hidden).
  - `workspaces.share_with_admin` field will be removed (no longer useful with membership-based access).
  - `workspaces.owner_user_id` has UNIQUE constraint (must drop to allow multiple workspaces per user).
  - No `workspace_memberships` table exists (to create: `workspace_id`, `user_id`, `role` ('viewer'|'editor'|'admin'), `created_at`).
  - No `object_locks` table exists (to create: `workspace_id`, `object_type`, `object_id`, `locked_by_user_id`, `locked_at`, `heartbeat_at`).
  - No `unlock_requests` table exists (to create: tied to object locks, state machine + timeout).
  - No `comments` table exists (to create: `workspace_id`, `context_type`, `context_id`, `section_key?`, `created_by`, `assigned_to?`, `status`, `parent_comment_id?`).
- **Service layer status:**
  - `workspace-service.ts` exists with `ensureWorkspaceForUser()` (creates 1:1 owned workspace).
  - `workspace-access.ts` exists but references `workspaceMemberships` schema that doesn't exist yet (file created ahead of migration).
  - `workspaces.ts` route exists but is empty (placeholder).
- **SSE channel reuse strategy:**
  - `/streams/sse` is the single SSE channel (confirmed: reuse it).
  - Existing events: `job_update`, `organization_update`, `folder_update`, `usecase_update` (all workspace-scoped).
  - Need to add collaboration events: `lock_acquired`, `lock_released`, `unlock_requested`, `unlock_granted`, `unlock_refused`, `user_presence` (display collaborator list top-right).
- **Write endpoint enforcement:**
  - All mutation endpoints (POST/PUT/DELETE) use `user.workspaceId` from auth middleware (not query param).
  - This is correct and should be preserved for workspace-scoped access control.
  - Need to add membership role checks in: `folders.ts`, `organizations.ts`, `use-cases.ts`, `documents.ts`, `chat.ts`, `tool-service.ts`.
  - Viewer role blocks all mutations (403).
  - Editor/admin roles allow mutations.
  - Admin role additionally allows member management + workspace lifecycle (hide/unhide/final suppression/export).
- **No hide/unhide exists:** `workspaces` table has no `hidden_at` column; need to add for hide/unhide flow. Final suppression (hard delete) is only allowed for hidden workspaces.

**Partial UAT (after Lot 0):**
- [x] Document scope and constraints in `BRANCH.md` (this file)
- [x] Identify existing "workspace" concepts in DB/API/UI (avoid duplicate concepts)
- [x] Map existing SSE plumbing and event patterns to reuse

### Lot 1 — Workspace sharing fundamentals (create/hide/delete, roles)
- [x] API: create additional workspace; creator becomes admin
- [x] API: hide a workspace (admin-only; sets `hidden_at` timestamp)
- [x] API: unhide a workspace (admin-only; clears `hidden_at`)
- [x] API: delete a workspace (admin-only; only allowed if workspace is hidden; hard delete with cascade)
- [x] API: remove `shareWithAdmin` field and related logic (schema + code paths)
- [x] DB: add `hidden_at`, drop UNIQUE on `owner_user_id`, create `workspace_memberships` (single migration file) + data migration (owners => admin memberships)
- [x] API: introduce `workspace-access.ts` helpers (roles + default workspace selection)
- [x] API: select current workspace from `workspace_id` query param (localStorage-driven) in auth middleware; block non-settings routes when selected workspace is hidden (409)
- [x] API: `ensureWorkspaceForUser()` now resolves the default workspace from memberships (newest non-hidden), creates workspace + admin membership if none exist
- [x] API: manage workspace members with roles (`viewer`/`editor`/`admin`)
- [x] API: list user's workspaces with membership roles
- [ ] UI (Settings/Paramètres): replace workspace selector with table showing (column order):
  - Selected state (checkmark if selected, empty otherwise)
  - Workspace name
  - Role (viewer/editor/admin)
  - Action buttons (hide/unhide, delete if hidden)
  - Row clickable to select workspace (hover: "Click to select workspace")
  - Action buttons: icons only, no text/border (`@lucide/svelte` style)
- [x] UI: remove `shareWithAdmin` toggle
- [x] Enforce role checks in existing mutation endpoints/tools (viewer blocks writes; editor/admin allowed)

**Partial UAT (after Lot 1):**
- [x] **User A creates workspace:**
  - [x] User A goes to Settings/Paramètres
  - [x] User A creates a new workspace "Workspace Alpha"
  - [x] Verify User A is automatically admin of "Workspace Alpha"
  - [x] Verify "Workspace Alpha" appears in User A's workspace list
- [x] **User A adds User B with viewer role:**
  - [x] User A adds User B (by email) to "Workspace Alpha" with role `viewer`
  - [ ] User B logs in and switches to "Workspace Alpha"
  - [ ] UI: create actions are hidden/disabled (no "plus" buttons) for organizations/folders/use cases
  - [ ] UI: User B cannot access creation pages (`/organisations/new`, `/dossier/new`) → redirected with a read-only message
  - [ ] UI: inline editors (`EditableInput`) are locked (no typing, no save)
  - [ ] UI: delete/trash actions are hidden on lists and detail views (no misleading "success" toast)
  - [ ] API: if a mutation is still attempted (manual call), it is blocked (403)
  - [ ] User B can view all objects (read-only works)
- [ ] **User A changes User B role to editor:**
  - [ ] User A updates User B membership to role `editor`
  - [ ] User B refreshes and tries to edit an organization → succeeds (200)
  - [ ] User B tries to delete a folder → succeeds (200)
  - [ ] User B tries to manage workspace members → blocked (403, admin-only)
  - [ ] User B tries to delete/archive workspace → blocked (403, admin-only)
- [ ] **User A promotes User B to admin:**
  - [ ] User A updates User B membership to role `admin`
  - [ ] User B refreshes and can now manage members (add/remove/change roles)
  - [ ] User B can hide/unhide the workspace (action buttons visible in workspace table)
  - [ ] User B can perform final suppression/export of the workspace (only if hidden, delete button visible)
- [ ] **Workspace hide/unhide:**
  - [ ] User A (admin) hides "Workspace Alpha"
  - [ ] Verify workspace appears as hidden in workspace table
  - [ ] Verify unhide button is visible for User A
  - [ ] User A unhides "Workspace Alpha"
  - [ ] Verify workspace appears as active again
- [ ] **Workspace final suppression:**
  - [ ] User A hides "Workspace Alpha"
  - [ ] User A clicks delete button (only visible when hidden)
  - [ ] Verify confirmation dialog appears
  - [ ] User A confirms → workspace and all data cascade-deleted
- [ ] **Workspace selector table:**
  - [ ] User A opens Settings and sees workspace table
  - [ ] Verify table columns order: selected state (checkmark or empty), workspace name, role (viewer/editor/admin), action buttons
  - [ ] Verify hover on row shows "Click to select workspace"
  - [ ] Verify hover on action buttons does NOT show row message
  - [ ] User A clicks a row → workspace selected, checkmark updates
  - [ ] Verify action buttons are icons only (no text/border)
- [ ] **Workspace isolation:**
  - [ ] User A creates "Workspace Beta" (separate from "Workspace Alpha")
  - [ ] User A creates an organization in "Workspace Beta"
  - [ ] User B (only member of "Workspace Alpha") cannot see "Workspace Beta" organizations
  - [ ] User B tries to select "Workspace Beta" in table → access denied (not a member)

### Lot 2 — Object edition locks + unlock workflow (API + SSE + UI)
- [ ] Define lock keys (workspaceId + objectType + objectId [+ optional sectionKey])
- [ ] API: acquire lock on first editor entering view; block concurrent editors
- [ ] API: publish lock state to SSE for viewers/locked editors
- [ ] UI: lock indicator + disable editing when locked by another user
- [ ] UI: "Request unlock" flow
- [ ] API: handle unlock request:
  - Refuse immediately if another unlock request is already processing
  - Notify current lock holder via SSE
  - If no answer in 2s: transfer lock to requester and notify via SSE
  - If holder responds: accept (transfer) or refuse (keep)

**Partial UAT (after Lot 2):**
- [ ] **User A locks an object:**
  - [ ] User A opens a use case detail page (editor/admin role)
  - [ ] Verify User A acquires lock automatically
  - [ ] Verify UI shows "You are editing" indicator
- [ ] **User B sees locked view:**
  - [ ] User B (editor/admin) opens the same use case detail page
  - [ ] Verify User B sees "Locked by User A" indicator
  - [ ] Verify User B's edit controls are disabled
  - [ ] Verify User B can still view the object (read-only)
- [ ] **User A edits while User B watches:**
  - [ ] User A makes an edit (e.g., updates use case name)
  - [ ] Verify User B receives SSE update and sees the change in real-time
  - [ ] Verify User B's view refreshes automatically
- [ ] **User B requests unlock (User A active):**
  - [ ] User B clicks "Request unlock" button
  - [ ] Verify API refuses if another unlock request is already processing
  - [ ] Verify User A receives SSE notification: "User B requests unlock"
  - [ ] User A clicks "Accept" → verify lock transfers to User B
  - [ ] Verify User A's UI switches to locked view
  - [ ] Verify User B's UI switches to editing mode
- [ ] **User B requests unlock (User A inactive/timeout):**
  - [ ] User A has lock but is inactive (no heartbeat for >2s)
  - [ ] User B clicks "Request unlock"
  - [ ] Wait 2 seconds
  - [ ] Verify lock auto-transfers to User B (timeout)
  - [ ] Verify User B receives SSE notification: "Unlock granted"
  - [ ] Verify User B's UI switches to editing mode
- [ ] **User A refuses unlock:**
  - [ ] User A has lock and is active
  - [ ] User B requests unlock
  - [ ] User A clicks "Refuse"
  - [ ] Verify lock remains with User A
  - [ ] Verify User B receives SSE notification: "Unlock refused"
  - [ ] Verify User B's UI stays locked

### Lot 3 — Import/export (workspace, folder, use cases, organizations)
- [ ] API: export endpoints producing ZIP archives:
  - Workspace export (`.topw`)
  - Folder export (`.topf`)
  - Use case export (`.topu`)
  - Organization export (`.topo`)
- [ ] API: import endpoints consuming those archives (admin/editor constraints)
- [ ] Include optional documents when applicable (using existing storage abstraction)
- [ ] UI: add import/export actions in the relevant screens
- [ ] Export option: with/without comments

**Partial UAT (after Lot 3):**
- [ ] **Export workspace (with comments):**
  - [ ] User A creates a workspace with organizations, folders, use cases, and comments
  - [ ] User A exports workspace as `.topw` file with "Include comments" checked
  - [ ] Verify ZIP contains: workspace JSON, organizations JSON, folders JSON, use cases JSON, comments JSON, documents (if any)
  - [ ] Verify ZIP metadata includes DB migration version
- [ ] **Import workspace:**
  - [ ] User B creates a new workspace "Workspace Gamma"
  - [ ] User B imports the `.topw` file exported by User A
  - [ ] Verify all organizations are recreated in "Workspace Gamma"
  - [ ] Verify all folders are recreated with correct organization relations
  - [ ] Verify all use cases are recreated with correct folder relations
  - [ ] Verify comments are recreated with correct assignments
  - [ ] Verify documents are restored and linked correctly
- [ ] **Export workspace (without comments):**
  - [ ] User A exports workspace again with "Exclude comments" checked
  - [ ] Verify ZIP does NOT contain comments JSON
  - [ ] Verify organizations/folders/use cases are still present
- [ ] **Export folder:**
  - [ ] User A exports a folder as `.topf` file
  - [ ] Verify ZIP contains: folder JSON, use cases JSON, documents (if any)
  - [ ] User B imports `.topf` into a different workspace
  - [ ] Verify folder and use cases are recreated with proper relations
- [ ] **Export use case(s):**
  - [ ] User A selects multiple use cases and exports as `.topu` file
  - [ ] Verify ZIP contains: use cases JSON array, documents (if any)
  - [ ] User B imports `.topu` into a folder
  - [ ] Verify use cases are recreated and linked to target folder
- [ ] **Export organization(s):**
  - [ ] User A selects an organization and exports as `.topo` file
  - [ ] Verify ZIP contains: organization JSON, documents (if any)
  - [ ] User B imports `.topo` into a workspace
  - [ ] Verify organization is recreated
- [ ] **Import permission checks:**
  - [ ] User B (viewer role) tries to import a workspace → blocked (403)
  - [ ] User B (editor role) can import → succeeds (200)
  - [ ] User B (admin role) can import → succeeds (200)

### Lot 4 — Comments (table + UI + @mentions + close)
- [ ] DB: comments table + relations (object + section)
- [ ] API: CRUD comments + one-level replies
- [ ] API: @mention assignment with autocomplete (workspace users)
- [ ] API: close comment (only last assigned user; rule to confirm)
- [ ] UI: show comment indicator on header of the relevant "data part" cards

**Partial UAT (after Lot 4):**
- [ ] **User A creates comment:**
  - [ ] User A opens a use case detail page
  - [ ] User A creates a comment on a data section (e.g., "description" field)
  - [ ] Verify comment appears in the section header indicator
  - [ ] Verify comment creator is User A (default assignee if no @mention)
- [ ] **User B replies (one-level):**
  - [ ] User B opens the same use case
  - [ ] User B replies to User A's comment
  - [ ] Verify reply appears nested under User A's comment
  - [ ] Verify User B cannot reply to the reply (one-level only enforced)
- [ ] **User A assigns via @mention:**
  - [ ] User A edits the comment and types "@User B"
  - [ ] Verify autocomplete shows only workspace members (User A, User B)
  - [ ] Verify autocomplete does NOT show users from other workspaces
  - [ ] User A selects User B from autocomplete
  - [ ] Verify comment assignment updates to User B
  - [ ] Verify User B receives notification (if implemented)
- [ ] **User B closes comment:**
  - [ ] User B (last assigned user) closes the comment
  - [ ] Verify comment status changes to "closed"
  - [ ] Verify User A cannot close the comment (not the last assigned)
  - [ ] Verify only User B can reopen/close the comment
- [ ] **Comment indicators:**
  - [ ] User A creates multiple comments on different sections
  - [ ] Verify each section header shows comment count badge
  - [ ] Clicking badge opens comment panel with relevant comments
- [ ] **Export with/without comments:**
  - [ ] User A exports use case with "Include comments" → verify comments in ZIP
  - [ ] User A exports use case with "Exclude comments" → verify comments NOT in ZIP
  - [ ] User B imports both versions and verifies comment presence/absence

### Lot 5 — Finalization: schema/migration, docs, automated tests (run at end)
- [ ] Apply the **single planned schema evolution** (one migration file for entire branch - see Migration Strategy in Design Decisions)
- [ ] Update `spec/DATA_MODEL.md` to match `api/src/db/schema.ts`
- [ ] Generate/update OpenAPI artifacts if needed (`make openapi-*`)
- [ ] Create automated tests (only now):
  - `make test-api` coverage for roles/locks/comments/import-export
  - `make test-ui` coverage for core UI flows
  - `make test-e2e` for critical collaboration journeys
- [ ] Run full gates (after UAT is completed): `make typecheck lint test-api test-ui test-e2e` (exact sequence to confirm)

**Full UAT (final):**
- [ ] **Complete workspace collaboration flow:**
  - [ ] User A creates "Workspace Delta" and adds User B as `editor`
  - [ ] User A creates an organization and folder in "Workspace Delta"
  - [ ] User B switches to "Workspace Delta" and creates a use case
  - [ ] User A and User B both view the use case simultaneously
  - [ ] User A acquires edit lock; User B sees locked view
  - [ ] User A edits use case; User B receives SSE updates
  - [ ] User B requests unlock; User A accepts; lock transfers to User B
  - [ ] User B creates a comment with @mention to User A
  - [ ] User A replies to comment; User B closes it
  - [ ] User A exports workspace with comments as `.topw`
  - [ ] User A soft-deletes "Workspace Delta"
  - [ ] User B tries to access → sees archived workspace
  - [ ] User A undeletes "Workspace Delta"; User B can access again
  - [ ] User A performs final suppression; all data cascade-deleted
  - [ ] User B cannot access "Workspace Delta" anymore
- [ ] **Cross-workspace isolation:**
  - [ ] User A has "Workspace Epsilon" (private, no members)
  - [ ] User B has "Workspace Zeta" (private, no members)
  - [ ] Verify User A cannot see User B's data
  - [ ] Verify User B cannot see User A's data
  - [ ] Verify SSE updates are workspace-scoped (no cross-workspace leaks)
- [ ] **Role enforcement across all endpoints:**
  - [ ] User B (viewer) attempts all mutation endpoints → all blocked
  - [ ] User B (editor) attempts mutations → all succeed
  - [ ] User B (editor) attempts member management → blocked
  - [ ] User B (admin) attempts all operations → all succeed

## Data Model Strategy (single evolution)
Design goal: add only what is required for collaboration, keep compatibility, avoid broad refactors.

Planned entities (to validate against current schema to avoid duplicates):
- Workspaces (if not already present): metadata + ownership/admin constraints
- Workspace memberships: `userId`, `workspaceId`, `role`, timestamps
- Object locks: `workspaceId`, `objectType`, `objectId`, `lockedByUserId`, `lockedAt`, `heartbeat/ttl`
- Unlock requests: state machine + timeouts, tied to object lock
- Comments: `workspaceId`, target object reference, optional `sectionKey`, `createdBy`, `assignedTo?`, `status`, `parentCommentId?` (one-level enforced)

## Commits & Progress
- [x] **docs:** add collaboration BRANCH.md plan with detailed UAT scenarios (commit 409808f)
- [x] **docs:** complete Lot 0 discovery findings in BRANCH.md (commit 06fd208)
- [x] **fix(collab):** unblock `/workspaces` bootstrap when localStorage scope is stale (commit fd4aa24)
- [x] **fix(admin):** avoid duplicate users in `/admin/users` (commit df4ce2f)
- [x] **feat(collab):** lock `EditableInput` in read-only workspace scope (commit 57392a1)
- [x] **fix(collab):** enforce viewer read-only in UI (hide create/delete, block drafts) (commit 2323947)

## Related Documentation

- **Specification**: See `spec/COLLAB.md` for detailed feature specification (will be completed during UAT phases).

## Status
- **Progress**: 1/6 lots completed (Lot 0 done)
- **Current**: Lot 1 — workspace sharing fundamentals (create/hide/delete, memberships, roles)
- **Next**: implement workspace CRUD + membership management + role enforcement + workspace selector table UI

### Lot 1 progress notes
- Migration `api/drizzle/0018_workspace_collaboration.sql` is now present and registered in `api/drizzle/meta/_journal.json`.
- Work-in-progress code is kept compilable; no `shareWithAdmin` references remain in API/DB schema.
- UI groundwork: added `workspaceScope` (localStorage) and append `workspace_id` to API requests + SSE for non-admin users.
- Fix: avoid a bootstrap deadlock where a stale localStorage `workspace_id` prevents `/workspaces` from loading:
  - API auth: ignore invalid `workspace_id` for `/workspaces` and `/me` instead of returning opaque 404
  - UI API util: never attach `workspace_id` to `/workspaces` endpoints


