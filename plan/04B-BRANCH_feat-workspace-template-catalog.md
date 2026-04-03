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

- [x] **Lot 11 — Wire pages + chat tools + finish bug fixes** *(implementation landed; validation consolidated in Lot 13)*
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
  - [x] Validation checklists moved to Lot 13 (API/UI/E2E consolidation for BR-04B).

- [ ] **Lot 12 — Generic executable workflow runtime**
  - [x] **12.1 Spec + scope lock**
    - [x] Reabsorb the former BR-23 generic-runtime scope into BR-04B Lot 12.
    - [x] BR-04 spec §7.4 clarified toward a library-neutral executable workflow graph, conceptually compatible with LangGraph/Temporal without adding either dependency.
    - [x] BR-04 spec now states that no workflow-specific sequencing hardcoding may remain for existing workflows.
    - [x] BR-04 spec now states the legacy parity contract: for pre-existing non-multi-org cases, BR-04B must preserve `main` entry/output semantics and queue-visible work topology.
    - [x] Specify `workflow_task_transitions` storage contract in the spec: `fromTaskKey`, `toTaskKey`, `transitionType`, `condition`, `metadata`.
    - [x] Specify binding contract in the spec: `inputBindings`, `outputBindings`, `fanout`, `join`, retry/timeout, idempotency.
    - [x] Specify the allowed hardcoding boundary in the spec: executor registry only, never workflow sequencing.
    - [x] Specify dossier-scoped matrix semantics in the spec: `matrix_mode=generate` is a folder-level ad hoc matrix and must work for `0`, `1`, or `N` selected orgs.
    - [x] Replace the monolithic `organization_batch_create` target in the spec with an explicit subgraph target: `initiative_list_with_orgs` first, then create/enrich fanout -> join before `initiative_detail`.
    - [x] Specify the migration target set in the spec for all existing seeded workflows:
      - [x] `ai_usecase_generation`
      - [x] `opportunity_identification`
      - [x] `opportunity_qualification`
      - [x] `code_analysis`
  - [ ] **12.2 Runtime engine core**
    - [x] Add `orgIds: string[]` and `createNewOrgs: boolean` to folder creation payload.
    - [x] Store these values as workflow inputs on the generation run/job.
    - [ ] Preserve exact `main` entry/output parity for pre-existing non-multi-org paths.
    - [x] Preserve queue-visible work topology and concurrency regulation for pre-existing work units.
    - [x] Persist `workflow_run_state` for the generation run and bind multi-org inputs into that state.
    - [x] Persist `workflow_task_results` (or equivalent task output persistence) for the generation chain.
    - [x] Add `workflow_task_transitions` persistence and seed support.
    - [x] Replace the current `switch (task.agentRole)` startup routing with a generic “ready entry nodes” dispatch.
    - [x] Replace task-key string heuristics (`includes("detail")`, `includes("summary")`, etc.) with transition-driven next-node resolution.
    - [ ] Replace workflow-specific matrix waiting / unlock logic with transition + binding driven scheduling, while preserving the legacy visible matrix/list topology on non-multi-org paths.
    - [x] Keep only a generic executor registry (`executor` / `jobType` / `subworkflowKey` → implementation) in runtime services.
  - [ ] **12.3 Workflow migration on the generic engine**
    - [ ] **12.3.a Clarify workflow objects and naming**
      - [ ] Document explicitly in spec/BRANCH which nodes are workflow-only structure vs real agents.
      - [ ] Remove the misleading `organization_batch_agent` target model from the plan; the batch belongs to workflow fanout/join, not to an agent.
      - [ ] State explicitly that `generate_organization` is a **shared unitary agent** reused by both workflows.
      - [ ] State explicitly that `initiative_list_with_orgs` and `opportunity_list_with_orgs` are **domain-specific list agents**, not shared.
      - [ ] State explicitly that `initiative_detail` and `opportunity_detail` are **domain-specific detail agents**, not shared.
      - [ ] State explicitly that `initiative_matrix_prepare` and `opportunity_matrix_prepare` share the same workflow role but are **not considered shared agents** until prompt/config/base-matrix are actually unified.
      - [ ] Normalize the target naming in docs so the AI-ideas and opportunity flows use the same suffixes for the same workflow role.
    - [ ] `ai_usecase_generation`
      - [ ] Keep `initiative_list_with_orgs` as the first org-aware generation step; otherwise keep the classic non-org list task.
      - [ ] Run organization creation only after `initiative_list_with_orgs` and before `initiative_detail`, never before the list step.
      - [ ] Replace monolithic `organization_batch_create` with an explicit org subgraph driven from org-aware list outputs: workflow fanout -> shared `generate_organization` agent -> workflow join.
      - [ ] Preserve the legacy visible matrix/list topology and barrier semantics whenever a folder ad hoc matrix is required.
      - [ ] Validate exact parity with `main` for pre-existing single-org / no-org cases.
      - [ ] Declare `initiative_detail` fanout in transitions instead of runtime heuristics.
      - [ ] Declare `executive_summary` join in transitions instead of business-table completion scanning.
    - [ ] `opportunity_identification`
      - [ ] Move list/detail/summary sequencing to transitions + bindings only, without changing legacy observable behavior outside multi-org.
      - [ ] On the org-aware path, keep the historical order `opportunity_list_with_orgs` -> organization fanout/join -> `opportunity_detail`.
      - [ ] Remove any opportunity-specific sequencing fallback from orchestration/runtime code.
      - [ ] Keep dossier-scoped matrix generation semantics on zero-org, single-org, and multi-org paths.
    - [x] `opportunity_qualification`
      - [x] Express qualification sequencing entirely through task transitions.
      - [x] Validate that no orchestration code path still depends on workflow-specific ordering logic.
    - [x] `code_analysis`
      - [x] Express analysis sequencing entirely through task transitions.
      - [x] Validate that no orchestration code path still depends on workflow-specific ordering logic.
  - [ ] **12.4 Tests**
    - [ ] **API**
      - [x] Add API tests for generation start with `org_ids` / `create_new_orgs`.
      - [ ] Add API tests for runtime routing to `initiative_list_with_orgs`.
      - [ ] Add API tests proving the historical multi-org order: `initiative_list_with_orgs` -> `create_organizations` -> `initiative_detail`.
      - [ ] Replace `organization_batch_create` tests with org subgraph tests (prepare/list, fanout, join, state binding).
      - [ ] Add API tests for transition-driven detail fanout and executive-summary join on the multi-org path.
      - [ ] Add parity API tests against `main` semantics for pre-existing non-multi-org flows:
        - [ ] `0` org + title/context only
        - [ ] `1` org + reuse existing matrix
        - [ ] `1` org + generated matrix
    - [ ] **Queue / unit**
      - [ ] Add queue tests proving queue-visible per-org jobs and no opaque multi-call batch worker for auto-create orgs.
      - [ ] Add queue/unit tests for generic conditional transition resolution.
      - [ ] Add queue/unit tests for generic fanout scheduling.
      - [ ] Add queue/unit tests for generic join completion.
      - [ ] Add queue/unit tests for generic state/result replay safety.
      - [ ] Add queue/unit tests proving the shared `generate_organization` agent is invoked once per org target from both workflows.
    - [x] **UI**
      - [x] UI: replace single-select org with multi-select in folder creation.
      - [x] UI: add checkbox "Créer de nouvelles organisations automatiquement".
      - [x] UI: pass `{ orgIds, createNewOrgs }` in the folder creation API call.
      - [x] UI: align matrix choice and labels with dossier-matrix semantics (`reuse existing org matrix` vs `generate folder ad hoc matrix`).
      - [x] Add UI coverage for the non-multi-org parity path and the multi-org folder-matrix flow.
  - [ ] **12.4 UAT bugs reopened**
    - [ ] Executive summary references are requested by prompt but dropped by runtime normalization/persistence; restore `executiveSummary.references` end-to-end (prompt example, repair schema, normalization, DB storage, UI payload).
    - [ ] Org-aware generation prompt currently over-forces `organizationName` on vague requests, producing non-company targets; rework the shared org-aware list prompt contract so the agent returns only real companies with high confidence, otherwise no org target.
    - [x] Initiative references rendering no longer falls back to basic link parsing on initiative/detail surfaces; keep generated refs readable while preserving direct external links.

### Lot 12 clarification — shared vs specific objects

- **Shared workflow-only structure**
  - `*_context_prepare`
  - `*_organizations_fanout`
  - `*_organizations_join`
  - `*_todo_sync`
  - fanout/join/end routing semantics

- **Shared agent**
  - `generate_organization`
    - one call = one organization
    - reused by both `ai_usecase_generation` and `opportunity_identification`

- **Domain-specific agents**
  - `initiative_list_with_orgs`
  - `opportunity_list_with_orgs`
  - `initiative_detail`
  - `opportunity_detail`

- **Same workflow role, still domain-specific today**
  - `initiative_matrix_prepare`
  - `opportunity_matrix_prepare`
    - same place in the workflow
    - not treated as shared until prompt/config/base-matrix are actually unified
  - [ ] **12.5 Lot gate**
    - [ ] `make typecheck-api typecheck-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make lint-api lint-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make test-api-smoke test-api-endpoints API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make test-api-queue SCOPE=tests/queue/organization-batch-runtime.test.ts API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make test-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test`

- [x] **Lot 13 — Dashboard via TemplateRenderer (component, entity-loop, printOnly, path-based keys)**
  - [x] **TemplateRenderer extensions**
    - [x] Support `type: "component"` — renders a named Svelte slot, parent provides content via `<svelte:fragment slot="component" let:fieldKey>`
    - [x] Support `type: "entity-loop"` — reads `collections[field.collection]`, resolves template via `field.templateRef` (objectType), renders each entity with its own TemplateRenderer instance
    - [x] Support `printOnly: true` on any field — wraps in `{#if isPrinting}`, no DOM mount in normal view
    - [x] Support dot-notation path-based field keys — `getFieldValue("data.executive_summary.synthese_executive")` traverses nested objects
    - [x] Accept `collections` prop (Record<string, any[]>) for entity-loop data
  - [x] **Dashboard template seed**
    - [x] Update dashboard view template in `api/src/services/view-template-service.ts` to use the new format:
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
  - [x] **Dashboard page refactor**
    - [x] Replace FieldCard+EditableInput manual sections with `<TemplateRenderer template={dashboardTemplate} data={folder} collections={{ initiatives: filteredUseCases }} ...>`
    - [x] Provide component slots for: cover_page, sommaire, scatter_plot, annex_cover
    - [x] Keep existing scatter plot, cover page, sommaire, annex cover components — just render them via the slot
    - [x] Remove manual FieldCard wiring for exec summary sections
    - [x] Ensure print mode works: printOnly fields mount only on Ctrl+P, entity-loop renders each initiative via its own TemplateRenderer
  - [x] **Bugs identifiés en UAT Lot 13**
    - [x] BUG-L13-2: Références vides / [object Object] — handle object items `{title,url}` + shortKey for path-based keys.
    - [x] BUG-L13-3: Annexes absentes — scatter plot canvas null guard + printOnly via CSS `hidden`/`print-block` instead of Svelte conditional mount.
    - [x] BUG-L13-1: Print style — marges, page-breaks, polices, background. Correctifs :
      - [x] Correctif 1: renommer `usecase-print` → `template-initiative` dans `InitiativeDetail.svelte` + `initiative/[id]/+page.svelte` (couvre A8 marges, A9 bg image, A10 polices)
      - [x] Correctif 2: CSS print gap/spacing 0 sur TemplateRenderer + `:first-child` sans page-break entity-loop (couvre A2/A4/A6 extra marges, A3/A7 pages vierges)
      - [x] Correctif 3: bug B — initiative standalone bg overflow (double wrapper fix)
      - [x] Correctif 4: `pageContext` field modifier — cover/annex page context switching (couvre A2 marges cover, A3 page vierge, A6 marges annex cover)
  - [x] **Spec update**
    - [x] Update §12.4 with component, entity-loop, printOnly, path-based keys, collections prop
  - [x] Dev live-debug harness stabilized on root `ENV=dev` for Lot 13/UAT repros (`make exec-playwright-dev`, `make record-dev-playwright-auth`, helper endpoints, Maildev fallback)
  - [x] Follow-up deferred to BR-22: data-specific freeze on initiative `cc884370-765c-40f3-a754-ceaf9a05da04` when rendering/editing `constraints`; investigate post-merge in isolated mini-branch (suspected rich markdown list / TipTap `forceList` loop)
  - [ ] Lot gate *(consolidated BR-04B validation, including test checklists moved from Lot 11)*
    - [ ] `make typecheck-api typecheck-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] `make lint-api lint-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] **API tests**
      - [ ] Existing (non-reg): `api/tests/api/initiatives.test.ts` — verify initiative CRUD still passes with schema changes (organizationIds, proposal rename)
      - [ ] Existing (non-reg): `api/tests/api/initiatives-generate-matrix.test.ts` — verify matrix generation
      - [ ] Existing (non-reg): `api/tests/api/chat-tools.test.ts` — verify existing chat tools, proposal rename
      - [ ] Existing (non-reg): `api/tests/unit/context-initiative-detail-contract.test.ts` — verify context contract
      - [x] Existing branch work: `api/tests/api/view-templates.test.ts` — CRUD, resolution by workspaceId+workspaceType+objectType, seed on workspace creation, copy/reset/delete
      - [x] Existing branch work: `api/tests/unit/chat-service-document-generate.test.ts` — document_generate tool definition + handler
      - [x] Existing branch work: `api/tests/unit/chat-service-batch-create-orgs.test.ts` — batch_create_organizations tool definition + handler
      - [ ] Sub-lot gate: `make test-api API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
      - [ ] AI flaky tests (non-blocking): `make test-api-ai API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test-feat-workspace-template-catalog-b`
    - [ ] **UI tests**
      - [ ] Existing (non-reg): `ui/tests/stores/initiatives.test.ts` — verify store still works with new fields
      - [ ] Existing (non-reg): `ui/tests/stores/organizations.test.ts` — verify store
      - [x] Existing branch work: `ui/tests/stores/viewTemplateCache.test.ts` — resolveViewTemplate dedup, cache hit, clearViewTemplateCache
      - [ ] Update `ui/tests/upstream/injected-script.test.ts` if TemplateRenderer API changed
      - [ ] Add tests for path-based getFieldValue, entity-loop rendering, printOnly gating
      - [ ] Sub-lot gate: `make test-ui API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=test`
    - [ ] **E2E tests**
      - [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-workspace-template-catalog-b`
      - [x] Existing (non-reg): `e2e/tests/05-usecase-detail.spec.ts` — initiative detail page renders via TemplateRenderer
      - [ ] Existing (non-reg): `e2e/tests/01-organizations-detail.spec.ts` — org detail page renders via TemplateRenderer
      - [ ] Existing (non-reg): `e2e/tests/02-organizations.spec.ts` — org list
      - [x] Existing branch work: `e2e/tests/03-dashboard.spec.ts` — dashboard with FieldCard exec summary, print annexes
      - [ ] Existing (non-reg): `e2e/tests/06-settings.spec.ts` — config UX (copy/reset/delete) on templates/agents/workflows
      - [ ] Sub-lot gate group 00-01-02: `make clean test-e2e API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-workspace-template-catalog-b E2E_GROUP="00 01 02"`
      - [ ] Sub-lot gate group 03-04-05: `make clean test-e2e API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-workspace-template-catalog-b E2E_GROUP="03 04 05"`
      - [ ] Sub-lot gate group 06+: `make clean test-e2e API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-workspace-template-catalog-b E2E_GROUP="06"`
      - [ ] AI flaky tests (non-blocking): `make test-e2e E2E_SPEC=tests/00-ai-generation.spec.ts API_PORT=8705 UI_PORT=5105 MAILDEV_UI_PORT=1005 ENV=e2e-feat-workspace-template-catalog-b` and `03-chat.spec.ts`, document signatures

- [ ] **Lot N-2 — UAT**
  - [ ] Web app — current template-driven surfaces
    - [ ] `/initiative/{id}` : rendu identique visuellement (cartes colorées, layout 2/3+1/3, scores, sidebar)
    - [ ] `/organizations/{id}` : rendu identique (variant plain)
    - [ ] Dashboard courant : rendu via TemplateRenderer (synthèse, scatter plot via slot, print annexes via entity-loop)
    - [ ] Edit mode : champs éditables, sauvegarde auto, indicateur unsaved
    - [ ] Locked mode : champs en `@html`, pas d'édition
    - [ ] Édition collaborative : 2 onglets même surface, modifier un champ → SSE met à jour l'autre sans écraser un champ localement sale
    - [ ] Print : Ctrl+P fonctionne sur dashboard et initiative standalone
  - [ ] Web app — dashboard / folder
    - [ ] Dashboard visible et exploitable depuis le folder courant
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

## Deferred to BR-22

- Rich markdown list editor stabilization for initiative `constraints`: freeze reproduced on `cc884370-765c-40f3-a754-ceaf9a05da04`, likely around `TemplateRenderer` / `EditableInput` / `TipTap` list forcing and markdown roundtrip on rich list items.

## Future runtime extensions (out of BR-04 scope once Lot 12 is complete)

- [ ] Generic runtime message / interrupt / resume API exposed to product/UI surfaces.
- [ ] Generic child/sub-workflow execution across arbitrary workflow families.
- [ ] Advanced reducers / reusable join strategies beyond the needs of current workflows.
- [ ] Compensation / saga patterns and broader workflow-version migration concerns.
