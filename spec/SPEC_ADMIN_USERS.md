# SPEC: Admin approval + private workspaces (user namespace)

Status: Draft

## Context
The app currently has a minimal role-based access control (RBAC) model with roles:
- `guest` < `editor` < `admin_org` < `admin_app`

Core business routes are protected by `requireEditor` (API) and the UI relies on `/auth/session` to obtain `role`.

However, the business data model (`companies`, `folders`, `use_cases`) is not scoped to a user or workspace yet (no owner/tenant columns). This means data is effectively shared across all authenticated users, which conflicts with a "private-by-default" workspace/namespace requirement.

This spec introduces:
- an **admin approval workflow** with a **48h approval deadline**,
- **user workspaces** with strict data isolation,
- **admin visibility** that is disabled by default (only possible when user shares),
- **self-service account deactivation and deletion** (immediate data deletion on delete).

## Goals
- New users can use the product immediately after enrollment (trial window).
- An admin must approve the user within **48 hours**; otherwise access is invalidated.
- Each user has their own workspace/namespace by default; their objects are isolated.
- Admins cannot access user objects by default; only if the user explicitly enables sharing with admin.
- The Settings panel allows the user to manage their own namespace (workspace) and account lifecycle.
- Users can deactivate their account or permanently delete it; deletion removes data immediately.

## Non-goals (initial iteration)
- Full multi-organization (team) workspaces and collaboration (future TODO exists).
- Fine-grained per-object sharing between users (beyond "share with admin").
- Billing, payments, and full quota enforcement (we will define the model but may implement later).

## Definitions
- **Account status**: independent from RBAC role; used to enable/disable access.
- **Approval**: an explicit admin action that validates the user rights/profile.
- **Approval deadline**: `approvalDueAt = createdAt + 48h`.
- **Workspace / namespace**: logical tenant boundary owning all user data objects.
- **Share with admin**: user-controlled flag allowing admin to access user objects.

## Current system snapshot (for alignment)
- **Roles**: `admin_app`, `admin_org`, `editor`, `guest` (API: `api/src/middleware/rbac.ts`, UI: `ui/src/lib/stores/session.ts`).
- **New user role today**: defaults to `guest` (except first `admin_app` via `ADMIN_EMAIL`).
- **Session validation**: checks JWT + session existence + `emailVerified` (no account status checks yet).
- **Settings UI**: currently an admin-oriented screen (prompts, AI settings, queue, reset) and is protected by admin routes.

## Proposed model

### 1) Account status & approval
Add explicit fields to `users` (names in DB are illustrative; confirm exact naming during implementation):
- `accountStatus`: enum-like text
  - `active`
  - `pending_admin_approval`
  - `disabled_by_user`
  - `disabled_due_to_missing_approval`
  - `disabled_by_admin`
- `approvalDueAt`: timestamp (set at enrollment, now + 48h)
- `approvedAt`: timestamp nullable
- `approvedByUserId`: text nullable (FK to `users.id` - admin user)
- `disabledAt`: timestamp nullable
- `disabledReason`: text nullable

**Rules**
- Email verification is a hard prerequisite for any access: if `emailVerified=false`, the user is fully blocked (no read-only).
- On enrollment: `accountStatus = pending_admin_approval`, `approvalDueAt = now + 48h`.
- Access is allowed while pending and `now <= approvalDueAt`.
- If `now > approvalDueAt` and still not approved: user becomes **read-only** (`guest`) until approval happens.
- Admin can approve at any time (within or after the deadline), which unlocks full access again.
- Admin can disable/re-enable at any time.
- User can self-disable (deactivate) at any time; user can self-reactivate.

### 2) Roles vs "profiles" (unlimited usage)
At this stage, we do **not** implement quotas (number of objects, model restrictions, number of calls).

The "unlimited usage profile" is effectively the default behavior for any user with full access (i.e., role `editor` or higher) within their own private workspace.

We keep the existing RBAC roles as-is for route protection.

Future (out of scope for this iteration):
- Add an `entitlementProfile` field to support freemium/paid and model restrictions.

### 3) Private workspace/namespace
Introduce a `workspaces` table and scope business objects by workspace:
- `workspaces`
  - `id` (uuid/text)
  - `ownerUserId` (FK to `users.id`, unique)
  - `name` (text)
  - `shareWithAdmin` (boolean, default false)
  - timestamps (`createdAt`, `updatedAt`)

Add `workspaceId` (FK to `workspaces.id`) to:
- `companies`
- `folders`
- `use_cases`
- (recommended) chatbot tables: `chat_sessions`, `chat_contexts`, `context_modification_history` and any other table where object IDs are referenced

**Access rule**
- All CRUD on business objects must filter by `workspaceId = currentUser.workspaceId`.
- Role `admin_*` does not bypass workspace filters by default.
- Admin access to user objects is only allowed if `workspaces.shareWithAdmin = true` (or a more granular model, see below).

### 4) Share-with-admin semantics
Default: `shareWithAdmin = false`.

If user enables sharing, admin access is allowed via explicit admin endpoints (not via normal user routes) to avoid accidental leakage.

Decision:
- **Option A (workspace-level share)** is selected for the first implementation.
- **Option B (per-object share)** is explicitly deferred (track in `TODO.md`).

## Workflows

### Enrollment (new user)
1. User verifies email and registers WebAuthn device.
2. System creates `users` row (if not existing) with:
   - `role = editor` (to allow immediate full app usage; no quotas at this stage),
   - `accountStatus = pending_admin_approval`,
   - `approvalDueAt = now + 48h`,
   - (no entitlement/quota fields in this iteration).
3. System creates default workspace:
   - `workspaces.ownerUserId = users.id`,
   - `shareWithAdmin = false`.
4. User can use UI and create objects in their workspace immediately.

### Automatic invalidation after 48h (if not approved)
On every authenticated API request (session validation path):
- If `accountStatus = pending_admin_approval` and `now > approvalDueAt`:
  - transition to a read-only state (keep status explicit, e.g. `approval_expired_readonly`),
  - revoke all sessions (logout everywhere) so that the next login gets the reduced effective role,
  - allow login again but enforce **read-only** permissions (`guest`) until admin approval.

Optionally (recommended):
- Add a background sweep job (using existing Postgres queue) to move overdue users to read-only without waiting for the next API call.
  - Decision: **accepted** (we will implement it).

### Admin approval
Admin (`admin_app`) sees list of pending users and can:
- approve user (sets `approvedAt`, `approvedByUserId`, `accountStatus = active`)
- set entitlement profile (e.g. keep `trial_unlimited` or set to `standard`)
- optionally change role (e.g. keep `editor`, or downgrade to `guest`)

### Admin reactivation
Admin can re-enable a disabled user:
- set `accountStatus = active`
- revoke stale sessions (optional) and require re-login

### User self-deactivate
User triggers deactivation:
- set `accountStatus = disabled_by_user`
- revoke all sessions
- keep data intact

### User self-reactivate
User triggers self-reactivation:
- if user is approved: set `accountStatus = active`
- if user is not approved and approval window is still valid: set `accountStatus = pending_admin_approval`
- if user is not approved and approval window has expired: keep in read-only state (until admin approval)

### User deletion (immediate)
User triggers permanent deletion:
- hard delete user row (`DELETE FROM users WHERE id = ...`)
- cascade delete workspace and all owned objects
- revoke all sessions

This must be immediate and irreversible (no recycle bin).

## API surface (proposal)

### User-facing
- `GET /api/v1/me`
  - returns user info, account status, approval deadline, workspace meta, share flag, effective role
- `PATCH /api/v1/me`
  - update `displayName` (and other safe profile fields)
- `POST /api/v1/me/deactivate`
  - self-deactivate + revoke sessions
- `POST /api/v1/me/reactivate`
  - self-reactivate (see workflow rules)
- `DELETE /api/v1/me`
  - delete account + immediate data deletion + revoke sessions

- `GET /api/v1/workspace`
  - current workspace info (name, shareWithAdmin)
- `PATCH /api/v1/workspace`
  - update workspace name, toggle `shareWithAdmin`

### Admin-facing (admin_app only)
- `GET /api/v1/admin/users?status=pending_admin_approval`
- `POST /api/v1/admin/users/:userId/approve`
- `POST /api/v1/admin/users/:userId/disable`
- `POST /api/v1/admin/users/:userId/reactivate`
- `GET /api/v1/admin/users/:userId/workspace` (metadata only)
- `GET /api/v1/admin/users/:userId/objects/*` (only if workspace is shared; read-only)

### Error contract (important for UI)
Return structured errors so UI can present the right state:
- `ACCOUNT_DISABLED`
- `APPROVAL_REQUIRED`
- `APPROVAL_EXPIRED`
 - `EMAIL_VERIFICATION_REQUIRED`

## UI changes (proposal)

### Settings (`/parametres`)
Split global admin settings from user settings:
- **My account**
  - status banner (pending approval, due date, disabled)
  - deactivate account
  - delete account (danger zone)
- **My workspace / namespace**
  - rename workspace
  - privacy: toggle "Share my workspace with admin"
  - (optional) export data

### Admin panel
Add a dedicated admin view (visible only for `admin_app`) to:
- list pending approvals, approve/disable/reactivate users
- view whether user has enabled "share with admin"

## Security considerations
- Enforce workspace scoping on all business object queries to prevent IDOR.
- Do not rely on UI-only checks; API must filter by workspace.
- Admin endpoints must not allow bypass unless sharing is enabled.
- Log admin actions (approve/disable/reactivate) in an audit table (recommended):
  - `admin_audit_log` with actor, target, action, timestamp, metadata.

## Migration plan (high-level)
This change introduces tenancy where none exists today.

Recommended approach:
1. Create `workspaces` table.
2. Add nullable `workspace_id` to business tables.
3. Backfill existing rows into an **"Admin Workspace"** that is **not visible to regular users**.
   - Goal: make user data truly private-by-default; do not keep global data visible to all users.
   - Implementation choice:
     - Create a workspace named `"Admin Workspace"` owned by the `admin_app` user (the initial platform admin).
     - Scope this workspace to admin-only access via explicit admin endpoints (separate from user routes).
4. Make `workspace_id` non-null once all rows are backfilled and code enforces it.

## Testing plan
- **Unit**: session validation rejects expired approval; status transitions.
- **Integration**: CRUD routes enforce workspace scoping (no cross-tenant access).
- **E2E**:
  - New user enrolls -> can create objects immediately
  - After simulated deadline expiry (time travel in tests) -> access invalid
  - Admin approves -> user regains access
  - User toggles shareWithAdmin -> admin can/cannot access read-only endpoint
  - User delete -> data gone immediately

## Open questions (need confirmation)
1. (Resolved) "Unlimited usage" has no quotas for now; full access is role `editor` within user's own workspace.
2. (Resolved) Approval expiry -> **read-only** (`guest`) until admin approval. Email not verified -> full block.
3. (Resolved) User self-reactivation is allowed.
4. (Resolved) Share-with-admin is **workspace-wide** (Option A). Per-object is future work.
5. (Resolved direction) Existing global data should be locked down; user data must be private-by-default (via workspace scoping and a system/legacy workspace).

