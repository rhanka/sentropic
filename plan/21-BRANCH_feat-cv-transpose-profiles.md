# Feature: BR-21 — CV Transpose & Profile Management

## Objective
CV transpose workflow: upload source CVs, extract structured profiles via officeparser + LLM, edit profiles, export DOCX/PPTX. Template generation from example CV. Batch export. Profile synthesis report. Proposal integration with staffing.

## Scope / Guardrails
- Make-only workflow. Branch in `tmp/feat-cv-transpose-profiles`.
- `ENV=feat-cv-transpose-profiles` `API_PORT=8721` `UI_PORT=5121` `MAILDEV_UI_PORT=1021`.
- Depends on BR-04B (TemplateRenderer, FieldCard, proposals) for UI and proposal integration.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `api/**`, `ui/**`, `e2e/**`, `plan/21-BRANCH_feat-cv-transpose-profiles.md`, `spec/SPEC_EVOL_CV_TRANSPOSE_PROFILES.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
- **Conditional Paths**: `api/drizzle/*.sql` (max 1), `.github/workflows/**`

## Feedback Loop

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline**
  - [ ] Read specs, create worktree, confirm env mapping.

- [ ] **Lot 1 — Data model: profiles + proposal_profiles + profile_templates tables**
  - [ ] `profiles` table (id, workspace_id, folder_id, source_document_id, status, model, data jsonb, created_at, updated_at).
  - [ ] `proposal_profiles` junction table (proposal_id, profile_id, role, data jsonb).
  - [ ] `profile_templates` table (id, workspace_id, name, description, format, template_data bytea, config jsonb).
  - [ ] Migration file `api/drizzle/XXXX_br21_profiles.sql`.
  - [ ] Schema types in `api/src/db/schema.ts`.
  - [ ] Lot gate: `make typecheck-api`, `make lint-api`

- [ ] **Lot 2 — API: profiles CRUD + extraction pipeline**
  - [ ] Profile CRUD endpoints (list, get, create, update, delete).
  - [ ] `POST /profiles/extract` — trigger extraction from uploaded documents: officeparser text extraction → LLM structuring → profile creation. Job queue integration.
  - [ ] Profile extraction LLM prompt with Zod schema validation for ProfileData.
  - [ ] Lot gate: `make typecheck-api`, `make lint-api`, `make test-api`

- [ ] **Lot 3 — DOCX generation (port from scalian-transpose-cv)**
  - [ ] Port `scalian_xml.py` OOXML builders to TypeScript (`api/src/services/profile-docx.ts`): section_header, skill_bullet, sector_category, job_entry, education_line, update_header, assemble_document.
  - [ ] DOCX pack/unpack via `jszip` (replaces `scalian_docx_tools.py`).
  - [ ] XML escaping utility.
  - [ ] `POST /profiles/:id/export` endpoint (DOCX).
  - [ ] Default Scalian template bundled in `api/assets/profile-templates/`.
  - [ ] Lot gate: `make typecheck-api`, `make lint-api`, `make test-api`

- [ ] **Lot 4 — PPTX generation (pptxgenjs)**
  - [ ] Add `pptxgenjs` to API dependencies.
  - [ ] One-page CV slide generator (`api/src/services/profile-pptx.ts`).
  - [ ] `POST /profiles/:id/export` endpoint extended with `format` param (docx | pptx).
  - [ ] Lot gate: `make typecheck-api`, `make lint-api`, `make test-api`

- [ ] **Lot 5 — Template generation from example CV**
  - [ ] `POST /profile-templates/generate` — upload example DOCX or PPTX → officeparser extracts structure → LLM maps text zones to profile fields → generates template descriptor (JSON config).
  - [ ] Template CRUD endpoints (list, get, upload, delete).
  - [ ] Template descriptor: maps profile fields to positions/styles in the DOCX/PPTX.
  - [ ] Lot gate: `make typecheck-api`, `make lint-api`, `make test-api`

- [ ] **Lot 6 — UI: profile editor + folder profiles view** (depends on BR-04B TemplateRenderer/FieldCard)
  - [ ] Profile detail page `/profiles/[id]/+page.svelte` — structured editing using FieldCard for each section (header, skills, experience, education, languages). Auto-save.
  - [ ] Folder view: "Profiles" tab listing profiles with name/title/years/status. Actions: view, export, delete.
  - [ ] Upload flow: "Upload CVs" button on folder page, then "Create Profiles" action.
  - [ ] Export button per profile: template selector dropdown (default + custom), format selector (DOCX/PPTX), download.
  - [ ] Lot gate: `make typecheck-ui`, `make lint-ui`, `make test-ui`

- [ ] **Lot 7 — Batch export + synthesis report**
  - [ ] `POST /folders/:id/profiles/export-batch` — generate all profiles as DOCX/PPTX, return ZIP.
  - [ ] UI: "Export all" button at folder level with template/format selection, ZIP download.
  - [ ] Profile synthesis report: LLM analyzes all profiles in folder → generates report (skills distribution, experience coverage, seniority mix, gaps).
  - [ ] Report stored as `folder_report` object (displayed in folder view).
  - [ ] Lot gate: `make typecheck-api`, `make typecheck-ui`, `make lint-api`, `make lint-ui`

- [ ] **Lot 8 — Proposal integration**
  - [ ] Proposal detail: "Staffing" section listing attached profiles with role/allocation.
  - [ ] "Add Profile" picker (profiles in same workspace).
  - [ ] API: `POST/DELETE /proposals/:id/profiles`, `GET /proposals/:id/profiles`.
  - [ ] Adapt qualification workflow to include staffing step (profile selection after solution generation).
  - [ ] Lot gate: `make typecheck-api`, `make typecheck-ui`, `make test-api`

- [ ] **Lot N-2 — UAT**
  - [ ] Upload 3 CVs (PDF/DOCX) dans un dossier → "Create Profiles" → 3 profils extraits avec données structurées
  - [ ] Ouvrir un profil → éditer le titre, ajouter un skill → sauvegarde OK
  - [ ] Export DOCX d'un profil avec template par défaut → téléchargement fonctionne
  - [ ] Export PPTX d'un profil → slide une page téléchargée
  - [ ] Upload un exemple CV DOCX → template généré automatiquement → exporter un profil avec ce template
  - [ ] Export batch : "Export all" au niveau dossier → ZIP avec 3 DOCX téléchargé
  - [ ] Rapport synthèse : générer le rapport → affiché dans le dossier (skills distribution, gaps)
  - [ ] Proposal : attacher un profil à une proposal avec rôle → visible dans la proposal
  - [ ] Non-reg : initiatives, organisations, chat → tout fonctionne

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update specs and PLAN.md.

- [ ] **Lot N — Final validation**
  - [ ] typecheck + lint + test-api + test-ui + test-e2e
  - [ ] PR → UAT + CI OK → remove BRANCH.md → merge.
