# Feature: BR-04 — Workspace Type System, Neutral Orchestrator & Multi-Domain Foundation

## Objective
Deliver a typed workspace system (`neutral`, `ai-ideas`, `opportunity`, `code`) with neutral orchestrator workspace, initiative lifecycle with maturity gating and lineage, extended object model (solution, product, bid/contract), multi-workflow registry, template-driven artifact production with AI generation, and cross-workspace orchestration tools.

## Status
Active. See `BRANCH.md` in worktree for live progress tracking.

## Dependencies
- BR-03 (done, merged) — TODO/steering/workflow runtime
- BR-05 (done, merged) — VSCode plugin v1

## Key specs
- `spec/SPEC_EVOL_WORKSPACE_TYPES.md` — full evolution spec (§7-§8 for workflows/agents)
- `spec/SPEC_VOL_OPPORTUNITY_WORKFLOW.md` — raw product intent (A-F)
- `plan/04-BRANCH-EVOL-DEMAND.md` — evolution demand document

## Scope
See `BRANCH.md` for full scope boundaries, decision log, and lot-based plan.
This file is a pointer — `BRANCH.md` is the authoritative tracking document.

## Plan / Todo (lot-based)

- [x] **Lot 3 — UAT bug fixes**
  - [x] Bug 2: ZodError `objectType: "usecase"` → replaced with `'initiative'` in all UI API-facing calls.
  - [x] Bug 3: Missing FileMenu in neutral view → integrated FileMenu into ViewTemplateRenderer.
  - [x] Bug 4: "Nouveau workspace" redirects to /settings → extracted WorkspaceCreateDialog, opens inline.
  - [x] Bug 5: Sortable columns in neutral → removed. Deferred to BR-18.
  - [x] Bug 6: Folder initiative count always 0 → UI store field renamed `useCaseCount` → `initiativeCount`.
  - [x] Bug 7: Workflow hardcoded to AI → resolves by workspace type via `getWorkflowSeedsForType`.
  - [x] Bug 8: Cannot delete workspace → added BR-04 tables to deletion cascade.
  - [x] Bug 9: Workspace cards non-standard → harmonized with folder card layout.

- [ ] **Lot 4 — Generic workflow engine + agent/prompt restructuration + opportunity neutralisation (§7.4, §8.3, §8.4, §8.5)**
  - [ ] Delete `api/src/config/default-prompts.ts` entirely.
  - [ ] Create `api/src/config/default-chat-system.ts`: chat system prompt per workspace type + common chat prompts (reasoning eval, session title, conversation auto).
  - [ ] Create `api/src/config/default-agents-ai-ideas.ts`: AI agents with prompts in `config.promptTemplate`.
  - [ ] Create `api/src/config/default-agents-opportunity.ts`: opportunity agents with neutral prompts.
  - [ ] Create `api/src/config/default-agents-shared.ts`: agents available on all workspace types (demand_analyst, solution_architect, bid_writer, gate_reviewer, comment_assistant, history_analyzer, document_summarizer, document_analyzer).
  - [ ] Create `api/src/config/default-agents-code.ts`: code agents with prompts.
  - [ ] Move `structured_json_repair` to local constant in `api/src/services/context-initiative.ts`.
  - [ ] Update `api/src/config/default-agents.ts`: import from split files, include shared agents for all types.
  - [ ] Update `api/src/config/default-workflows.ts`: add `opportunity_identification` workflow seed. Set as default for opportunity type.
  - [ ] Migrate all `readLegacyPromptTemplate()` / `defaultPrompts.find(...)` to agent-based prompt resolution.
  - [ ] Generic workflow engine (§7.4): refactor `startInitiativeGenerationWorkflow` into `startWorkflow(workspaceId, workflowKey)` — resolves workflow from DB → ordered tasks → agent per task → prompt from agent config.
  - [ ] Create `api/src/config/default-matrix-opportunity.ts`: neutral matrix (no `ai_maturity`, renamed axes, neutralized descriptions).
  - [ ] Wire workspace type → default matrix selection on folder creation.
  - [ ] Chat system prompt per workspace type in `chat-service.ts`.
  - [ ] Draft neutral prompts for opportunity agents (list, detail, matrix, synthesis).
  - [ ] Lot 4 gate:
    - [ ] `make typecheck-api API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`
    - [ ] `make lint-api API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`
    - [ ] `make test-api API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`

- [ ] **Lot 5 — Multi-org, batch org generation, matrix customisation (B, B', C, D)**
  - [ ] B: Multi-org per opportunity — `organizationIds` array in initiative data JSONB. Prompts produce initiatives mapped to organisations.
  - [ ] B: Auto-create orgs option — new task `create_organizations` before `opportunity_list`. Prompt retrieves existing orgs. Also available for AI workflow.
  - [ ] B': Batch org generation — `organization_batch_agent` creates org list from prompt.
  - [ ] C: Matrix adaptable per org — `matrixSource` option (`organization` | `prompt` | `default`) in workflow config.
  - [ ] D: Matrix axes customisation — prompt allows proposing adapted axis names/descriptions.
  - [ ] Lot 5 gate:
    - [ ] `make typecheck-api API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`
    - [ ] `make lint-api API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`
    - [ ] `make test-api API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`

- [ ] **Lot N-2 — UAT**
  - [ ] Workspace neutral
    - [ ] Login → lands on neutral dashboard with workspace cards
    - [ ] Workspace cards show correct initiative count and last activity
    - [ ] FileMenu (chevron) visible, "New" opens creation dialog inline
    - [ ] Create new workspace (opportunity type) → dialog works, workspace appears
    - [ ] Hide then delete workspace → works without FK error
  - [ ] Workspace ai-ideas (non-regression)
    - [ ] Create folder → generation uses AI workflow with AI prompts
    - [ ] Matrix is AI-oriented (includes `ai_maturity` axis)
    - [ ] Initiative detail has `dataSources`/`dataObjects` fields
    - [ ] Chat system prompt mentions AI assistant
    - [ ] All existing tools (web_search, web_extract, documents, tab_read, tab_action) work
  - [ ] Workspace opportunity
    - [ ] Create folder → generation uses `opportunity_identification` workflow with neutral prompts
    - [ ] Prompts are neutral (no AI mention), initiatives are business opportunities
    - [ ] Matrix is neutral (no `ai_maturity`, axes renamed to `regulatory_compliance`/`resource_availability`)
    - [ ] Initiative detail does NOT have `dataSources`/`dataObjects`
    - [ ] `problem` framed as client/market problem, `solution` as proposed offering
    - [ ] Chat system prompt mentions opportunity management (not AI)
    - [ ] Executive summary is business-focused (not AI-focused)
  - [ ] Multi-org (B)
    - [ ] Opportunity can reference multiple organisations
    - [ ] Auto-create orgs option works in generation workflow
    - [ ] Existing orgs not duplicated
  - [ ] Batch org generation (B')
    - [ ] Create orgs from prompt (e.g. "top 10 pharma in Montreal")
  - [ ] Matrix (C, D)
    - [ ] Matrix can reuse org matrix or generate new one
    - [ ] Axes can be customised (not just scale descriptions)
  - [ ] Non-regression
    - [ ] ZodError gone (objectType = 'initiative')
    - [ ] Folder initiative count correct
    - [ ] Lock/presence/comments work on initiatives
    - [ ] Import/export works

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate into `spec/SPEC_EVOL_WORKSPACE_TYPES.md`.
  - [ ] Update `PLAN.md` status.

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-api API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`
  - [ ] `make typecheck-ui API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`
  - [ ] `make lint-api API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`
  - [ ] `make lint-ui API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`
  - [ ] `make test-api API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`
  - [ ] `make test-ui API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=test-feat-workspace-template-catalog`
  - [ ] `make build-api build-ui-image API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-feat-workspace-template-catalog`
  - [ ] `make clean test-e2e API_PORT=8704 UI_PORT=5104 MAILDEV_UI_PORT=1004 ENV=e2e-feat-workspace-template-catalog`
