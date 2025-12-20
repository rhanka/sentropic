# Feature: Admin approval + user workspaces (private-by-default)

## Objective
Define and implement an onboarding and authorization model where:
- new users can use the app immediately (trial window),
- an admin must approve their rights within 48h, otherwise access becomes invalid,
- each user has an isolated workspace/namespace (private-by-default),
- admins cannot access user objects unless explicitly shared by the user,
- users can deactivate or permanently delete their account (immediate data deletion).

## Plan / Todo
- [ ] Write spec: `spec/SPEC_ADMIN_USERS.md` (source of truth for this feature).
- [ ] Align existing RBAC model (roles) with new account status/approval rules.
- [ ] Data model proposal (workspaces + ownership / sharing flags) + migration plan.
- [ ] API surface proposal (me/workspace/admin approval endpoints) + security constraints.
- [ ] UI proposal (Settings: workspace, privacy, account; Admin panel: approvals).
- [ ] Test plan (unit/integration/e2e) focusing on tenancy boundaries (IDOR) and approval expiry.

## Commits & Progress
- [ ] **Commit 1**: docs(spec): add SPEC_ADMIN_USERS.md
- [ ] **Commit 2**: docs: update TODO.md (check item + reference)
- [ ] **Commit 3+**: (implementation to follow after spec approval)

## Status
- **Progress**: 0/?
- **Current**: Writing spec
- **Next**: Validate open questions (exact meaning of "unlimited usage profile", admin scope expectations, migration strategy for existing shared data)


