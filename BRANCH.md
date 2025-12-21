# Feature: Admin approval + user workspaces (private-by-default)

## Objective
Define and implement an onboarding and authorization model where:
- new users can use the app immediately (trial window),
- an admin must approve their rights within 48h, otherwise access becomes invalid,
- each user has an isolated workspace/namespace (private-by-default),
- admins cannot access user objects unless explicitly shared by the user,
- users can deactivate or permanently delete their account (immediate data deletion).

## Plan / Todo
- [x] Write spec: `spec/SPEC_ADMIN_USERS.md` (source of truth for this feature).
- [x] Align RBAC with account-status rules (trial + approval window).
- [x] Data model: `workspaces` + `workspace_id` scoping (private-by-default).
- [x] Migrations: add workspaces + backfill via default Admin Workspace.
- [x] API enforcement: systematic workspace scoping (anti-IDOR) across main resources.
- [x] Admin approval APIs (approve/reactivate/disable/list users) + audit fields.
- [x] User self-service APIs (`/me`: workspace privacy, deactivate, delete account).
- [x] Test updates: unit/api/ai tests adjusted to tenancy + new onboarding rules.
- [ ] UI: Settings (workspace privacy, account deactivate/delete), Admin panel (approvals).
- [ ] E2E tests for tenancy boundaries + approval expiry downgrade (guest) + blocking if email not verified.

## Commits & Progress
- [ ] **Commit set**: docs + tooling + db + auth + api + tests (see `git log`)

## Status
- **Progress**: backend ✅ / UI ⏳
- **Current**: Backend implemented (workspaces + approval), including `/api/v1/admin/users/*` and `/api/v1/me/*`; tests passing locally.
- **Next**:
  - UI screens + flows (trial banner, pending approval, expired downgrade to guest)
  - Account suppression UX (confirmations) + E2E tests


