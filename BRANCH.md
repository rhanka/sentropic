# Feature: Show folder and organization on use case detail view

## Objective
Improve the use case detail view by displaying:
- The folder name the use case belongs to
- The organization (company) owning that folder

Scope is UI-only unless the API is missing required fields.

## Plan / Todo
- [x] UI: Load folder details on `/cas-usage/[id]` and display folder name (with link to folder page)
- [x] UI: Resolve and display organization name (with link to organization page)
- [x] Tests: Run UI tests via Make before committing
- [x] Docs: Update TODO.md (check items + reference branch/PR) and update RELEASE.md if needed

Notes:
- Display changes were iterated based on feedback:
  - Use case detail now shows an organization pill next to the model badge (no folder banner).
  - Use cases main page shows the folder name (editable) instead of the generic page title.
  - Folder cards show organization name in blue.

## Commits & Progress
- [x] **Commit 1** (5c5936f): UI: show organization badge on use case detail
- [x] **Commit 2** (874e56c): UI: make folder name editable on use cases page (2/3 editable + 1/3 tags)
- [x] **Commit 3** (6749d83): UI: folder cards show organization name in blue
- [x] **Commit 4** (67723bc): Docs: update TODO status for use case view
- [ ] **Commit 5**: Docs: update BRANCH.md with final status (this commit)

## Status
- **Progress**: 4/4 tasks completed
- **Current**: Ready to push branch
- **Next**: Push to origin, then open/update PR


