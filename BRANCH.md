# Feature: Organizations (rename companies + enrich org data model)

## Objective
Replace the "Company" concept with "Organization" across the stack (DB schema, API, UI) and evolve the organization profile model:
- Deep rename `companies/company` → `organizations/organization` (types, routes, UI screens).
- Migrate organization profile fields to a JSONB `data` payload (similar to `use_cases.data`) to reduce future schema churn.
- Add a KPI section (single field): `kpis` as a markdown string displayed under “Processus”.
- Include references in AI generations + org enrichment (store and expose sources used by the model).

## Scope / Guardrails
- Docker-first: all installs/build/tests run through `make` (no native `npm`).
- Minimal refactors outside the organization scope.
- Backward-compatibility decision needed:
  - Keep `/companies` API as alias during transition **or** break and migrate fully to `/organizations`.
  - **UI routes rename is required**: `/entreprises` → `/organisations`.
    - Decide whether to keep `/entreprises` as a redirect/alias temporarily (recommended) to avoid breaking deep links.

## Plan / Todo
- [ ] **Branch setup**: inventory all usages of `companies/company/entreprises` (API, UI, tests) and decide routing compatibility.
- [ ] **DB schema**:
  - [ ] Introduce `organizations` table (rename from `companies` via migration).
  - [ ] Add `data JSONB` to organizations and migrate existing columns into `data`.
  - [ ] Keep stable columns: `id`, `workspace_id`, `name`, `status`, timestamps.
  - [ ] Add KPI field in `data` (`kpis` markdown string) and ensure defaults are safe.
  - [ ] Update FK columns `folders.company_id` / `use_cases.company_id` naming strategy (decide whether to rename or keep as-is for minimal impact).
- [ ] **API**:
  - [ ] Add `organizations` router with CRUD + enrich endpoints.
  - [ ] Update services to use organization `data` JSONB (context building, enrichment, prompts).
  - [ ] Add generation references:
    - [ ] Define a stable references structure in generated payloads (e.g. `references: [{ title, url, excerpt }]`).
    - [ ] Persist references (DB field or within `use_cases.data`) and expose via API.
  - [ ] Update tools/chat context types from `company` to `organization` (with alias if needed).
  - [ ] Ensure OpenAPI reflects new naming.
- [ ] **UI**:
  - [ ] Rename store `companies.ts` → `organizations.ts` and update all imports.
  - [ ] **Rename UI routes**:
    - [ ] Create new routes under `/organisations` (list, detail, new).
    - [ ] Keep `/entreprises` as redirect/alias temporarily (optional, but recommended) and update navigation/menu.
  - [ ] Update screens to display "Organisation" terminology and render KPI (`kpis`) under “Processus”.
  - [ ] Ensure create/new flow still works; update EditableInput endpoints.
  - [ ] Update i18n labels (FR-first; EN to follow if required by current coverage rules).
- [ ] **User testing (manual) — after UI, before Data / Seed**
  - [ ] Navigate to `/organisations` (list) and verify the page loads.
  - [ ] Verify `/entreprises` redirects to `/organisations` (deep-link compatibility).
  - [ ] Create a new organization, then open its detail page.
  - [ ] Edit key fields and confirm autosave still works (EditableInput).
  - [ ] Trigger “enrich” and confirm streaming status updates still appear.
  - [ ] Verify folders/use-cases creation still accept an organization selection.
  - [ ] Verify delete behavior: blocked with a clear message if dependencies exist.
- [ ] **Data / Seed**:
  - [ ] Move demo organization seed into `data/` (source-of-truth fixtures) and adjust `api/src/scripts/db-seed.ts`.
  - [ ] Update test seeding (`api/tests/utils/seed-test-data.ts`) to match new table/model.
- [ ] **Tests & Docs**:
  - [ ] Update API unit/integration tests for organizations.
  - [ ] Update Playwright E2E tests currently referencing companies.
  - [ ] Update `spec/DATA_MODEL.md` to match `api/src/db/schema.ts`.
  - [ ] Run required make targets before finalizing (see below).

## Commits & Progress
- [x] **Commit 1** (0fd6ae8): docs/branch plan (BRANCH.md) + inventory notes
- [x] **Commit 2** (a3ccaf3): db+api: migrate companies→organizations (JSONB org data, routes, services)
- [x] **Commit 3** (469abc3): ui: rename /entreprises → /organisations (redirects + nav + KPI display)
- [x] **Commit 4**:
  - **Prompts**: `company_info` → `organization_info` + `references` + `excerpt`
  - **Org model**: `kpis` single markdown string (+ legacy tolerance)
  - **Tools**: enforce correct field names, allow `references` updates via `company_update`
  - **SSE**: hydrate `company_update` payload so UI reacts live
  - **Stability**: strip `\u0000` / control chars from enrichment outputs before JSONB insert
- [ ] **Commit 5**: tests/docs: update unit + e2e + spec/DATA_MODEL.md + data/seed migration

## Validation (must pass before finishing the branch)
- `make test-api`
- `make test-ui` (or targeted UI test target if configured)
- If needed for confidence: `make build-api build-ui-image test-e2e`
- Verify CI run for the branch (per `.cursor/rules/workflow.mdc`)

## Status
- **Progress**: 4/5 commits completed
- **Current**: tests/docs update + Data Model spec alignment
- **Next**: update Vitest + Playwright tests, `spec/DATA_MODEL.md`, and any remaining docs/fixtures referencing companies

