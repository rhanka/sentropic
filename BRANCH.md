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
- [x] **Mono-branch + cherry-pick** (default; single final test cycle per segment)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI)
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

- [ ] **0.4 UI spec — container views, workflow launch & view template refactoring**
  - [ ] Absorb `spec/SPEC_VOL_UI_VIEWS.md` demands into `spec/SPEC_EVOL_WORKSPACE_TYPES.md` §12-§13:
    - Container view unification: one "container" `object_type` in view templates for all levels (workspace→folders, folder→initiatives, neutral→workspaces). Refactoring of existing Folder/UseCase list views.
    - Workflow launch templatizing: `object_type: "workflow_launch"` — each workspace type defines its own launch form via view template. Workspace template maps all views including home.
    - Specify refactoring impact on existing views (Folder, UseCase list, /home).
  - [ ] Delete `spec/SPEC_VOL_UI_VIEWS.md` once absorbed.

- [x] **0.5 Impact analysis on future branches**
  - [x] BR-06 (Chrome upstream v1): low impact — `use_cases`→`initiatives` rename affects `contextType` refs. Update post-merge.
  - [x] BR-07 (Release UI/npm): no impact — CI/packaging only.
  - [x] BR-08 (Model runtime Claude/Mistral): low impact — workspace-type-aware model defaults as future consideration.
  - [x] BR-09 (SSO Google): no impact — auth layer only.
  - [x] BR-10 (VSCode plugin v2 multi-agent): **high impact** — multi-agent orchestration depends on workspace type for tool gating + workflow selection. Must depend on BR-04. Re-scope after BR-04.
  - [x] BR-11 (Chrome multitab voice): low impact — same contextType rename as BR-06.
  - [x] BR-12 (Release Chrome/VSCode CI): no impact — CI/packaging only.
  - [x] BR-13 (Chrome plugin download): no impact — packaging/distribution only.
  - [x] Branches needing scope/dependency updates: **BR-06, BR-10, BR-11** (BR-10 is the most impacted).

- [x] **0.6 Rewrite branch plans**
  - [x] Rewrite `plan/04-BRANCH_feat-workspace-template-catalog.md` — now pointer to BRANCH.md.
  - [x] Rewrite `plan/06-BRANCH_feat-chrome-upstream-v1.md` — BR-04 low impact note added.
  - [x] BR-07, BR-08, BR-09, BR-12 — verified no BR-04 impact (no change needed).
  - [x] Rewrite `plan/10-BRANCH_feat-vscode-plugin-v2-multi-agent.md` — BR-04 HIGH IMPACT dependency note.
  - [x] Rewrite `plan/11-BRANCH_feat-chrome-upstream-multitab-voice.md` — BR-04 low impact note added.
  - [x] Rewrite `PLAN.md` — new timeline, dependency graph with BR-04 as structural branch, wave scheduling.
  - [x] Update `TODO.md` — BR-02/03/05 marked done, BR-04 scope updated.

- [ ] **0.7 Rewrite BRANCH.md lots 1-N**
  - [ ] Based on finalized specs and data model, rewrite all lots (1 through N) in this BRANCH.md with:
    - Actionable task lists per lot
    - API/UI/E2E test plans at file granularity (existing + new + updated files)
    - Detailed UAT checklists by impacted surface (web app / chrome plugin / vscode plugin)
    - Gate checklists per lot
  - [ ] Validate lot structure with user before proceeding to Lot 1.

- [ ] **Lot 0 gate**:
  - [ ] All open questions (BR04-D1/D2/D3, AWT-Q3/Q4, OQ-6/7/8/9) frozen with decisions documented.
  - [ ] `spec/SPEC_EVOL_WORKSPACE_TYPES.md` complete and reviewed.
  - [ ] Target data model ERD reviewed.
  - [ ] All branch plan files rewritten.
  - [ ] `PLAN.md` rewritten.
  - [ ] Lots 1-N rewritten in this BRANCH.md with actionable detail.
  - [ ] User sign-off on Lot 0 deliverables before proceeding to Lot 1.

### Lots 1-N — (to be rewritten at end of Lot 0)

Lot structure will be finalized based on Lot 0 spec work. Expected segments:

- **Segment A (~100 commits)**: Schema + workspace type + neutral workspace + initiative foundation → UAT Checkpoint A
- **Segment B (~100 commits)**: Opportunity domain + solution/product/portfolio + maturity gates → UAT Checkpoint B
- **Segment C (~100 commits)**: Template catalog per type + AI template factory + ad-hoc doc generation → UAT Checkpoint C
- **Segment D (~100 commits)**: UI polish + cross-cutting integration + E2E + final validation → UAT Checkpoint D / Final

Detailed lots with task lists, test plans, and UAT checklists will replace this section after Lot 0 gate.
