# Feature: Collaboration Part 2 — Import/Export + Comments

## Objective
Deliver Collaboration Part 2 from `TODO.md` (import/export + comments) with a single data model evolution, clear UAT lots, and complete test coverage across API/UI/E2E.

## Existing Analysis
- Collaboration Part 1 is already implemented (workspaces, locks, SSE presence).
- `spec/COLLAB.md` already defines comment and import/export behavior and UAT flows.
- Comments are not implemented (no CRUD endpoints, no UI indicator, no data model table).
- Import/Export formats are defined but must move to generic `.zip` with JSON payloads.
- One migration is allowed for the entire branch.

## Scope / Guardrails
- Scope limited to Collaboration Part 2 items only.
- Single data model evolution only; if another patch is needed, reset with `make db-restore BACKUP_FILE=prod-2026-01-25T17-18-10.dump`.
- Docker-only; all commands via `make`.
- All code and Markdown in English; user communication in French.
- Each committable lot must pass `make typecheck` and `make lint`.
- Final tests (after user UAT): `make test-api`, `make test-ui`, `make clean test-e2e`.

## Plan / Todo (detailed, lot-based)
- [x] **Lot 0 — Analysis and touchpoints**
    - [x] Review `spec/COLLAB.md` and extract comment + import/export requirements.
    - [x] Review `spec/DATA_MODEL.md` for current schema constraints and tenancy rules.
    - [x] Map API touchpoints:
        - [x] Routes to extend/create (comments, export, import).
        - [x] Services/helpers to reuse (documents storage, workspace scope, auth/roles).
        - [x] SSE events to emit or extend (if comment updates are streamed).
    - [x] Map UI touchpoints:
        - [x] Pages/sections needing comment indicators (use case, folder, organization).
        - [x] Comment panel and composer integration points.
        - [x] Import/Export entry points in UI (menus, settings, or object actions).
    - [x] Confirm data ownership rules:
        - [x] Workspace scoping for comments and archives.
        - [x] Role enforcement (viewer/editor/admin) for mutations.
    - [x] Identify existing export tooling:
        - [x] Any existing ZIP helpers or document export logic.
        - [x] Any existing metadata/versioning for migrations in archives.
    - [x] Output of Lot 0 (documented in BRANCH.md as notes or checklist):
        - [x] List of endpoints to add/update.
        - [x] List of UI components/pages to update.
        - [x] Decision on SSE usage for comments.
        - [x] Create new spec `spec/SPEC_COLLAB_IMPORT_EXPORT_COMMENTS.md` (initial draft).
        - [x] Notes captured:
            - [x] API endpoints (to add/update):
                - [x] New `api/src/routes/api/comments.ts` + register in `api/src/routes/api/index.ts`.
                - [x] Workspace member list for @mentions: new read-only endpoint (e.g. `GET /workspaces/:id/members/mentions`).
                - [x] Import/Export endpoints (generic):
                    - [x] `POST /exports` with `{ scope, scope_id?, include_comments, include_documents }`.
                    - [x] `POST /imports` with `{ target_workspace_id?, mode }` + ZIP upload.
                    - [x] Extend scope to include `matrix`.
            - [x] API helpers/services to reuse:
                - [x] `workspace-access.ts` + `workspace-rbac.ts` for role enforcement.
                - [x] `storage-s3.ts` for document blobs (export/import archives).
                - [x] `documents.ts` upload pattern (multipart form data).
                - [x] `stream-service.ts` / `streams.ts` for SSE event shape.
            - [x] UI touchpoints:
                - [x] Use case detail: `ui/src/routes/cas-usage/[id]/+page.svelte` + `UseCaseDetail.svelte`.
                - [x] Folder detail: `ui/src/routes/dossiers/[id]/+page.svelte`.
                - [x] Organization detail: `ui/src/routes/organisations/[id]/+page.svelte` + `OrganizationForm.svelte`.
                - [x] Workspace settings entry point for import/export: `WorkspaceSettingsPanel.svelte` (Settings page).
            - [x] SSE decision:
                - [x] Add `comment_update` SSE events scoped by context (object type + id) for live badge updates.
            - [x] Export tooling status:
                - [x] No existing ZIP helper; use a new archive helper with storage-s3 for document blobs.
                - [x] Add `manifest.json` with schema/migration version + file hashes (integrity).
                - [x] Export as generic `.zip` with JSON files inside (no custom extension).
                - [x] Import behavior: if `target_workspace_id` missing, API creates a new workspace and maps ids.
                - [x] If `target_workspace_id` exists, merge into it; if unknown or not admin-owned, refuse.

- [ ] **Lot 1 — Data model (single change)**
    - [x] Finalize the `comments` table fields and indexes (one-level replies, workspace scope).
    - [x] Update `api/src/db/schema.ts`.
    - [x] Add exactly one migration in `api/drizzle/`.
    - [x] Update `spec/DATA_MODEL.md` right after migration.
    - [x] Confirm no further schema changes will be needed.
    - [x] `make typecheck` + `make lint`
    - [ ] UAT lot 1 (user-run)
        - [ ] Verify no user-facing changes yet (schema only).

- [ ] **Lot 2 — Comments API**
    - [ ] Add comment CRUD endpoints (create, list, reply, update, close).
    - [ ] Enforce workspace scoping and role rules (viewer read-only).
    - [ ] Implement @mention assignment (autocomplete source via workspace members).
    - [ ] Implement close rules (only last assigned user can close).
    - [ ] Return comment counts for sections if needed by UI.
    - [ ] `make typecheck` + `make lint`
    - [ ] UAT lot 2 (user-run)
        - [ ] Create a comment on a Use Case section (e.g., description).
        - [ ] Create a one-level reply.
        - [ ] Verify default assignee is the creator if no @mention.
        - [ ] Close the comment as the assignee.

- [ ] **Lot 3 — Comments UI**
    - [ ] Add comment indicators on section headers/cards.
    - [ ] Add comment panel listing + one-level replies.
    - [ ] Add @mention autocomplete in composer.
    - [ ] Add close/reopen flow (respect role + last assignee).
    - [ ] `make typecheck` + `make lint`
    - [ ] UAT lot 3 (user-run)
        - [ ] Type `@` and ensure autocomplete is restricted to workspace members.
        - [ ] Assign a comment to another user and verify assignee changes.
        - [ ] Add multiple comments across sections.
        - [ ] Verify header badges display counts and update live.

- [ ] **Lot 4 — Import/Export API**
    - [ ] Implement generic export endpoint for `.zip` (scope-based, include `matrix`).
    - [ ] Add export options (include/exclude comments, include/exclude documents).
    - [ ] Implement generic import endpoint with validation and workspace scoping.
    - [ ] Support importing into another workspace (`target_workspace_id`).
    - [ ] Ensure documents follow S3 layout and are included/excluded per spec.
    - [ ] Enforce import rules:
        - [ ] If `target_workspace_id` is missing, API creates a new workspace.
        - [ ] If `target_workspace_id` exists, merge into it (no id override from UI).
        - [ ] If `target_workspace_id` does not exist, refuse (do not create with UI-provided id).
        - [ ] If `target_workspace_id` is not admin-owned by requester, refuse.
    - [ ] `make typecheck` + `make lint`
    - [ ] UAT lot 4 (user-run)
        - [ ] Export `.zip` with comments.
        - [ ] Export `.zip` without comments.
        - [ ] Import back and verify comment presence/absence.
        - [ ] Import into another workspace (target selected).

- [ ] **Lot 5 — Import/Export UI**
    - [ ] Add UI actions for export with options.
    - [ ] Add UI for import and result reporting.
    - [ ] `make typecheck` + `make lint`
    - [ ] UAT lot 5 (user-run)
        - [ ] Trigger export from UI with options (comments/documents).
        - [ ] Trigger import from UI and verify success state and counts.
        - [ ] Import into another workspace via target selector.

- [ ] **Lot 6 — Docs (spec updates)**
    - [ ] Complete `spec/SPEC_COLLAB_IMPORT_EXPORT_COMMENTS.md`.
    - [ ] Merge/align into `spec/COLLAB.md` (global source of truth).
    - [ ] Update `spec/DATA_MODEL.md` after schema is finalized.
    - [ ] Update `spec/COLLAB.md` with final API/UI behaviors and UAT notes.
    - [ ] Update `spec/SPEC.md` if new endpoints/screens are introduced.
    - [ ] Verify doc consistency with `TODO.md` scope.

- [ ] **Lot 7 — Tests + Final validation**
    - [ ] API tests:
        - [ ] New `tests/api/comments.test.ts`: CRUD, replies, @mention assignment, close rules.
        - [ ] Update `tests/security/collaboration-security.test.ts`: role/tenancy for comments + import/export.
        - [ ] Update `tests/api/workspaces.test.ts`: export/import scoping + visibility.
        - [ ] Update `tests/api/locks.test.ts`: comments do not break lock presence.
        - [ ] Update `tests/api/use-cases.test.ts`: comment counts/metadata if returned.
        - [ ] Regression: `tests/api/organizations.test.ts`, `tests/api/folders.test.ts` for export/import.
    - [ ] UI tests:
        - [ ] Update `tests/stores/useCases.test.ts`: comment count indicators and store updates.
        - [ ] Update `tests/stores/folders.test.ts`: comment badge propagation (if needed).
        - [ ] Update `tests/utils/api.test.ts`: client helpers for comments/export endpoints.
        - [ ] Update `tests/stores/workspaceScope.test.ts`: @mention autocomplete scoped by workspace members.
    - [ ] E2E tests:
        - [ ] Update `05-usecase-detail.spec.ts`: comment create/reply/close + header badge.
        - [ ] Update `04-tenancy-workspaces.spec.ts`: @mention autocomplete scope + isolation.
        - [ ] Update `08-workflow.spec.ts` (or new `09-import-export.spec.ts`): export/import round-trip (generic ZIP + target workspace).
        - [ ] Update `00-access-control.spec.ts`: viewer/editor/admin comment permissions.
    - [ ] Run gates: `make typecheck` + `make lint`.
    - [ ] Final tests: `make test-api`, `make test-ui`, `make clean test-e2e`.

## Data Model (single evolution)
- Add `comments` table (workspace-scoped, one-level replies).
- Keep all schema changes within **one migration** only.
- Update `spec/DATA_MODEL.md` immediately after migration.

## Specs to Complete (spec/*)
- `spec/COLLAB.md`: update with final API/UI behaviors + UAT validation notes.
- `spec/DATA_MODEL.md`: align with final schema.
- `spec/SPEC.md`: update if new screens/endpoints need documentation.
- `spec/TOOLS.md` and `spec/JSON_STREAMING.md`: only if import/export tooling affects logging/streaming.

## Documentation Timing
- After data model + API stabilized: update `spec/DATA_MODEL.md`.
- After UI behavior finalized: update `spec/COLLAB.md`.
- Before final tests: ensure `spec/SPEC.md` references new endpoints.

