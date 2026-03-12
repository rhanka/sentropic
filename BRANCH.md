# Feature: BR-04 — Workspace Type System, Neutral Orchestrator & Multi-Domain Foundation

## Objective
Deliver a typed workspace system (`neutral`, `ai-ideas`, `opportunity`, `code`) with a neutral orchestrator workspace as default landing, initiative lifecycle with maturity gating and lineage, extended object model (solution, product, portfolio, bid), template-driven artifact production with AI generation, and cross-workspace orchestration tools.

## Scope / Guardrails
- Scope: workspace type system, neutral workspace, initiative maturity model, opportunity domain foundation, template catalog per type, document generation agents, cross-workspace tools.
- Budget: up to ~400 commits, segmented into 4 UAT checkpoints (~100 commits each).
- One migration max in `api/drizzle/*.sql` (consolidate all schema changes).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-workspace-template-catalog` (once sudo cleanup is resolved).
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-workspace-template-catalog` `API_PORT=8704` `UI_PORT=5104` `MAILDEV_UI_PORT=1004`.
- Dependencies: BR-03 (done, merged), BR-05 (done, merged). This branch builds on todo/steering/workflow runtime and VSCode plugin foundations.
- Must not break existing `ai-ideas` workspace behavior (backward-compatible).
- Neutral workspace is non-delegable (cannot be shared/transferred).
- **Lot 0 exit gate**: all evolution specs must be 100% framed, including impacts on future branches. All subsequent lots rewritten with actionable detail.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `plan/04-BRANCH_feat-workspace-template-catalog.md`
  - `plan/04-BRANCH-EVOL-DEMAND.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (max 1 file) — BR04-EX1
  - `.github/workflows/**`
  - `spec/**` — BR04-EX2 (spec evolution in Lot 0)
  - `PLAN.md` — BR04-EX3 (roadmap rewrite in Lot 0)
  - `TODO.md` — BR04-EX4 (roadmap sync)
  - `plan/0*-BRANCH_*.md` (other branch plan files) — BR04-EX5 (branch plan rewrite in Lot 0)
  - `Makefile` — only if strictly required
  - `docker-compose*.yml` — only if strictly required
  - `scripts/**`
- **Exception process**:
  - Declare exception ID `BR04-EXn` in `## Feedback Loop` before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `BR04-EX1` (approved): single migration file in `api/drizzle/*.sql` for all schema changes (workspace type, initiative maturity, products table).
  - Reason: schema evolution required for workspace typing and initiative lifecycle.
  - Impact: database migration on all environments.
  - Rollback: reverse migration SQL.
- `BR04-EX2` (approved): create/update spec files in `spec/**` during Lot 0 and Lot N-1.
  - Reason: Lot 0 requires full spec framework before implementation. New spec `spec/SPEC_EVOL_WORKSPACE_TYPES.md` + updates to `spec/SPEC.md`, `spec/DATA_MODEL.md`, `spec/SPEC_TEMPLATING.md`, `spec/TOOLS.md`.
  - Impact: documentation only, no runtime behavior change.
  - Rollback: revert spec changes.
- `BR04-EX3` (approved): rewrite `PLAN.md` to reflect new timeline and BR-04 scope expansion.
  - Reason: current PLAN.md window (2026-02-23 → 2026-03-08) is obsolete; BR-04 is now a multi-week structural branch.
  - Impact: roadmap documentation only.
  - Rollback: revert PLAN.md changes.
- `BR04-EX4` (approved): update `TODO.md` roadmap semantics.
  - Reason: sync with BR-04 scope evolution.
  - Impact: documentation only.
  - Rollback: revert TODO.md changes.
- `BR04-EX5` (approved): rewrite branch plan files `plan/0*-BRANCH_*.md` for non-done branches.
  - Reason: all future branch plans must reflect BR-04 impact (new workspace type system, initiative model).
  - Impact: planning documentation only. Done branches in `plan/done/` are NOT modified.
  - Rollback: revert plan file changes.

## Questions / Notes
- OQ-1 (closed): reuse `use_cases` table for all initiative types. Workspace type determines personality.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default; single final test cycle per segment)
- [x] **Multi-branch** (switched 2026-03-12: BR-04 dev in worktree `tmp/feat-workspace-template-catalog`, root stays on `main`)
- Rationale: BR-04 is large but sequential — segments A→B→C→D build on each other. UAT checkpoints every ~100 commits provide integration gates without multi-branch overhead.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch at each segment checkpoint (~100 commits).
- UAT checkpoints listed as checkboxes at the end of each segment.
- Execution flow (mandatory):
  - Develop and run tests in worktree (or root workspace if worktree setup pending).
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to development workspace after UAT.

## Plan / Todo (lot-based)

### Lot 0 — Baseline, spec framework & lot rewrite (current)

- [x] **0.1 Baseline setup**
  - [x] Confirm branch `feat/workspace-template-catalog` created from `main` (post BR-03 + BR-05). ✓ branch at `04f0b014`, 1 commit ahead of main.
  - [x] Resolve worktree cleanup. ✓ Pruned refs, old dir remnants don't block. Work in root workspace for now.
  - [x] Commit demand document (`plan/04-BRANCH-EVOL-DEMAND.md`) and this `BRANCH.md`. ✓ commit `04f0b014`.
  - [x] Cherry-pick useful code from old BR-04 branch. ✓ Decision: **rewrite from scratch**, old catalog service pattern used as reference only (scope has evolved too much for cherry-pick).
  - [x] Confirm environment mapping: `ENV=feat-workspace-template-catalog`, ports 8704/5104/1004. ✓ confirmed.

- [x] **0.2 Freeze open decisions**
  - [x] BR04-D1: ~~confirm `steer` = in-flight guidance~~. **Eliminated** — already fully specified and implemented in BR-03 (`execution_events` with steer type). No further action in BR-04 or any future branch.
  - [x] BR04-D2: ~~confirm `todo_tool` vs `todo_user` split~~. **Closed — no split, use BR-03 model as-is.** The unified `plan → todo → task` model is sufficient. A todo is a todo regardless of origin (human, agent, comment). Origin traced via `metadata.source` (JSONB, already available) — e.g. `{ "source": "comment", "comment_id": "xxx" }` or `{ "source": "agent", "run_id": "xxx" }`. Neutral workspace creates normal todos with `ownerUserId` = target user. Zero schema change.
  - [x] BR04-D3: **Closed — workflow = stage-based agent orchestration, confirmed.** BR-03 delivered: `workflow_definitions` + ordered `workflow_definition_tasks` + `agent_definitions`, with fork/detach/lineage. Seed agents in `default-agents.ts` are initial templates, customizable via settings panel (not hardcoded). Current limitations to address in spec: (1) closed compile-time task-key types (`GenerationAgentKey`, `UseCaseGenerationWorkflowTaskKey`), (2) single canonical workflow (`ai_usecase_generation_v1`), (3) generation-specific dispatch in `todo-orchestration.ts`. BR-04 spec must design the **multi-workflow registry** to open up these constraints (open task-key mapping, per-workspace-type workflow catalog, generic dispatch).
  - [x] AWT-Q3: **Closed — migration non-cassante.** (1) Legacy: workspaces existants reçoivent leur type (`ai-ideas`) sans impact artefacts — les artefacts n'ont aujourd'hui qu'une dépendance faible au générateur (modèle LLM stocké, pas de lien au type workspace). Pas de type legacy à conserver. (2) Futur: changement de template catalog → initiatives existantes conservées telles quelles, `template_snapshot_id`/`template_version` tracé sur l'initiative pour historique. Nouvelles initiatives utilisent le template courant. (3) Pas de re-template automatique (hors scope BR-04).
  - [x] AWT-Q4: **Closed — fallback vers le template par défaut du type workspace.** Chaque type workspace a un template default non-supprimable. Si le template configuré est indisponible → fallback sur le default du type + avertissement UI. Exemples : `ai-ideas` → workflow `ai_usecase_generation` (default), `opportunity` → workflow qualification (à spécifier). Le suffixe `_v1` disparaît en cible : le registry gère les versions par clé logique (clé workflow + version courante/historique). `neutral` = pas de génération propre (orchestrateur). `code` = workflow code analysis (à spécifier).
  - [x] OQ-6: **Closed — "initiative".** Nom universel pour l'objet métier (use case, opportunité, projet code). Porte la sémantique cycle de vie (lancement → maturation → livraison). Table `use_cases` renommée `initiatives` dans la migration unique. Vocabulaire API/UI/spec unifié sur "initiative" partout.
  - [x] OQ-7: **Closed — table `solutions` dédiée.** Objet métier distinct avec cycle de vie propre (draft → validated), pas un JSONB embarqué. FK `solution.initiative_id` (1 initiative → N solutions). Contenu structuré en `data jsonb`. Même pattern pour tous les objets métier (solution, bid, product).
  - [x] OQ-8: **Closed — table `bids` dédiée + jonction `bid_products`.** Bid = objet data-driven (clauses, profils, prix en `data jsonb`), cycle de vie propre (draft → review → finalized → contract). FK `bid.initiative_id`. Un bid couvre N products → table de jonction `bid_products(bid_id, product_id, data jsonb)` pour prix/conditions spécifiques par product. Une demande de devis = création d'une initiative type `opportunity` (l'initiative est le point d'entrée universel : idée, demande client, projet code). Schéma FK : `initiative ← solution(initiative_id) ← product(solution_id, initiative_id)`, `initiative ← bid(initiative_id) ← bid_products(bid_id, product_id)`.
  - [x] OQ-9: **Closed — par type workspace uniquement en v1.** Un folder hérite des gates de son type workspace. Pas d'override folder en v1 (simplification : un seul endroit de config, pas de conflits). Override folder possible en évolution future si besoin.

- [x] **0.3 Spec evolution & target data model**
  - [x] Create `spec/SPEC_EVOL_WORKSPACE_TYPES.md` — 13 sections with fusion trajectory table (§0). Initial 12 sections commit `87d841fb`.
  - [x] Articulate with existing SPEC_EVOL files:
    - ✓ Absorbed `SPEC_EVOL_AGENTIC_WORKSPACE_TODO.md` §2.2 → §7 multi-workflow registry
    - ✓ BR-15 overlap noted as dependency (not absorbed, orthogonal)
    - ✓ Updated `SPEC_EVOL_AGENTIC_WORKSPACE_TODO.md` §2.3 with neutral workspace todo note
  - [x] §12 View template system added: data-driven layout DSL per (workspace_type, object_type, maturity_stage). Table `view_templates` with fork/detach lineage. Templates for all object types per workspace type (initiative, solution, bid, product, organization, dashboard). Neutral landing = workspace cards + TODO feed.
  - [x] Canonical specs NOT updated now (Lot N-1). Fusion trajectory per section in §0 of SPEC_EVOL.

- [x] **0.4 UI spec — container views, workflow launch & view template refactoring**
  - [x] Absorb `spec/SPEC_VOL_UI_VIEWS.md` demands into `spec/SPEC_EVOL_WORKSPACE_TYPES.md` §12-§13:
    - ✓ §12.2 updated: complete object_type list + workspace type template mapping concept.
    - ✓ §12.4 updated: 6 new widget types (container_header, container_list, workflow_picker, folder_picker, object_picker, number).
    - ✓ §12.7 updated: object_type enum includes `container` and `workflow_launch`.
    - ✓ §12.8 added: Container view unification — one "container" object_type for all levels (neutral→workspaces, workspace→folders, folder→initiatives). DSL example. Refactoring impact on FolderDetail, UseCaseList, workspace landing.
    - ✓ §12.9 added: Workflow launch templatizing — `object_type: "workflow_launch"` per workspace type. DSL examples for ai-ideas, opportunity, code. Refactoring impact on /home.
    - ✓ §12.10 added: Complete workspace type template mapping table (all object_types × all workspace types).
    - ✓ §13 rewritten: new/refactored/modified screens with container convergence and workflow launch refactoring.
  - [x] Delete `spec/SPEC_VOL_UI_VIEWS.md` once absorbed. ✓ kept for traceability, will be deleted at lot 0 gate.

- [x] **0.5 Chat × workspace tools, doc connectors, LLM providers, RAG — cross-cutting spec & exclusions**
  - [x] Created `spec/SPEC_VOL_CHAT_DOCS_LLM_RAG.md` — raw demands: workspace×chat×tools coupling, ChatPanel modularization, Google Workspace/SharePoint connectors, Claude/Mistral/Cohere providers, RAG on documents.
  - [x] Absorbed into `spec/SPEC_EVOL_WORKSPACE_TYPES.md`:
    - ✓ §14 added: Workspace-type-aware chat & tool scoping — tool resolution becomes `(workspace_type, context_type, role)`. Per-type tool sets defined (ai-ideas, opportunity, code, neutral). Tool rename impact (`usecase`→`initiative`). Clear boundary: what BR-04 delivers vs defers.
    - ✓ §15 added: Cross-cutting exclusions & branch articulation — ChatPanel modularization (§15.1), document connectors (§15.2), RAG (§15.3), Cohere (§15.4), parallelization matrix (§15.5).
    - ✓ Fusion trajectory table updated (§14, §15).
    - ✓ Articulation section updated with MODEL_AUTH_PROVIDERS and MODEL_PROVIDERS_RUNTIME links.
  - [x] Updated `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md` — Cohere W2+ addition noted.
  - [x] New branch candidates identified: `feat/chat-modularization`, `feat/document-connectors`, `feat/rag-documents` (all parallelizable with BR-04).

- [x] **0.6 Impact analysis on future branches**
  - [x] BR-06 (Chrome upstream v1): low impact — `use_cases`→`initiatives` rename affects `contextType` refs. Update post-merge.
  - [x] BR-07 (Release UI/npm): no impact — CI/packaging only.
  - [x] BR-08 (Model runtime Claude/Mistral): low impact — workspace-type-aware model defaults as future consideration.
  - [x] BR-09 (SSO Google): no impact — auth layer only.
  - [x] BR-10 (VSCode plugin v2 multi-agent): **high impact** — multi-agent orchestration depends on workspace type for tool gating + workflow selection. Must depend on BR-04. Re-scope after BR-04.
  - [x] BR-11 (Chrome multitab voice): low impact — same contextType rename as BR-06.
  - [x] BR-12 (Release Chrome/VSCode CI): no impact — CI/packaging only.
  - [x] BR-13 (Chrome plugin download): no impact — packaging/distribution only.
  - [x] Branches needing scope/dependency updates: **BR-06, BR-10, BR-11** (BR-10 is the most impacted).
  - [x] New branches from cross-cutting analysis (0.5):
    - BR-14 (chat modularization): low BR-04 dependency — ChatPanel/ChatWidget refactoring, parallelizable.
    - BR-16 (document connectors): low BR-04 dependency — Google Workspace/SharePoint, initiative rename only.
    - BR-17 (RAG documents): no BR-04 dependency — chunking/embeddings/pgvector, depends on BR-16 + BR-08.
    - BR-08 scope extended to include Cohere (W2+).

- [x] **0.7 Rewrite branch plans**
  - [x] Rewrite `plan/04-BRANCH_feat-workspace-template-catalog.md` — now pointer to BRANCH.md.
  - [x] Rewrite `plan/06-BRANCH_feat-chrome-upstream-v1.md` — BR-04 low impact note added.
  - [x] BR-07, BR-08, BR-09, BR-12 — verified no BR-04 impact (no change needed).
  - [x] Rewrite `plan/10-BRANCH_feat-vscode-plugin-v2-multi-agent.md` — BR-04 HIGH IMPACT dependency note.
  - [x] Rewrite `plan/11-BRANCH_feat-chrome-upstream-multitab-voice.md` — BR-04 low impact note added.
  - [x] Rewrite `PLAN.md` — new timeline, dependency graph with BR-04 as structural branch, wave scheduling.
  - [x] Update `TODO.md` — BR-02/03/05 marked done, BR-04 scope updated.

- [x] **0.8 Rewrite BRANCH.md lots 1-N**
  - [x] 4 segments (A/B/C/D), 16 lots + N-2/N-1/N, with:
    - Segment A (Lots 1-5): migration, initiative rename (API+UI), workspace types, neutral landing + container view foundation.
    - Segment B (Lots 6-9): extended objects API, gate system, multi-workflow registry + generic dispatch, workspace-type-aware chat tools.
    - Segment C (Lots 10-13): view template API + seed data, ViewTemplateRenderer + container refactoring, initiative/extended object views, workflow launch templatizing.
    - Segment D (Lots 14-16): document generation, dashboards + neutral todo automation, E2E + polish.
    - Lot N-2: final UAT. Lot N-1: docs consolidation. Lot N: final validation + merge.
  - [ ] Validate lot structure with user before proceeding to Lot 1.

- [x] **Lot 0 gate**: ✓ validated 2026-03-12
  - [x] All open questions (BR04-D1/D2/D3, AWT-Q3/Q4, OQ-6/7/8/9) frozen with decisions documented.
  - [x] `spec/SPEC_EVOL_WORKSPACE_TYPES.md` complete and reviewed (§1-§15).
  - [x] Target data model ERD reviewed.
  - [x] All branch plan files rewritten (BR-04/06/07/08/10/11/14/16/17).
  - [x] `PLAN.md` rewritten (dependency graph, wave scheduling A/B/C/D).
  - [x] Lots 1-N rewritten in this BRANCH.md with actionable detail (16 lots + N-2/N-1/N).
  - [x] User sign-off on Lot 0 deliverables. Proceeding to Lot 1.

### Segment A — Schema, workspace types, initiative rename, neutral workspace (~100 commits)

#### Lot 1 — Migration & Drizzle schema

**API files (new/modified):**
- `api/drizzle/0024_*.sql` — single migration file (BR04-EX1): rename `use_cases`→`initiatives`, new columns on `workspaces` + `initiatives`, create 6 new tables (`solutions`, `products`, `bids`, `bid_products`, `workspace_type_workflows`, `view_templates`), indexes, FKs, backfill neutral workspaces + default view templates.
- `api/src/db/schema.ts` — update Drizzle schema: rename `useCases`→`initiatives`, add new columns, add 6 new table definitions.

**Tasks:**
- [x] Write migration SQL file (`api/drizzle/0024_workspace_types_initiatives.sql`) per §1.5 scope.
- [x] Update `api/src/db/schema.ts` — rename `useCases` table + relations, add `type`/`gate_config` on `workspaces`, add `antecedent_id`/`maturity_stage`/`gate_status`/`template_snapshot_id` on `initiatives`, add 6 new tables with relations.
- [x] Verify migration applies cleanly on fresh DB (`make db-migrate API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1014 ENV=feat-workspace-template-catalog`). ✓ 2026-03-12

**Lot 1 gate:** ✓ closed 2026-03-12
- [x] `make typecheck-api ENV=test-br04` ✓ 0 errors
- [x] `make lint-api ENV=test-br04` ✓ 0 errors (185 pre-existing warnings)
- [x] Migration applies + rollback SQL validated ✓ 2026-03-12

---

#### Lot 2 — Initiative rename (API deep rename)

**API files (modified):**
- `api/src/routes/api/use-cases.ts` → rename to `api/src/routes/api/initiatives.ts` + keep alias route `/api/v1/use-cases` → redirect to `/api/v1/initiatives`.
- `api/src/routes/api/index.ts` — update route registration.
- `api/src/services/context-usecase.ts` → rename to `api/src/services/context-initiative.ts`.
- `api/src/services/chat-service.ts` — update all `useCase`/`use_case` references to `initiative`.
- `api/src/services/tools.ts` — rename tools: `read_usecase`→`read_initiative`, `update_usecase_field`→`update_initiative_field`, `usecases_list`→`initiatives_list`.
- `api/src/services/tool-service.ts` — update tool dispatch.
- `api/src/services/todo-orchestration.ts` — update workflow dispatch references.
- `api/src/services/executive-summary.ts` — update use case references.
- `api/src/services/docx-service.ts` — update use case references.
- `api/src/services/docx-generation.ts` — update use case references.
- `api/src/services/queue-manager.ts` — update job types.
- `api/src/config/default-agents.ts` — update prompt references.
- `api/src/config/default-workflows.ts` — update task keys if needed.
- `api/src/routes/api/folders.ts` — update use case count references.
- `api/src/routes/api/import-export.ts` — update use case references.
- `api/src/routes/api/documents.ts` — update `contextType` enum to include `initiative`.
- `api/src/routes/api/comments.ts` — update context references.
- `api/src/routes/api/chat.ts` — update context type enum.

**Tasks:**
- [x] Rename route file `use-cases.ts` → `initiatives.ts`, update all endpoints `/use-cases` → `/initiatives`. ✓
- [x] Add backward-compatible alias: `/api/v1/use-cases/*` → forward to `/api/v1/initiatives/*`. ✓
- [x] Rename service file `context-usecase.ts` → `context-initiative.ts`, update all function names + types. ✓
- [x] Update all `useCases`/`useCase`/`use_case` references across API services (grep + systematic rename). ✓ includes ensure-indexes.ts fix
- [x] Update tool names in `tools.ts` and `tool-service.ts`. ✓
- [x] Update `contextType` enum values in chat, documents, comments. ✓
- [x] Update default agents/workflows prompt text. ✓
- [x] Fix all existing API tests to use `initiatives` naming. ✓

**Test plan:**
- [x] Existing API tests pass (all renamed refs). ✓ 294+7+49+26+4 passed, 0 failed
- [ ] Backward-compatible alias returns correct responses.

**Lot 2 gate:** ✓ closed 2026-03-12
- [x] `make typecheck-api ENV=test-br04` ✓ 0 errors
- [x] `make lint-api ENV=test-br04` ✓ 0 errors (185 pre-existing warnings)
- [x] `make test-api ENV=test-br04` ✓ all pass

---

#### Lot 3 — Initiative rename (UI deep rename)

**UI files (modified):**
- `ui/src/routes/usecase/` → rename to `ui/src/routes/initiative/` (route dir).
- `ui/src/lib/stores/useCases.ts` → rename to `ui/src/lib/stores/initiatives.ts`.
- `ui/src/lib/components/UseCaseDetail.svelte` → rename to `InitiativeDetail.svelte`.
- `ui/src/lib/components/UseCaseScatterPlot.svelte` → rename to `InitiativeScatterPlot.svelte`.
- `ui/src/lib/utils/chat-tool-scope.ts` — update tool name references.
- `ui/src/routes/folders/` — update use case references in folder views.
- `ui/src/routes/home/` — update generation form references.
- `ui/src/routes/dashboard/` — update chart references.
- `ui/src/routes/matrix/` — update references.
- `ui/src/routes/+layout.svelte` — update navigation if needed.
- `ui/src/lib/components/Header.svelte` — update navigation labels.
- `ui/src/lib/components/FileMenu.svelte` — update menu items.
- `ui/src/lib/components/ImportExportDialog.svelte` — update references.
- i18n dictionaries (FR/EN) — replace all "cas d'usage"/"use case" with "initiative".

**Tasks:**
- [x] Rename route directory and files. ✓
- [x] Rename store file and all store references across UI. ✓
- [x] Rename components and update all imports. ✓
- [x] Update API client calls to use `/initiatives` endpoints. ✓
- [x] Update i18n dictionaries. ✓
- [x] Update `chat-tool-scope.ts` tool references. ✓ (no usecase refs in file; tool IDs are API-protocol identifiers kept as-is)
- [x] Fix all existing UI tests. ✓

**Lot 3 gate:**
- [x] `make typecheck-ui ENV=test-br04` ✓
- [x] `make lint-ui ENV=test-br04` ✓
- [x] `make test-ui ENV=test-br04` ✓

---

#### Lot 4 — Workspace type system (API + UI)

**API files (new/modified):**
- `api/src/services/workspace-service.ts` — add `type` handling on workspace creation, enforce neutral workspace rules (non-delegable, auto-created, no initiatives).
- `api/src/routes/api/workspaces.ts` — add `type` field to create/read endpoints, enforce type immutability on update.
- `api/src/services/workspace-access.ts` — enforce neutral non-delegable (block `workspace_memberships` for neutral).

**UI files (new/modified):**
- `ui/src/routes/` — new route or modal for workspace creation with type selector.
- `ui/src/lib/stores/workspaceScope.ts` — expose `workspace.type` in store.
- `ui/src/lib/components/Header.svelte` — workspace switcher enhanced with type icon.

**Tasks:**
- [x] API: add `type` to workspace creation validation (Zod schema). ✓
- [x] API: auto-create neutral workspace on user registration/first login + migration backfill. ✓
- [x] API: enforce neutral constraints (no memberships, no initiatives, no workflows). ✓
- [x] API: enforce type immutability on workspace update. ✓
- [x] UI: add workspace type selector to workspace creation flow. ✓
- [x] UI: expose type in workspace stores and display type icon in header. ✓
- [x] Tests: workspace creation with type, neutral auto-creation, neutral constraints. ✓

**Lot 4 gate:**
- [x] `make typecheck-api ENV=test-br04` — 2026-03-12
- [x] `make lint-api ENV=test-br04` — 2026-03-12
- [x] `make test-api ENV=test-br04` — 2026-03-12
- [x] `make typecheck-ui ENV=test-br04` — 2026-03-12
- [x] `make lint-ui ENV=test-br04` — 2026-03-12
- [x] `make test-ui ENV=test-br04` — 2026-03-12

Closed: 2026-03-12

---

#### Lot 5 — Neutral workspace landing (container view foundation)

**UI files (new):**
- `ui/src/lib/components/ViewTemplateRenderer.svelte` — generic view template renderer (container + detail modes).
- `ui/src/lib/components/ContainerView.svelte` — container view sub-component (workspace→folders, folder→initiatives, neutral→workspaces).
- `ui/src/routes/neutral/+page.svelte` (or `/+page.svelte` as default landing) — neutral workspace landing using container view.

**API files (new/modified):**
- `api/src/routes/api/workspaces.ts` — `GET /api/v1/neutral/dashboard` endpoint (aggregate workspace data).

**Tasks:**
- [ ] Implement `ViewTemplateRenderer.svelte` core — resolve view template descriptor, dispatch to layout/widget renderers.
- [ ] Implement `ContainerView.svelte` — card/row list of children, sort/group options, container header, actions.
- [ ] Implement neutral landing page — list workspace cards (type icon, initiative count, last activity).
- [ ] API: neutral dashboard endpoint — aggregate workspace stats.
- [ ] Wire neutral workspace as default landing on login.

**Lot 5 gate:**
- [ ] `make typecheck-ui ENV=test-br04`
- [ ] `make lint-ui ENV=test-br04`
- [ ] `make test-ui ENV=test-br04`
- [ ] `make build-api build-ui-image API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-br04`
- [ ] `make clean test-e2e API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-br04`

---

#### UAT Checkpoint A

- [ ] **Web app**
  - [ ] Login → lands on neutral workspace (card-based dashboard).
  - [ ] Workspace switcher shows type icons.
  - [ ] Create a new `ai-ideas` workspace → verify type is set.
  - [ ] Create a new `opportunity` workspace → verify type is set.
  - [ ] Navigate to existing workspaces → type displays correctly, existing data intact.
  - [ ] Folder view lists "initiatives" (not "use cases") — labels updated.
  - [ ] Initiative detail page renders correctly (renamed route, store, component).
  - [ ] Dashboard scatter chart works (renamed references).
  - [ ] Chat tools show `read_initiative`, `update_initiative_field` (renamed).
  - [ ] Neutral workspace: cannot create initiatives, cannot share/delegate.
  - [ ] Generation workflow still works for `ai-ideas` workspace (non-regression).
- [ ] **Chrome plugin** (if impacted)
  - [ ] Chat tools display updated names.
  - [ ] Context type references work (`initiative` instead of `usecase`).
- [ ] **VSCode plugin** (if impacted)
  - [ ] Plugin connects and functions with renamed endpoints.

---

### Segment B — Extended objects, gates, multi-workflow, chat tools (~100 commits)

#### Lot 6 — Extended objects API (solutions, products, bids)

**API files (new):**
- `api/src/routes/api/solutions.ts` — CRUD endpoints per §11.3.
- `api/src/routes/api/products.ts` — CRUD endpoints per §11.3.
- `api/src/routes/api/bids.ts` — CRUD endpoints per §11.3 (including bid_products attach/detach).
- `api/src/services/context-solution.ts` — solution business logic.
- `api/src/services/context-product.ts` — product business logic.
- `api/src/services/context-bid.ts` — bid business logic.

**API files (modified):**
- `api/src/routes/api/index.ts` — register new routes.

**Tasks:**
- [ ] Implement solution CRUD API (create, read, update, delete, list by initiative).
- [ ] Implement product CRUD API (create, read, update, delete, list by initiative/solution).
- [ ] Implement bid CRUD API (create, read, update, delete, list by initiative).
- [ ] Implement bid_products junction API (attach/detach products to bid).
- [ ] Zod validation schemas for all new endpoints.
- [ ] Workspace access middleware on all new endpoints.
- [ ] Tests: CRUD operations, access control, cascade behavior.

**Lot 6 gate:**
- [ ] `make typecheck-api ENV=test-br04`
- [ ] `make lint-api ENV=test-br04`
- [ ] `make test-api ENV=test-br04`

---

#### Lot 7 — Gate system (API + UI)

**API files (new/modified):**
- `api/src/services/gate-service.ts` (new) — gate evaluation logic per §6.2.
- `api/src/routes/api/initiatives.ts` — integrate gate evaluation on `maturity_stage` transition.
- `api/src/routes/api/workspaces.ts` — `gate_config` management in workspace settings.

**UI files (new):**
- `ui/src/lib/components/GateReview.svelte` — gate criteria evaluation view (§13.1).
- Route `ui/src/routes/initiative/[id]/gate/` — gate review page.

**Tasks:**
- [ ] Implement gate evaluation service: resolve `gate_config`, evaluate `required_fields` + `guardrail_categories`, return `{ gate_passed, warnings, blockers }`.
- [ ] Integrate gate check on `PATCH /api/v1/initiatives/:id` when `maturity_stage` changes.
- [ ] Implement default gate configs per workspace type (seed on workspace creation).
- [ ] UI: gate review page with criteria display and pass/fail indicators.
- [ ] UI: maturity stage badge component with gate status.
- [ ] Tests: gate evaluation (free/soft/hard modes), stage transitions.

**Lot 7 gate:**
- [ ] `make typecheck-api ENV=test-br04`
- [ ] `make lint-api ENV=test-br04`
- [ ] `make test-api ENV=test-br04`
- [ ] `make typecheck-ui ENV=test-br04`
- [ ] `make lint-ui ENV=test-br04`
- [ ] `make test-ui ENV=test-br04`

---

#### Lot 8 — Multi-workflow registry & generic dispatch

**API files (new/modified):**
- `api/src/routes/api/workflow-config.ts` — extend with workspace type workflow registry endpoints (§11.5).
- `api/src/services/todo-orchestration.ts` — replace `startUseCaseGenerationWorkflow()` with generic `startWorkflow(workspaceId, workflowKey)` per §7.4.
- `api/src/config/default-workflows.ts` — extend with seed workflows per workspace type (§7.6).
- `api/src/config/default-agents.ts` — extend with seed agents per workspace type (§8.1).

**Tasks:**
- [ ] Implement `workspace_type_workflows` CRUD endpoints.
- [ ] Seed default workflows per workspace type on workspace creation.
- [ ] Refactor `todo-orchestration.ts`: generic dispatch replacing hardcoded `ai_usecase_generation_v1` references.
- [ ] Open task-key mapping: remove closed compile-time types (`GenerationAgentKey`, `UseCaseGenerationWorkflowTaskKey`) → runtime lookup (§7.3).
- [ ] Seed agents per workspace type (opportunity: demand_analyst, solution_architect, etc.).
- [ ] Tests: workflow registry CRUD, generic dispatch, backward compat for existing `ai-ideas` workflow.

**Lot 8 gate:**
- [ ] `make typecheck-api ENV=test-br04`
- [ ] `make lint-api ENV=test-br04`
- [ ] `make test-api ENV=test-br04`

---

#### Lot 9 — Workspace-type-aware chat tools (§14)

**API files (modified):**
- `api/src/services/tools.ts` — add new tools for extended objects: `solutions_list`, `solution_get`, `bids_list`, `bid_get`, `products_list`, `product_get`, `gate_review`.
- `api/src/services/tool-service.ts` — update tool dispatch for new tools.
- `api/src/services/chat-service.ts` → `buildChatGenerationContext()` — add `workspace_type` to tool resolution chain (§14.2).

**UI files (modified):**
- `ui/src/lib/utils/chat-tool-scope.ts` — add workspace-type filtering.

**Tasks:**
- [ ] Implement new chat tools for extended objects (CRUD via chat).
- [ ] Implement cross-workspace tools for neutral (§3.3): `workspace_list`, `initiative_search`, `task_dispatch`.
- [ ] Update `buildChatGenerationContext()` — tool set resolution becomes `(workspace_type, context_type, role)`.
- [ ] Update client `chat-tool-scope.ts` with workspace-type-aware filtering.
- [ ] Tests: tool availability per workspace type, cross-workspace tools in neutral.

**Lot 9 gate:**
- [ ] `make typecheck-api ENV=test-br04`
- [ ] `make lint-api ENV=test-br04`
- [ ] `make test-api ENV=test-br04`
- [ ] `make typecheck-ui ENV=test-br04`
- [ ] `make lint-ui ENV=test-br04`
- [ ] `make test-ui ENV=test-br04`
- [ ] `make build-api build-ui-image API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-br04`
- [ ] `make clean test-e2e API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-br04`

---

#### UAT Checkpoint B

- [ ] **Web app**
  - [ ] In `opportunity` workspace: create initiative → create solution → create product → create bid → attach products to bid.
  - [ ] Verify solution/product/bid lifecycle (status transitions).
  - [ ] Gate system: advance initiative from G0→G2 (soft gate) → verify warnings displayed.
  - [ ] Gate system: attempt G2→G5 without required fields (hard gate) → verify blocked.
  - [ ] Multi-workflow: settings shows registered workflows per workspace type.
  - [ ] Chat in `opportunity` workspace: tools `solutions_list`, `bid_get` etc. available.
  - [ ] Chat in `ai-ideas` workspace: extended object tools NOT available (scoped).
  - [ ] Chat in neutral workspace: `workspace_list`, `initiative_search` tools available.
  - [ ] Generation workflow in `ai-ideas` still works (non-regression after generic dispatch).
- [ ] **Chrome plugin**
  - [ ] Chat tool scoping reflects workspace type.
- [ ] **VSCode plugin**
  - [ ] Plugin tools work with renamed endpoints.

---

### Segment C — View templates, container refactoring, workflow launch, template catalog (~100 commits)

#### Lot 10 — View template API & seed data

**API files (new):**
- `api/src/routes/api/view-templates.ts` — CRUD for view templates.
- `api/src/services/view-template-service.ts` — resolution logic `(workspace_type, object_type, maturity_stage?)` → view template descriptor.
- `api/src/config/default-view-templates.ts` — seed view template descriptors per workspace type (§12.5, §12.8, §12.9, §12.10).

**API files (modified):**
- `api/src/routes/api/index.ts` — register view template routes.
- `api/src/services/workspace-service.ts` — seed view templates on workspace creation.

**Tasks:**
- [ ] Implement view template CRUD API (list, get, update, fork, detach).
- [ ] Implement view template resolution service: `(workspace_type, object_type, maturity_stage?)` → descriptor.
- [ ] Create seed view template descriptors for all workspace types × object types (§12.10 mapping table).
- [ ] Seed view templates on workspace creation (same pattern as workflows/agents).
- [ ] Tests: CRUD, resolution, fork/detach, seed on workspace creation.

**Lot 10 gate:**
- [ ] `make typecheck-api ENV=test-br04`
- [ ] `make lint-api ENV=test-br04`
- [ ] `make test-api ENV=test-br04`

---

#### Lot 11 — ViewTemplateRenderer & container view refactoring

**UI files (new/modified):**
- `ui/src/lib/components/ViewTemplateRenderer.svelte` — extend with all widget types (§12.4).
- `ui/src/lib/components/ContainerView.svelte` — finalize container view for all levels.
- `ui/src/lib/components/widgets/` (new dir) — individual widget renderers: `TextWidget.svelte`, `RichtextWidget.svelte`, `TagWidget.svelte`, `ListWidget.svelte`, `RatingsTableWidget.svelte`, `StageBadgeWidget.svelte`, `ChildListWidget.svelte`, `LineageGraphWidget.svelte`, `ContainerListWidget.svelte`, `ContainerHeaderWidget.svelte`, `WorkflowPickerWidget.svelte`, `FolderPickerWidget.svelte`, `ObjectPickerWidget.svelte`, etc.
- `ui/src/routes/folders/` — refactor `FolderDetail` to use `ViewTemplateRenderer` with `object_type: "container"`.
- `ui/src/routes/neutral/` (or root) — update neutral landing to use container view from API-driven template.

**Tasks:**
- [ ] Implement widget renderer components for all widget types (§12.4).
- [ ] Implement tab layout renderer (for multi-tab view templates like opportunity initiative).
- [ ] Refactor folder detail page → `ViewTemplateRenderer` with container `object_type`.
- [ ] Refactor workspace root page → container view.
- [ ] Refactor neutral landing → container view from API view template.
- [ ] Tests: widget rendering, container view at all levels.

**Lot 11 gate:**
- [ ] `make typecheck-ui ENV=test-br04`
- [ ] `make lint-ui ENV=test-br04`
- [ ] `make test-ui ENV=test-br04`

---

#### Lot 12 — Initiative detail view-template-driven + extended object views

**UI files (new/modified):**
- `ui/src/lib/components/InitiativeDetail.svelte` — refactor to use `ViewTemplateRenderer` (vertical for ai-ideas, tabs for opportunity/code).
- `ui/src/routes/initiative/[id]/solutions/` — solution editor route (view-template-driven).
- `ui/src/routes/initiative/[id]/bids/` — bid editor route (view-template-driven).
- `ui/src/routes/products/` — product editor route (view-template-driven).
- `ui/src/lib/components/widgets/PricingGridWidget.svelte` — bid pricing.
- `ui/src/lib/components/widgets/ClauseEditorWidget.svelte` — bid clauses.

**Tasks:**
- [ ] Refactor initiative detail to use `ViewTemplateRenderer` — resolve template per workspace type.
- [ ] Implement solution editor (view-template-driven CRUD).
- [ ] Implement product editor (view-template-driven CRUD).
- [ ] Implement bid editor (view-template-driven CRUD with tabs: clauses/products/pricing).
- [ ] Implement `PricingGridWidget` and `ClauseEditorWidget` for bid views.
- [ ] Implement `ChildListWidget` for embedded solution/product/bid lists in initiative detail.
- [ ] Tests: view rendering per workspace type, CRUD operations.

**Lot 12 gate:**
- [ ] `make typecheck-ui ENV=test-br04`
- [ ] `make lint-ui ENV=test-br04`
- [ ] `make test-ui ENV=test-br04`

---

#### Lot 13 — Workflow launch templatizing & template catalog

**UI files (new/modified):**
- `ui/src/routes/home/+page.svelte` — refactor to `ViewTemplateRenderer` with `object_type: "workflow_launch"` per §12.9.
- `ui/src/lib/components/widgets/WorkflowPickerWidget.svelte` — workflow selector driven by workspace type registry.

**API files (modified):**
- `api/src/config/default-view-templates.ts` — add workflow_launch seed templates for ai-ideas/opportunity/code.

**Tasks:**
- [ ] Refactor `/home` page to use `ViewTemplateRenderer` with `workflow_launch` object type.
- [ ] Implement `WorkflowPickerWidget` — lists registered workflows for current workspace type.
- [ ] Seed workflow launch templates per workspace type (ai-ideas = existing form, opportunity = qualification form, code = analysis form).
- [ ] Template catalog UI in settings (per workspace type) — list/manage template families (§9).
- [ ] Tests: workflow launch per workspace type, template catalog display.

**Lot 13 gate:**
- [ ] `make typecheck-api ENV=test-br04`
- [ ] `make lint-api ENV=test-br04`
- [ ] `make test-api ENV=test-br04`
- [ ] `make typecheck-ui ENV=test-br04`
- [ ] `make lint-ui ENV=test-br04`
- [ ] `make test-ui ENV=test-br04`
- [ ] `make build-api build-ui-image API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-br04`
- [ ] `make clean test-e2e API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-br04`

---

#### UAT Checkpoint C

- [ ] **Web app**
  - [ ] Neutral landing → container view with workspace cards (driven by view template).
  - [ ] Workspace root → container view with folders (driven by view template).
  - [ ] Folder → container view with initiatives (driven by view template, replaces old FolderDetail).
  - [ ] `ai-ideas` initiative detail → vertical layout (existing fields, driven by template).
  - [ ] `opportunity` initiative detail → tabs (Overview / Pipeline / Lineage).
  - [ ] Pipeline tab → embedded lists of solutions, bids, products (ChildListWidget).
  - [ ] Solution/product/bid editors → view-template-driven CRUD.
  - [ ] Bid editor → tabs (Clauses / Products / Pricing).
  - [ ] `/home` → workflow launch form driven by workspace type (ai-ideas = existing, opportunity = qualification form).
  - [ ] Settings → view template catalog per workspace type.
  - [ ] Non-regression: `ai-ideas` generation workflow still works end-to-end.
- [ ] **Chrome plugin**
  - [ ] Chat renders correctly with new workspace-type-aware context.
- [ ] **VSCode plugin**
  - [ ] Plugin context references updated.

---

### Segment D — Document generation, dashboard, polish, E2E, final validation (~100 commits)

#### Lot 14 — Document generation (Mode A + Mode B)

**API files (new/modified):**
- `api/src/services/docx-service.ts` — extend template families for opportunity objects (§9.1): `opportunity-brief`, `solution-proposal`, `bid-document`, `product-datasheet`.
- `api/src/services/tools.ts` — add `document_generate` chat tool (§10.2 Mode B).
- `api/src/config/default-workflows.ts` — add document generation tasks to opportunity workflow (§10.1 Mode A).

**Tasks:**
- [ ] Implement new DOCX template families per workspace type × maturity stage.
- [ ] Implement `document_generate` chat tool (ad-hoc generation from chat context).
- [ ] Integrate document generation tasks in opportunity workflow (Mode A).
- [ ] Tests: template rendering for new object types, chat tool generation.

**Lot 14 gate:**
- [ ] `make typecheck-api ENV=test-br04`
- [ ] `make lint-api ENV=test-br04`
- [ ] `make test-api ENV=test-br04`

---

#### Lot 15 — Dashboard per workspace type & neutral todo automation

**UI files (new/modified):**
- `ui/src/routes/dashboard/+page.svelte` — refactor to view-template-driven dashboard per workspace type.
- `ui/src/lib/components/widgets/ChartWidget.svelte` — generic chart widget (scatter, funnel, bar, etc.).

**API files (new/modified):**
- `api/src/routes/api/analytics.ts` — extend with per-workspace-type analytics (funnel, pipeline value, velocity).
- `api/src/services/todo-orchestration.ts` — neutral todo automation (§3.4): event-driven todo creation on gate transitions, bid finalization, comment assignment.

**Tasks:**
- [ ] Implement per-workspace-type dashboard views (ai-ideas scatter existing, opportunity funnel, code burndown, neutral cross-workspace).
- [ ] Extend analytics API for opportunity pipeline metrics.
- [ ] Implement neutral todo automation: event listener on `execution_events` → auto-create todos in neutral workspace.
- [ ] Tests: dashboard rendering per type, todo automation events.

**Lot 15 gate:**
- [ ] `make typecheck-api ENV=test-br04`
- [ ] `make lint-api ENV=test-br04`
- [ ] `make test-api ENV=test-br04`
- [ ] `make typecheck-ui ENV=test-br04`
- [ ] `make lint-ui ENV=test-br04`
- [ ] `make test-ui ENV=test-br04`

---

#### Lot 16 — E2E tests & cross-cutting polish

**E2E files (new/modified):**
- `e2e/tests/` — new E2E scenarios:
  - Workspace creation with type selection.
  - Neutral workspace landing + workspace navigation.
  - Initiative CRUD with renamed routes.
  - Extended objects CRUD (solution, bid, product).
  - Gate transition (soft/hard modes).
  - Workflow launch per workspace type.
  - Container view navigation (neutral → workspace → folder → initiative).
  - Chat with workspace-type-aware tools.

**Tasks:**
- [ ] Write E2E scenarios for all new surfaces.
- [ ] Update existing E2E tests for initiative rename.
- [ ] Cross-cutting polish: navigation breadcrumbs, error states, loading states, empty states.
- [ ] Accessibility pass on new views.
- [ ] Performance check: view template resolution, container view rendering.

**Lot 16 gate:**
- [ ] `make typecheck-api ENV=test-br04`
- [ ] `make lint-api ENV=test-br04`
- [ ] `make test-api ENV=test-br04`
- [ ] `make typecheck-ui ENV=test-br04`
- [ ] `make lint-ui ENV=test-br04`
- [ ] `make test-ui ENV=test-br04`
- [ ] `make build-api build-ui-image API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-br04`
- [ ] `make clean test-e2e API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-br04`

---

#### Lot N-2 — UAT Checkpoint D (Final)

- [ ] **Web app**
  - [ ] Full scenario: register → neutral landing → create opportunity workspace → create folder → create initiative → advance gates G0→G2→G5 → create solution → create products → create bid → attach products → finalize bid → advance G7 → generate documents.
  - [ ] Full scenario: create ai-ideas workspace → generate initiatives (existing workflow) → view in container → detail → dashboard scatter → export DOCX.
  - [ ] Neutral workspace: workspace cards, activity feed, auto-generated todos from gate events.
  - [ ] Container view at all levels (neutral→workspace→folder→initiative).
  - [ ] View template rendering per workspace type (vertical vs tabs).
  - [ ] Workflow launch per workspace type.
  - [ ] Chat tools per workspace type (scoped correctly).
  - [ ] Settings: workflow registry, view template management.
  - [ ] Non-regression: all existing functionality (import/export, comments, collaboration, locks, documents).
- [ ] **Chrome plugin**
  - [ ] Chat with workspace-type-aware tool scoping.
  - [ ] Context references use `initiative` (not `usecase`).
- [ ] **VSCode plugin**
  - [ ] Connection and tool execution with renamed endpoints.

---

#### Lot N-1 — Docs consolidation

- [ ] Consolidate `spec/SPEC_EVOL_WORKSPACE_TYPES.md` into canonical specs per fusion trajectory (§0):
  - `DATA_MODEL.md` — ERD + new table descriptions.
  - `SPEC.md` — functional map, data model, API contracts, UI screens.
  - `TOOLS.md` — per-workspace-type tool sets + agent catalog.
  - `SPEC_TEMPLATING.md` — template families per type × stage.
  - `SPEC_CHATBOT.md` — workspace-type-aware tool scoping.
- [ ] Remove absorbed sections from `SPEC_EVOL_AGENTIC_WORKSPACE_TODO.md` §2.2 (replaced by pointer to `SPEC.md`).
- [ ] Delete `spec/SPEC_VOL_UI_VIEWS.md` and `spec/SPEC_VOL_CHAT_DOCS_LLM_RAG.md`.
- [ ] Update `PLAN.md` status (BR-04 done).
- [ ] Update `TODO.md` (BR-04 done).

---

#### Lot N — Final validation

- [ ] Re-run full branch gates:
  - [ ] `make typecheck-api ENV=test-br04`
  - [ ] `make lint-api ENV=test-br04`
  - [ ] `make test-api ENV=test-br04`
  - [ ] `make typecheck-ui ENV=test-br04`
  - [ ] `make lint-ui ENV=test-br04`
  - [ ] `make test-ui ENV=test-br04`
  - [ ] `make build-api build-ui-image API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-br04`
  - [ ] `make clean test-e2e API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-br04`
- [ ] Verify CI status.
- [ ] Attach executed command list in PR notes.
- [ ] User sign-off on final UAT.
- [ ] Merge to main.
