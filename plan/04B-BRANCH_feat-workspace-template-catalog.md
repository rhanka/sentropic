# Feature: BR-04B — Workspace Template Catalog (continuation)

## Objective
Continuation of BR-04. Template-driven rendering using existing components, config UX alignment, chat tools wiring, bug fixes.

## Scope / Guardrails
- Make-only workflow. Branch in `tmp/feat-workspace-template-catalog-b`.
- `ENV=feat-workspace-template-catalog-b` `API_PORT=8705` `UI_PORT=5105` `MAILDEV_UI_PORT=1005`.
- Root workspace reserved for user dev/UAT (`ENV=dev`).
- Automated tests on `ENV=test-feat-workspace-template-catalog-b` / `ENV=e2e-feat-workspace-template-catalog-b`.
- `ENV` last argument in all `make` commands.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `api/**`, `ui/**`, `e2e/**`, `plan/04B-BRANCH_feat-workspace-template-catalog.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
- **Conditional Paths**: `api/drizzle/*.sql` (max 1), `.github/workflows/**`, `spec/**`, `PLAN.md`, `TODO.md`

## Feedback Loop

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single feature, independently mergeable.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on integrated branch only.
- Execution flow: develop/test in `tmp/feat-workspace-template-catalog-b`, push, UAT from root on `ENV=dev`, switch back.

## Plan / Todo (lot-based)

- [x] **Lot 1 — usecase → initiative rename**
  - [x] Migration + grep/replace + zero-legacy verification.

- [x] **Lot 2 — Multi-org workflow + UI multi-select**
  - [x] Workflow pairs (initiative, org) + multi-select orgs in folder creation.
  - [x] Chat tool `batch_create_organizations`.

- [x] **Lot 3 — View template API + seed data**
  - [x] CRUD, resolution, seed per workspace type.

- [x] **Lot 4 — FieldCard + ScoreTable extraction**
  - [x] `FieldCard.svelte` extracted from InitiativeDetail card pattern.
  - [x] `ScoreTable.svelte` extracted from score axes rendering.

- [x] **Lot 5 — TemplateRenderer + template seeds**
  - [x] `TemplateRenderer.svelte` reads spec 12.3 JSON format (rows, grids, tabs, field types).
  - [x] Template seeds migrated to spec 12.5 format (ai-ideas, opportunity, organization, dashboard).
  - [x] View template API route + workspace seed hook.

- [x] **Lot 6 — Config UX alignment + bid → proposal rename**
  - [x] Spec `SPEC_EVOL_CONFIG_UX_ALIGNMENT.md`.
  - [x] API: copy/reset/delete on view-templates, agent-config, workflow-config.
  - [x] UI: aligned icon-only buttons + badges on all 3 surfaces.
  - [x] i18n updated.
  - [x] bid → proposal renamed in API/UI/locales.

- [x] **Lot 7 — Document generation infra + gate auto-todo**
  - [x] DOCX template stubs (solution-summary, proposal-summary, product-datasheet).
  - [x] Gate transition auto-todo hook.

- [x] **Lot 8 — BUG-D1 partial fix** *(reverted — deferred to BR-20)*
  - [x] ~~Added organizationIds/organizationName to InitiativeListItem interface + output schema.~~
  - [x] Reverted: removed organizationIds from outputSchema (breaks OpenAI strict mode). Proper fix deferred to BR-20 with `initiative_list_with_orgs` workflow branching approach.

- [ ] **Lot 11 — Wire pages + chat tools + finish bug fixes**
  - [x] Wire `/initiative/[id]/+page.svelte` to use TemplateRenderer.
  - [x] Wire `/organizations/[id]/+page.svelte` to use TemplateRenderer.
  - [x] Wire dashboard exec summary fields to use FieldCard (variant="bordered").
  - [x] FieldCard 3 variants (colored/plain/bordered).
  - [x] `document_generate` chat tool wired.
  - [x] `batch_create_organizations` chat tool wired.
  - [x] ~~BUG-D1 complete fix: per-initiative organizationId from LLM output.~~ *(reverted — deferred to BR-20)*
  - [x] TemplateRenderer collaborative editing buffers (SSE live updates).
  - [x] Print layout: display:contents for CSS selectors, uniform margins, scores-summary via FieldCard.
  - [x] Dashboard print perf: viewTemplateCache store (dedup N→1 API calls), skip EditableInput when locked, CSS print fix for FieldCard in report-analyse.
  - [x] References: fix nested brackets regex, hide excerpts in print/locked mode.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make typecheck-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make lint-api API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make lint-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] **API tests**
      - [ ] Existing (non-reg): `api/tests/api/initiatives.test.ts` — verify initiative CRUD still passes with schema changes (organizationIds, proposal rename)
      - [ ] Existing (non-reg): `api/tests/api/initiatives-generate-matrix.test.ts` — verify matrix generation
      - [ ] Existing (non-reg): `api/tests/api/chat-tools.test.ts` — verify existing chat tools, proposal rename
      - [ ] Existing (non-reg): `api/tests/unit/context-initiative-detail-contract.test.ts` — verify context contract
      - [ ] New: `api/tests/api/view-templates.test.ts` — CRUD, resolution by workspaceId+workspaceType+objectType, seed on workspace creation, copy/reset/delete
      - [ ] New: `api/tests/unit/chat-service-document-generate.test.ts` — document_generate tool definition + handler
      - [ ] New: `api/tests/unit/chat-service-batch-create-orgs.test.ts` — batch_create_organizations tool definition + handler
      - [ ] Sub-lot gate: `make test-api API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
      - [ ] AI flaky tests (non-blocking): `make test-api-ai API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] **UI tests (TypeScript only)**
      - [ ] Existing (non-reg): `ui/tests/stores/initiatives.test.ts` — verify store still works with new fields
      - [ ] Existing (non-reg): `ui/tests/stores/organizations.test.ts` — verify store
      - [ ] New: `ui/tests/stores/viewTemplateCache.test.ts` — resolveViewTemplate dedup, cache hit, clearViewTemplateCache
      - [ ] Sub-lot gate: `make test-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test`
    - [ ] **E2E tests**
      - [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-workspace-template-catalog-b`
      - [ ] Existing (non-reg): `e2e/tests/05-usecase-detail.spec.ts` — initiative detail page renders via TemplateRenderer
      - [ ] Existing (non-reg): `e2e/tests/01-organizations-detail.spec.ts` — org detail page renders via TemplateRenderer
      - [ ] Existing (non-reg): `e2e/tests/02-organizations.spec.ts` — org list
      - [ ] Existing (non-reg): `e2e/tests/03-dashboard.spec.ts` — dashboard with FieldCard exec summary, print annexes
      - [ ] Existing (non-reg): `e2e/tests/06-settings.spec.ts` — config UX (copy/reset/delete) on templates/agents/workflows
      - [ ] Sub-lot gate group 00-01-02: `make clean test-e2e API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-workspace-template-catalog-b E2E_GROUP="00 01 02"`
      - [ ] Sub-lot gate group 03-04-05: `make clean test-e2e API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-workspace-template-catalog-b E2E_GROUP="03 04 05"`
      - [ ] Sub-lot gate group 06+: `make clean test-e2e API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-workspace-template-catalog-b E2E_GROUP="06"`
      - [ ] AI flaky tests (non-blocking): `make test-e2e E2E_SPEC=tests/00-ai-generation.spec.ts API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-workspace-template-catalog-b` and `03-chat.spec.ts`, document signatures

- [ ] **Lot 12 — Multi-org folder creation: workflow input variables + UI multi-select**
  - [ ] **API: workflow input variables**
    - [ ] Add `orgIds: string[]` and `createNewOrgs: boolean` to folder creation payload (in `api/src/routes/api/folders.ts` or wherever folder creation is handled)
    - [ ] Store these as workflow input variables on the folder/job (pass to queue-manager)
    - [ ] In `queue-manager.ts` dispatch logic: if `orgIds.length > 0 || createNewOrgs` → use `initiative_list_with_orgs` step, else → use `initiative_list` step
    - [ ] Create `initiative_list_with_orgs` agent config in `default-agents-opportunity.ts` (and optionally `default-agents-ai-ideas.ts`): same as `initiative_list` but prompt includes `{{organizations_context}}` with selected org details, and asks LLM to orient initiatives by org
    - [ ] If `createNewOrgs` is true, the workflow runs `create_organizations` step after `initiative_list_with_orgs` and before `initiative_detail`
    - [ ] If `createNewOrgs` is false, skip `create_organizations` step
  - [ ] **UI: multi-select orgs in folder creation**
    - [ ] In the folder creation form (likely `ui/src/routes/home/+page.svelte` or a component), replace single-select org with multi-select
    - [ ] Add checkbox "Créer de nouvelles organisations automatiquement" below the org selector
    - [ ] Pass `{ orgIds, createNewOrgs }` in the folder creation API call
    - [ ] If no orgs selected and createNewOrgs unchecked → classic workflow (no change)
  - [ ] Lot gate:
    - [ ] `make typecheck-api typecheck-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make lint-api lint-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] **API tests**
      - [ ] Update or add test for folder creation with orgIds/createNewOrgs
      - [ ] Add test for queue-manager routing to initiative_list_with_orgs
      - [ ] Sub-lot gate: `make test-api-smoke test-api-endpoints API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] **UI tests**
      - [ ] Sub-lot gate: `make test-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test`

- [ ] **Lot 13 — Dashboard via TemplateRenderer (component, entity-loop, printOnly, path-based keys)**
  - [ ] **TemplateRenderer extensions**
    - [ ] Support `type: "component"` — renders a named Svelte slot, parent provides content via `<svelte:fragment slot="component" let:fieldKey>`
    - [ ] Support `type: "entity-loop"` — reads `collections[field.collection]`, resolves template via `field.templateRef` (objectType), renders each entity with its own TemplateRenderer instance
    - [ ] Support `printOnly: true` on any field — wraps in `{#if isPrinting}`, no DOM mount in normal view
    - [ ] Support dot-notation path-based field keys — `getFieldValue("data.executive_summary.synthese_executive")` traverses nested objects
    - [ ] Accept `collections` prop (Record<string, any[]>) for entity-loop data
  - [ ] **Dashboard template seed**
    - [ ] Update dashboard view template in `api/src/services/view-template-service.ts` to use the new format:
      - `cover_page`: component, printOnly
      - `sommaire`: component, printOnly
      - `synthese_executive`: text (path: `data.executive_summary.synthese_executive`)
      - `scatter_plot`: component
      - `introduction`: text (path: `data.executive_summary.introduction`)
      - `analyse`: text (path: `data.executive_summary.analyse`)
      - `recommandation`: text (path: `data.executive_summary.recommandation`)
      - `references`: list (path: `data.executive_summary.references`)
      - `annex_cover`: component, printOnly
      - `initiatives`: entity-loop, collection: "initiatives", templateRef: "initiative", printOnly
  - [ ] **Dashboard page refactor**
    - [ ] Replace FieldCard+EditableInput manual sections with `<TemplateRenderer template={dashboardTemplate} data={folder} collections={{ initiatives: filteredUseCases }} ...>`
    - [ ] Provide component slots for: cover_page, sommaire, scatter_plot, annex_cover
    - [ ] Keep existing scatter plot, cover page, sommaire, annex cover components — just render them via the slot
    - [ ] Remove manual FieldCard wiring for exec summary sections
    - [ ] Ensure print mode works: printOnly fields mount only on Ctrl+P, entity-loop renders each initiative via its own TemplateRenderer
  - [ ] **Bugs identifiés en UAT Lot 13**
    - [x] BUG-L13-2: Références vides / [object Object] — handle object items `{title,url}` + shortKey for path-based keys.
    - [x] BUG-L13-3: Annexes absentes — scatter plot canvas null guard + printOnly via CSS `hidden`/`print-block` instead of Svelte conditional mount.
    - [ ] BUG-L13-1: Print style — marges, page-breaks, polices, background. Correctifs :
      - [ ] Correctif 1: renommer `usecase-print` → `template-initiative` dans `InitiativeDetail.svelte` + `initiative/[id]/+page.svelte` (couvre A8 marges, A9 bg image, A10 polices)
      - [ ] Correctif 2: CSS print gap/spacing 0 sur TemplateRenderer + `:first-child` sans page-break entity-loop (couvre A2/A4/A6 extra marges, A3/A7 pages vierges)
      - [x] Correctif 3: bug B — initiative standalone bg overflow (double wrapper fix)
      - [ ] Correctif 4: `pageContext` field modifier — cover/annex page context switching (couvre A2 marges cover, A3 page vierge, A6 marges annex cover)
  - [ ] **Spec update**
    - [x] Update §12.4 with component, entity-loop, printOnly, path-based keys, collections prop
  - [ ] Lot gate:
    - [ ] `make typecheck-api typecheck-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make lint-api lint-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] **API tests**
      - [ ] Sub-lot gate: `make test-api-smoke test-api-endpoints API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] **UI tests**
      - [ ] Update `ui/tests/upstream/injected-script.test.ts` if TemplateRenderer API changed
      - [ ] Add tests for path-based getFieldValue, entity-loop rendering, printOnly gating
      - [ ] Sub-lot gate: `make test-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test`

- [ ] **Lot 14 — EntityPage wrapper + /entity/[type]/[id] route + report entity + stateless TemplateRenderer**
  - [ ] **EntityPage component** (`ui/src/lib/components/EntityPage.svelte`)
    - [ ] Props: `objectType: string`, `entityId: string`
    - [ ] Template resolution via `resolveViewTemplate(workspaceType, objectType)`
    - [ ] Data loading via API (type-specific endpoint: `/initiatives/{id}`, `/organizations/{id}`, `/folders/{id}`)
    - [ ] SSE stream subscription for entity updates
    - [ ] Collaborative editing: `dirtyFields: Set<string>` — SSE updates skip fields being edited locally
    - [ ] Lock/presence: acquire on mount, release on leave, pass `locked` prop
    - [ ] Comment counts: fetch + pass `commentCounts` + `onOpenComments`
    - [ ] Header: template-driven (field `type: "header"` in template — title editable, badges, org link)
    - [ ] FileMenu: import/export/delete — generic by objectType
    - [ ] Save handlers: `apiEndpoint` derived from objectType+entityId
    - [ ] Print mode: `beforeprint`/`afterprint` listeners, pass `isPrinting`
    - [ ] Passes `data` (read-only) + `collections` to TemplateRenderer
  - [ ] **Stateless TemplateRenderer refactor**
    - [ ] Remove internal `textBuffers`, `listBuffers`, `scoreBuffers`, `textOriginals`, `listOriginals`, `scoreOriginals`
    - [ ] Remove reactive SSE sync block (100+ lines)
    - [ ] TemplateRenderer receives `data` as read-only prop, renders fields directly from `data`
    - [ ] EditableInput signals `dirty`/`clean` events to EntityPage (not TemplateRenderer)
    - [ ] Backward compat: if no EntityPage parent, TemplateRenderer falls back to internal buffers (for transition period)
  - [ ] **Dynamic route `/entity/[type]/[id]`**
    - [ ] Create `ui/src/routes/entity/[type]/[id]/+page.svelte` — contains only `<EntityPage objectType={type} entityId={id} />`
    - [ ] Redirect `/initiative/[id]` → `/entity/initiative/[id]`
    - [ ] Redirect `/organizations/[id]` → `/entity/organization/[id]`
    - [ ] Dashboard becomes `/entity/report/[id]` (after report entity migration)
  - [ ] **Report entity (dashboard migration)**
    - [ ] API: create `report` as a new entity type in the DB (or reuse existing structure with objectType discriminator)
    - [ ] API: `POST /folders/{id}/reports` — create a report entity attached to a folder
    - [ ] API: `GET /reports/{id}` — fetch report with its data (executive_summary fields)
    - [ ] API: auto-create report entity when folder is created (migration from current folder.data.executive_summary)
    - [ ] Migrate existing dashboard data: `folder.data.executive_summary` → `report.data`
    - [ ] Template seed: report template with cover_page, sommaire, synthèse, scatter_plot, introduction, analyse, recommandation, references, annexes (entity-loop)
    - [ ] Folder view: show report entity alongside initiatives
  - [ ] **Header template field type**
    - [ ] Add `type: "header"` to TemplateRenderer — renders editable title, badges (model, org, status), action buttons
    - [ ] Template descriptors for initiative/organization/report include a header field
  - [ ] Lot gate:
    - [ ] `make typecheck-api typecheck-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make lint-api lint-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] **API tests**
      - [ ] New: test report CRUD (create, get, update, delete)
      - [ ] New: test folder report auto-creation
      - [ ] Non-reg: initiatives, organizations, folders
      - [ ] Sub-lot gate: `make test-api-smoke test-api-endpoints API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] **UI tests**
      - [ ] New: EntityPage rendering with mock template
      - [ ] New: dirtyFields SSE protection
      - [ ] Non-reg: TemplateRenderer existing tests
      - [ ] Sub-lot gate: `make test-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test`
    - [ ] **E2E tests**
      - [ ] `/entity/initiative/{id}` renders correctly
      - [ ] `/entity/organization/{id}` renders correctly
      - [ ] `/entity/report/{id}` renders correctly (dashboard)
      - [ ] Collaborative editing via EntityPage
      - [ ] Print mode via EntityPage

- [ ] **Lot N-2 — UAT**
  - [ ] Web app — entity views (via /entity/[type]/[id])
    - [ ] `/entity/initiative/{id}` : rendu identique visuellement (cartes colorées, layout 2/3+1/3, scores, sidebar)
    - [ ] `/entity/organization/{id}` : rendu identique (variant plain)
    - [ ] `/entity/report/{id}` : dashboard rendu via TemplateRenderer (synthèse, scatter plot via slot, print annexes via entity-loop)
    - [ ] Ancien URL `/initiative/{id}` redirige vers `/entity/initiative/{id}`
    - [ ] Ancien URL `/organizations/{id}` redirige vers `/entity/organization/{id}`
    - [ ] Edit mode : champs éditables, sauvegarde auto, indicateur unsaved
    - [ ] Locked mode : champs en @html, pas d'édition
    - [ ] Édition collaborative : 2 onglets même entité, modifier un champ → SSE met à jour l'autre (dirtyFields protège)
    - [ ] Print : Ctrl+P fonctionne sur report (cover, sommaire, annexes, scores)
  - [ ] Web app — report entity
    - [ ] Report créé automatiquement dans le folder
    - [ ] Report visible dans la vue folder
    - [ ] Scatter plot fonctionne via component slot
  - [ ] Web app — config UX
    - [ ] Settings templates: Copier/Modifier/Réinitialiser/Supprimer fonctionnels
    - [ ] Settings agents: Copier/Modifier/Réinitialiser/Supprimer fonctionnels
    - [ ] Settings workflows: Copier/Modifier/Réinitialiser/Supprimer fonctionnels
    - [ ] Badges Lock/UserPen corrects sur les 3 surfaces
  - [ ] Web app — chat tools
    - [ ] Chat (opportunity workspace): `document_generate` visible dans les outils disponibles
    - [ ] Chat (org context): `batch_create_organizations` visible dans les outils disponibles
    - [ ] Chat: `document_generate` exécution → DOCX généré et téléchargeable
  - [ ] Web app — multi-org
    - [ ] Folder creation: multi-select orgs visible dans le formulaire
    - [ ] Folder creation avec orgs sélectionnées → workflow `initiative_list_with_orgs` utilisé
    - [ ] Folder creation avec "Créer de nouvelles orgs auto" coché → step `create_organizations` exécuté
    - [ ] Folder creation sans orgs → workflow classique `initiative_list` (non-reg)
    - [ ] bid → proposal: vérifier que le terme "proposal" apparaît partout (UI, API responses)
  - [ ] Web app — non-regression
    - [ ] Génération ai-ideas: créer un nouveau folder → générer des initiatives → vérifier rendu
    - [ ] Chat: docs/comments/web_search fonctionnels
    - [ ] Import/export initiative fonctionnel
    - [ ] Markdown avec liens bleus et références numérotées

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate specs.
  - [ ] Update PLAN.md.

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-api typecheck-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
  - [ ] `make lint-api lint-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
  - [ ] Retest API: `make test-api API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
  - [ ] Retest UI: `make test-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test`
  - [ ] Retest E2E groups: cf Lot 11 gate
  - [ ] AI flaky tests + document signatures
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Create/update PR using `BRANCH.md` as PR body
  - [ ] Run/verify branch CI on PR
  - [ ] Once UAT + CI OK, remove `BRANCH.md`, push, merge

## Deferred to BR-20

- Opportunity qualification workflow, dynamic folder menu, templated folder creation, multi-workflow folders.
- Gate advance UI (BUG-D3), navigation to proposals (BUG-D5).
