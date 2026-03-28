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

- [ ] **Lot N-2 — UAT**
  - [ ] Web app — initiative pages
    - [ ] Initiative ai-ideas page: rendu via TemplateRenderer identique visuellement (cartes colorées, layout 2/3+1/3, scores stars/X, sidebar dataSources/dataObjects)
    - [ ] Initiative opportunity page: même layout sans dataSources/dataObjects, tabs Solutions/Proposals visibles quand contenu existe
    - [ ] Initiative locked mode: champs affichés en @html (pas d'EditableInput), pas d'édition possible
    - [ ] Initiative edit mode: champs éditables via EditableInput+TipTap, sauvegarde auto, indicateur unsaved
    - [ ] Édition collaborative: ouvrir 2 onglets sur la même initiative, modifier un champ dans l'onglet 1, vérifier la mise à jour SSE dans l'onglet 2
  - [ ] Web app — organisation pages
    - [ ] Organisation page: rendu via TemplateRenderer identique visuellement (variant plain, sans couleur)
    - [ ] Organisation edit + save fonctionnel
  - [ ] Web app — dashboard
    - [ ] Dashboard chargement rapide (pas de freeze au montage des annexes print)
    - [ ] Dashboard exec summary dans FieldCard variant="bordered" avec prose styling
    - [ ] Dashboard introduction/analyse/recommandation: FieldCard + print sans bordures
    - [ ] Dashboard Ctrl+P: annexes initiatives rendues correctement, références avec liens (pas d'excerpts), scores-summary avec stars/X
    - [ ] Dashboard scatter plot fonctionnel
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
