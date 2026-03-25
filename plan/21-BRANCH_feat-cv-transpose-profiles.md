# Feature: CV Transpose & Profile Management (BR-21)

## Objective
Deliver a CV transpose workflow: upload source CVs, extract structured profiles via LiteParse + LLM, provide a structured profile editor, and export formatted DOCX. Replace `officeparser` with `@llamaindex/liteparse` globally. Store profiles in a dedicated `profiles` table with bid integration.

## Scope / Guardrails
- Scope limited to profile data model, CV extraction pipeline, profile CRUD, DOCX export, LiteParse migration, and bid-profile linking.
- One migration max in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-cv-transpose-profiles`.
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Environment Mapping

| Variable | Value |
|---|---|
| `ENV` | `feat-cv-transpose-profiles` |
| `API_PORT` | `8721` |
| `UI_PORT` | `5121` |
| `MAILDEV_UI_PORT` | `1021` |

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/db/schema.ts` (profiles, bid_profiles, profile_templates tables)
  - `api/src/services/document-text.ts` (LiteParse migration)
  - `api/src/services/profile-*.ts` (new: extraction, DOCX generation)
  - `api/src/routes/api/profiles.ts` (new)
  - `api/src/routes/api/profile-templates.ts` (new)
  - `api/src/routes/api/bids.ts` (extend: bid-profile endpoints)
  - `api/src/workers/profile-extract.worker.ts` (new)
  - `api/assets/profile-templates/**` (new: default templates)
  - `api/tests/**`
  - `ui/src/lib/stores/profiles.ts` (new)
  - `ui/src/lib/stores/profile-templates.ts` (new)
  - `ui/src/lib/components/profiles/**` (new)
  - `ui/src/routes/**/profiles/**` (new)
  - `ui/tests/**`
  - `e2e/tests/**`
  - `api/package.json` (add @llamaindex/liteparse, remove officeparser)
  - `spec/SPEC_EVOL_CV_TRANSPOSE_PROFILES.md`
  - `plan/21-BRANCH_feat-cv-transpose-profiles.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (max 1 file, BR21-EX1)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BR21-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `BR21-EX1` — `acknowledge` — Migration file `api/drizzle/XXXX_br21_profiles.sql` required (creates profiles, bid_profiles, profile_templates tables). Justified: core data model for the feature.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: Profile feature is self-contained. LiteParse migration touches one file. All changes tightly coupled through the profile data model.

## UAT Management (in orchestration context)
- Mono-branch. UAT after UI lots (Lot 5).
- Execution: dev in `tmp/feat-cv-transpose-profiles`, UAT from root `ENV=dev`.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline & scoping**
  - [ ] Read `.mdc` rules, `README.md`, `TODO.md`, `SPEC_EVOL_CV_TRANSPOSE_PROFILES.md`.
  - [ ] Create worktree `tmp/feat-cv-transpose-profiles` and run development there.
  - [ ] Confirm env mapping: `API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`.
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Validate spec against actual codebase; note discrepancies.
  - [ ] Validate scope boundaries and declare `BR21-EXn` exceptions if needed.
  - [ ] Lot gate: `make typecheck-api typecheck-ui API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`

- [ ] **Lot 1 — LiteParse integration (replace officeparser globally)**
  - [ ] `npm install @llamaindex/liteparse` in `api/`.
  - [ ] `npm uninstall officeparser` in `api/`.
  - [ ] Update `api/package.json` build script: replace `--external:officeparser` with appropriate `--external:@llamaindex/*`.
  - [ ] Rewrite `api/src/services/document-text.ts`: replace officeparser import + AST handling with LiteParse API.
  - [ ] Preserve `ExtractedDocumentInfo` interface (text, metadata, headingsH1) — adapt mapping from LiteParse output.
  - [ ] Verify: existing document upload + summarization still works (PDF, DOCX, PPTX).
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] `make lint-api API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] **API tests**
      - [ ] Update `api/tests/unit/document-text.spec.ts` (if exists) for LiteParse
      - [ ] Scoped: `make test-api-unit SCOPE=tests/unit/document-text.spec.ts ENV=test-feat-cv-transpose-profiles`
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-cv-transpose-profiles`
    - [ ] **UI tests** — no UI changes in this lot
    - [ ] **E2E tests** — document upload E2E should still pass
      - [ ] `make build-api build-ui-image API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=e2e-feat-cv-transpose-profiles`
      - [ ] Sub-lot gate: `make clean test-e2e API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=e2e-feat-cv-transpose-profiles E2E_GROUP=00 01 02`

- [ ] **Lot 2 — Data model: profiles table + schema + API CRUD**
  - [ ] Add `profiles` table to `api/src/db/schema.ts` (id, workspaceId, folderId, sourceDocumentId, status, model, jobId, data jsonb, createdAt, updatedAt).
  - [ ] Add `bidProfiles` junction table to `api/src/db/schema.ts` (id, bidId, profileId, role, data jsonb, createdAt).
  - [ ] Add `profileTemplates` table to `api/src/db/schema.ts` (id, workspaceId, name, description, templateData bytea, config jsonb, createdAt, updatedAt).
  - [ ] Create migration `api/drizzle/XXXX_br21_profiles.sql` (BR21-EX1):
    - Create `profiles` table + indexes
    - Create `bid_profiles` table + indexes + unique constraint
    - Create `profile_templates` table + indexes
  - [ ] Run migration: `make db-migrate API_PORT=8721 ENV=feat-cv-transpose-profiles`
  - [ ] Create `api/src/routes/api/profiles.ts`: GET list, GET by id, PUT update, DELETE.
  - [ ] Extend `api/src/routes/api/bids.ts`: POST/GET/DELETE bid-profile endpoints.
  - [ ] Create `api/src/routes/api/profile-templates.ts`: GET list, POST upload, DELETE.
  - [ ] Add Zod schemas for profile CRUD validation.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] `make lint-api API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] **API tests**
      - [ ] Add `api/tests/api/profiles.spec.ts`: CRUD (create, read, update, delete, list by folder)
      - [ ] Add `api/tests/api/bid-profiles.spec.ts`: attach/detach/list profiles on bids
      - [ ] Add `api/tests/api/profile-templates.spec.ts`: upload/list/delete templates
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-cv-transpose-profiles`

- [ ] **Lot 3 — CV transpose workflow (upload -> LiteParse -> LLM -> profile)**
  - [ ] Create `api/src/services/profile-extract.ts`: orchestrates extraction pipeline.
    - Accept document bytes + metadata.
    - Call LiteParse for text extraction.
    - Build LLM prompt with ProfileData Zod schema for structured output.
    - Parse LLM response, validate with Zod (lenient mode: accept partial).
    - Return structured ProfileData.
  - [ ] Create `api/src/workers/profile-extract.worker.ts`: job queue worker for `profile_extract` job type.
  - [ ] Add extraction endpoint: `POST /api/v1/profiles/extract` in profiles routes.
    - Accept `{ folderId, documentIds: string[] }`.
    - For each document: enqueue `profile_extract` job.
    - Return job IDs for progress tracking.
  - [ ] Register `profile_extract` job type in queue manager.
  - [ ] SSE events: `profile_extracting`, `profile_completed`, `profile_failed`.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] `make lint-api API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] **API tests**
      - [ ] Add `api/tests/api/profile-extract.spec.ts`: extraction endpoint (mock LLM)
      - [ ] Add `api/tests/unit/profile-extract-service.spec.ts`: extraction pipeline unit tests
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-cv-transpose-profiles`
      - [ ] AI flaky tests: `make test-api-ai ENV=test-feat-cv-transpose-profiles`

- [ ] **Lot 4 — DOCX generation (port scalian_xml.py to Node.js)**
  - [ ] Create `api/src/services/profile-docx.ts`: OOXML paragraph builders ported from `scalian_xml.py`.
    - `sectionHeader()`, `skillBullet()`, `sectorCategory()`, `sectorItem()`
    - `workSectionHeader()`, `emptyPara()`, `spacer()`
    - `jobEntry()` (composite: jobCompany + jobDescription + jobDates + jobTitle + tasks + achievements + techEnv)
    - `educationLine()`
    - `assembleDocument()`, `updateHeader()`
    - `escapeXml()` utility
  - [ ] Create `api/src/services/profile-docx-pack.ts`: DOCX unpack/pack using `jszip`.
    - `unpackTemplate(templateBuffer: Buffer)` -> returns JSZip instance
    - `packDocx(zip: JSZip)` -> returns Buffer
    - `generateProfileDocx(profile: ProfileData, templateBuffer: Buffer)` -> returns Buffer
  - [ ] Bundle default Scalian template: `api/assets/profile-templates/default.docx`.
  - [ ] Add export endpoint: `POST /api/v1/profiles/:id/export` with `{ templateId? }`.
  - [ ] Add download endpoint: `GET /api/v1/profiles/:id/export/:exportId` (or stream directly).
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] `make lint-api API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] **API tests**
      - [ ] Add `api/tests/unit/profile-docx.spec.ts`: OOXML builder unit tests (verify XML output structure)
      - [ ] Add `api/tests/unit/profile-docx-pack.spec.ts`: unpack/pack round-trip test
      - [ ] Add `api/tests/api/profile-export.spec.ts`: export endpoint returns valid DOCX
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-cv-transpose-profiles`

- [ ] **Lot 5 — UI: profile editor, upload flow, DOCX export**
  - [ ] Create `ui/src/lib/stores/profiles.ts`: profile CRUD store.
  - [ ] Create `ui/src/lib/stores/profile-templates.ts`: template list store.
  - [ ] Create profile list component: `ui/src/lib/components/profiles/ProfileList.svelte`
    - Table/card view with name, title, years, status, source doc, date.
    - Actions: view, export, delete.
  - [ ] Create profile editor component: `ui/src/lib/components/profiles/ProfileEditor.svelte`
    - Header section: name, titleLine1, titleLine2, yearsOfExperience.
    - Technical skills: sortable list with add/remove.
    - Sector skills: nested lists with add/remove.
    - Work experience: expandable job entries with add/remove/reorder.
    - Languages: key-value list.
    - Education: sortable list with add/remove.
    - Auto-save on blur.
  - [ ] Create upload flow component: `ui/src/lib/components/profiles/ProfileUpload.svelte`
    - Multi-file upload (PDF/DOCX).
    - "Create Profiles" action button.
    - Extraction progress badges.
  - [ ] Create export button component: `ui/src/lib/components/profiles/ProfileExport.svelte`
    - Template selector dropdown.
    - Download trigger.
  - [ ] Integrate into folder page: "Profiles" tab alongside existing content.
  - [ ] Add profile routes: `/workspaces/:wsId/folders/:folderId/profiles/:profileId`.
  - [ ] Lot gate:
    - [ ] `make typecheck-ui API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] `make lint-ui API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] **UI tests**
      - [ ] Add `ui/tests/stores/profiles.spec.ts`: store unit tests
      - [ ] Sub-lot gate: `make test-ui ENV=test`
    - [ ] **E2E tests**
      - [ ] `make build-api build-ui-image API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=e2e-feat-cv-transpose-profiles`
      - [ ] Add `e2e/tests/profiles.spec.ts`: upload CV, extract, edit profile, export DOCX
      - [ ] Sub-lot gate: `make clean test-e2e API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=e2e-feat-cv-transpose-profiles E2E_GROUP=00 01 02`

- [ ] **Lot 6 — Bid integration: attach profiles to bids**
  - [ ] Bid detail page: "Staffing" section listing attached profiles.
  - [ ] "Add Profile" picker modal (profiles in same workspace).
  - [ ] Role and allocation fields per attached profile.
  - [ ] Update bid detail component to show profile cards.
  - [ ] Lot gate:
    - [ ] `make typecheck-api typecheck-ui API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] `make lint-api lint-ui API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
    - [ ] **API tests**
      - [ ] Extend `api/tests/api/bid-profiles.spec.ts` if needed
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-cv-transpose-profiles`
    - [ ] **UI tests**
      - [ ] Add `ui/tests/components/bid-profiles.spec.ts`
      - [ ] Sub-lot gate: `make test-ui ENV=test`

- [ ] **Lot N-2 — UAT**
  - [ ] Web app
    - [ ] Navigate to a folder, click "Upload CVs", upload 2-3 PDF/DOCX CVs.
    - [ ] Click "Create Profiles" — profiles appear with extraction progress.
    - [ ] Open a profile — structured editor shows extracted data.
    - [ ] Edit a field (e.g., add a skill) — auto-saves.
    - [ ] Click "Export DOCX" — downloads formatted CV.
    - [ ] Open the DOCX in Word/LibreOffice — verify formatting matches template.
    - [ ] Navigate to a bid — "Staffing" section visible.
    - [ ] Attach a profile to the bid — appears in staffing list.
    - [ ] Non-regression: existing document upload + summarization still works.
    - [ ] Non-regression: existing DOCX generation (reports) still works.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Review and finalize `spec/SPEC_EVOL_CV_TRANSPOSE_PROFILES.md`.
  - [ ] Update `SPEC.md` API contracts with profile endpoints.
  - [ ] Update `TODO.md` to mark BR-21 items as completed.

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-api typecheck-ui API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
  - [ ] `make lint-api lint-ui API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=feat-cv-transpose-profiles`
  - [ ] `make test-api ENV=test-feat-cv-transpose-profiles`
  - [ ] `make test-ui ENV=test`
  - [ ] `make build-api build-ui-image API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=e2e-feat-cv-transpose-profiles`
  - [ ] `make clean test-e2e API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=e2e-feat-cv-transpose-profiles E2E_GROUP=00 01 02`
  - [ ] `make clean test-e2e API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=e2e-feat-cv-transpose-profiles E2E_GROUP=03 04 05`
  - [ ] `make clean test-e2e API_PORT=8721 UI_PORT=5121 MAILDEV_UI_PORT=1021 ENV=e2e-feat-cv-transpose-profiles E2E_GROUP=06 06`
  - [ ] AI flaky tests: document status/signature in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
