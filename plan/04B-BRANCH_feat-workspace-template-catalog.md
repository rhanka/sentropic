# Feature: BR-04B — Workspace Template Catalog (continuation)

## Objective
Continuation of BR-04. Template-driven rendering using existing components, config UX alignment, chat tools wiring, bug fixes.

## Scope / Guardrails
- Make-only workflow. Branch in `tmp/feat-workspace-template-catalog-b`.
- `ENV=feat-workspace-template-catalog-b` `API_PORT=8705` `UI_PORT=5105` `MAILDEV_UI_PORT=1005`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `api/**`, `ui/**`, `e2e/**`, `plan/04B-BRANCH_feat-workspace-template-catalog.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
- **Conditional Paths**: `api/drizzle/*.sql` (max 1), `.github/workflows/**`

## Feedback Loop

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
  - [x] `TemplateRenderer.svelte` reads spec §12.3 JSON format (rows, grids, tabs, field types).
  - [x] Template seeds migrated to spec §12.5 format (ai-ideas, opportunity, organization, dashboard).
  - [x] View template API route + workspace seed hook.

- [x] **Lot 6 — Config UX alignment + bid→proposal rename**
  - [x] Spec `SPEC_EVOL_CONFIG_UX_ALIGNMENT.md` — Modifier/Copier/Réinitialiser/Supprimer.
  - [x] API: copy/reset/delete on view-templates, agent-config, workflow-config.
  - [x] UI: aligned icon-only buttons + badges on all 3 surfaces.
  - [x] i18n updated.
  - [x] bid → proposal renamed in API/UI/locales.

- [x] **Lot 7 — Document generation infra + gate auto-todo**
  - [x] DOCX template stubs (solution-summary, proposal-summary, product-datasheet).
  - [x] Gate transition auto-todo hook.

- [x] **Lot 8 — BUG-D1 partial fix**
  - [x] Added organizationIds/organizationName to InitiativeListItem interface + output schema.

- [ ] **Lot 11 — Wire pages + chat tools + finish bug fixes**
  - [ ] Wire `/initiative/[id]/+page.svelte` to use TemplateRenderer: resolve template by `(workspaceType, 'initiative')`, pass to TemplateRenderer. Keep page chrome (header, badges, StreamMessage, DocumentsBlock, FileMenu, LockPresenceBadge, ImportExportDialog). The page passes data, locked, apiEndpoint, commentCounts, onOpenComments, references as props. Buffer management, save handlers, SSE sync stay in the page. TemplateRenderer only renders the field content area.
  - [ ] Wire `/organizations/[id]/+page.svelte` to use TemplateRenderer: same pattern. Keep header, DocumentsBlock, References, FileMenu, LockPresenceBadge.
  - [ ] Wire dashboard exec summary fields to use FieldCard (not full TemplateRenderer — dashboard is too complex with scatter plot, print mode, initiative list).
  - [ ] FieldCard must support 3 variants via props: (a) colored header `bg-{color}-100` with `p-4` `text-sm` (InitiativeDetail), (b) simple no-header card with `p-4` (OrganizationForm), (c) bordered card with `p-6` and `border-b` separator header (dashboard). Use a `variant` prop or derive from `color` presence.
  - [ ] [BUG-D4] Create `document_generate` chat tool: definition in `tools.ts`, handler in `chat-service.ts` (enqueue DOCX generation), inject in tool list for opportunity + ai-ideas workspace types, add to `chat-tool-scope.ts`.
  - [ ] [BUG-D4] Verify `batch_create_organizations` visible in chat org context. If tool definition missing from `tools.ts`, create it (spec SPEC_VOL_OPPORTUNITY_WORKFLOW.md §B').
  - [ ] [BUG-D1] Complete fix: trace end-to-end from LLM output → queue-manager `processInitiativeList` → DB insert. Ensure each initiative gets its own organizationId from LLM response. If `organizationIds` not in LLM output, fix the prompt/schema. Test: generate folder with 3 orgs → verify distinct org IDs in DB.
  - [ ] Lot gate:
    - [ ] `make typecheck-api typecheck-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make lint-api lint-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make test-api API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make test-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test`

- [ ] **Lot N-2 — UAT**
  - [ ] Initiative ai-ideas page: rendu via TemplateRenderer, identique visuellement à avant (cartes colorées, layout 2/3+1/3, scores, sidebar dataSources/dataObjects)
  - [ ] Initiative opportunity page: même layout sans dataSources/dataObjects
  - [ ] Organisation page: rendu via TemplateRenderer, identique visuellement
  - [ ] Dashboard: exec summary fields dans FieldCard
  - [ ] Multi-org: créer folder opportunity avec 3 orgs → initiatives liées à des orgs distinctes
  - [ ] Chat (opportunity): `document_generate` visible dans les outils
  - [ ] Chat (org context): `batch_create_organizations` visible
  - [ ] Non-reg: ai-ideas generation, chat docs/comments/web_search
  - [ ] Settings: Copier/Modifier/Réinitialiser sur templates/agents/workflows

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate specs.
  - [ ] Update PLAN.md.

- [ ] **Lot N — Final validation**
  - [ ] typecheck + lint + test-api + test-ui + test-e2e
  - [ ] PR → UAT + CI OK → remove BRANCH.md → merge.

## Deferred to BR-20

- Opportunity qualification workflow, dynamic folder menu, templated folder creation, multi-workflow folders.
- Gate advance UI (BUG-D3), navigation to proposals (BUG-D5).
