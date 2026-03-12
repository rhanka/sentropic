# BR-04 Evolution Demand — Workspace Typing, Neutral Orchestrator & Multi-Domain Foundation

## Origin
User demand captured 2026-03-12 during BR-04 rebase analysis.
Context: BR-03 (todo/steering/workflow-core) and BR-05 (vscode-plugin-v1) are merged. BR-04 (workspace-template-catalog) is feature-complete but 270 commits diverged — needs rebase and scope evolution.

Updated 2026-03-12 with user feedback rounds 2 and 3 (neutral workspace UX, object model depth, maturity gating, template generation, budget extension).

---

## Core Vision

### 1. Neutral Workspace (orchestrator)
- A **non-delegable** workspace type that acts as the **control plane** for the user's workspace ecosystem.
- No domain-specific objects (no use cases, no opportunities) — purely orchestration.
- Unique capabilities:
  - **Cross-workspace tool**: address other workspaces and their agents from the neutral workspace chat.
  - **Workspace factory**: create new typed workspaces (shared or private).
  - **Agent configuration hub**: manage and assign agents across workspaces.
- Every user gets exactly one neutral workspace (singleton, non-transferable).

#### 1.1 Neutral Workspace — Auto-creation & Landing (user feedback round 2)
- **Auto-creation**: if no neutral workspace exists for the user, create it automatically. It becomes the **default landing workspace** after login.
- **Default view**: card-based dashboard presenting:
  - **Workspace cards**: all workspaces the user has access to (owned or member). These are **links** since the user may not own them (could be admin, editor, viewer, commenter on shared workspaces).
  - **Todo cards**: a minimal automatic todo list, populated when actions are requested by others (agents, comment system, workflow events). This is the user's **personal inbox** for cross-workspace action items.
  - **Other object cards**: any cross-cutting objects relevant to the user (notifications, recent activity, etc.).
- **Todo automation**: when an agent or the comment system creates an action item targeting this user (e.g., "review this use case", "approve this bid"), a todo is automatically created in the neutral workspace.
- **Task dispatch agent**: an agent in the neutral workspace can propose dispatching plans:
  - Given a set of incoming action items, propose a plan with multiple todos, or separate individual todos.
  - The user can accept, modify, or reject the dispatch proposal.
  - Dispatch can target any workspace the user has access to.

### 2. Workspace Type Taxonomy (initial)
| Type Key | Domain | Core Entity | Org Alignment | Status |
|---|---|---|---|---|
| `neutral` | Orchestration | — (todos, workspace links) | — | **BR-04 target** |
| `ai-ideas` | AI Ideation | `initiative` (use_case table) | `organization` | **Existing (current app)** |
| `opportunity` | Opportunity/Bid Management | `initiative` (use_case table, different fields) | `organization` (same alignment) | **BR-04 foundation target** |
| `code` | Code Agent | project/repo | — | **Exists via BR-05 VSCode** |

### 3. Core Object Model — "Initiative" as Universal Business Object (user feedback round 3)

#### 3.1 Rationale: use_case → initiative (semantic evolution)
The `use_case` table is reused as the universal business object across workspace types. The **workspace type** determines the object's personality (fields, display name, matrix axes, maturity gates). We propose the semantic name **"initiative"** as the neutral term that encompasses:
- A use case (in ai-ideas context)
- An opportunity (in opportunity/bid context)
- A project (in implementation context)
- A portfolio item (in service company context)

The database table remains `use_cases` for backward compatibility, but the UI and API use the workspace-type-specific display name configured in the template catalog.

#### 3.2 Object personality per workspace type
Each workspace type customizes:
- **Display name**: "Use Case" (ai-ideas), "Opportunity" (opportunity), "Project" (code)
- **Fields exposed**: different JSONB `data` fields are relevant per type
- **Matrix axes labels**: value/complexity axes have type-specific labels
  - ai-ideas: value = "Business Value", complexity = "Technical Complexity"
  - opportunity: value = "Revenue Potential", complexity = "Sales Complexity" (axes like: existing client, contract size, competition intensity, etc.)
- **Maturity gates**: type-specific gate definitions (see §3.4)

#### 3.3 Maturity as a gating system with lineage (user feedback round 3)

**Core principle**: maturity is a **workflow-driven gating system**, free-form by default but formalizable as a gate sequence (like Airbus G2/G5/G7 gates).

**Lineage model**: when an initiative passes from one maturity stage to the next gate, it creates a **new initiative** with an `antecedent_id` pointing to the previous stage. This preserves the history and allows different fields/artifacts per stage.

Example flow (Airbus-style):
```
[Ideation] G0 → [Evaluation] G1 → [Feasibility/HLD] G2 → [Project Launch] G3 → [Design] G4 → [Build] G5 → [Test] G6 → [Deploy] G7
```

Each gate transition:
1. Creates a new initiative record with `antecedent_id = previous_initiative_id`
2. The new initiative has maturity-stage-specific fields
3. The previous initiative is marked with `gate_status = 'passed'`
4. Gate passage can be free-form (user clicks "advance") or guardrail-enforced (requires approvals, artifact completion, etc.)

**Configurability**: the gate sequence is defined per workspace type in the template catalog. Users can customize the gate labels, sequence, and enforcement level (free / soft-gate / hard-gate).

#### 3.4 Extended object taxonomy (user feedback round 3)

Beyond the core `initiative` (use_case), the full domain model needs these related objects:

| Object | Table Strategy | Description |
|---|---|---|
| **Initiative** | `use_cases` (existing) | Universal business object: use case, opportunity, project. Has `antecedent_id` for maturity lineage. |
| **Organization** | `organizations` (existing) | Client/company context. Shared across workspace types. |
| **Folder** | `folders` (existing) | Container/grouping. Has matrix config. Workspace-scoped. |
| **Matrix** | `folders.matrix_config` (existing JSONB) | Scoring axes. Labels/orientation customized per workspace type. |
| **Solution** | NEW concept (JSONB in initiative or separate entity) | A **realization scenario** for an initiative, potentially involving products. An initiative can have multiple solution options. |
| **Product** | NEW concept (reference entity) | A reusable component/tool/service that can be leveraged in solutions. An initiative is NOT a product, but may consume products and may deliver a product. |
| **Portfolio** | NEW concept (view/collection) | Reference of realized (or in-progress) initiatives for a service company. Essentially a filtered/curated view of initiatives at certain maturity stages. |
| **Bid/Devis** | NEW concept (artifact-like entity or initiative subtype) | A formal commercial proposal. Could be modeled as a typed artifact attached to an initiative at a specific maturity gate, or as a specialized initiative subtype. |

**Recommended approach for BR-04**:
- **Initiative**: extend `use_cases` with `antecedent_id`, `maturity_stage`, `gate_status` columns.
- **Solution**: model as JSONB array within initiative `data` for v1 (promote to separate table later if needed).
- **Product**: model as a lightweight reference entity (new table `products`: id, workspace_id, name, description, data JSONB). Low-cost to add.
- **Portfolio**: model as a view/filter on initiatives (no new table — just a UI/API query with maturity stage filters). Could be a folder subtype or a dedicated route.
- **Bid/Devis**: model as a typed artifact attached to an initiative (leverage existing DOCX generation + a `bid_artifacts` metadata table or JSONB in initiative data).

### 4. Template-Driven Artifact Production

#### 4.1 Existing templates
Two templates already exist for ai-ideas:
- `usecase-onepage.docx` — use case card
- `executive-synthesis.docx` — executive summary with annexed use cases

#### 4.2 AI template generation agent (user feedback round 4)
Two modes of template-driven document production:

**Mode A — Template factory agent**: given a prompt and source objects, generates a reusable template (DOCX/PPTX) that can then produce documents from objects and series of objects.
- Example: the executive synthesis template becomes a generation. The rendering engine is generic; the prompt controls the rendering format.
- User can provide inputs to frame the visual charter (branding, colors, layout preferences).
- Output: a `.docx` or `.pptx` template file with markers, ready for the rendering engine.

**Mode B — Ad-hoc document generation tool**: usable as a chat tool at any moment in any conversation.
- Generates a DOCX or PPTX on-the-fly from the objects available in the current conversation context.
- No template required — the agent produces the document directly.
- Useful for quick exports, one-off reports, meeting decks.

#### 4.3 Template families per maturity stage
- `evaluation-plan.docx` — workload estimation
- `hld-dossier.docx` — high-level design with options/solutions
- `architecture-dossier.docx` — detailed architecture
- `bid-evaluation.docx`, `bid-architecture.docx`, `bid-implementation.docx` — bid documents
- `executive-synthesis.docx` — existing
- `usecase-onepage.docx` — existing
- `opportunity-card.docx` — opportunity one-pager (opportunity workspace)
- `portfolio-summary.docx` — portfolio overview (service company context)

### 5. Agent Configuration per Workspace Type
- Each workspace type ships with **default agent definitions** (leveraging BR-03 `agent_definitions` + `workflow_definitions`).
- Neutral workspace agents: cross-workspace orchestrator, workspace factory, task dispatch agent.
- AI-Ideas agents: use case generator, matrix evaluator, executive summary writer, document renderer.
- Opportunity agents: opportunity qualifier, bid generator, HLD writer, solution architect.
- Code agents: existing local tools (bash, file_read, file_edit, git, rg).
- Users can **fork/detach** agent configs per workspace (BR-03 fork/detach mechanism).

---

## Delivery Scope for BR-04 (revised — budget extended to ~400 commits, segmented by UAT checkpoints)

### Constraints (updated)
- Rebase on current main (post BR-03 + BR-05).
- One migration max in `api/drizzle/*.sql` (must consolidate all schema changes into one file).
- Budget: up to ~400 commits, segmented into UAT checkpoints every ~100 commits.
- Must not break existing `ai-ideas` workspace behavior (backward-compatible).
- Neutral workspace is non-delegable (cannot be shared/transferred).
- **Lot 0 exit gate**: all evolution specs must be 100% framed, including impacts on future branches.

### Segment A — Foundation (~100 commits, UAT checkpoint)

#### Lot 0 — Baseline, rebase & spec framework
- [ ] Create branch from current `main`
- [ ] Cherry-pick useful code from old BR-04 (catalog service, projection, tests)
- [ ] **Target data model design** (stable, covering all segments): initiative lifecycle, maturity gates, solution, product, portfolio, bid/artifact model
- [ ] **Spec evolution documents** (100% framed): update `spec/SPEC.md`, create `spec/SPEC_EVOL_WORKSPACE_TYPES.md` with full domain model, gate system, object taxonomy, template catalog, agent catalog
- [ ] **Impact analysis on future branches** (BR-06 through BR-13): document which branches are affected and how
- [ ] Gate: spec review sign-off

#### Lot 1 — Schema & workspace type system
- [ ] Migration: `workspaces.type` TEXT NOT NULL DEFAULT `'ai-ideas'`
- [ ] Migration: `use_cases.antecedent_id` TEXT nullable FK self-ref
- [ ] Migration: `use_cases.maturity_stage` TEXT DEFAULT `'ideation'`
- [ ] Migration: `use_cases.gate_status` TEXT DEFAULT `'active'`
- [ ] Migration: `products` table (id, workspace_id, name, description, data JSONB)
- [ ] Extend `WORKSPACE_TEMPLATE_CATALOG` with 4 types + capabilities + gate definitions
- [ ] API: extend `POST /workspaces` to accept `type`
- [ ] API: workspace type in GET responses, replace `isCodeWorkspace` with `type`
- [ ] Backward compat: all existing workspaces default to `ai-ideas`
- [ ] Tests
- [ ] Gate: typecheck + lint + test-api

#### Lot 2 — Neutral workspace & cross-workspace
- [ ] Auto-creation of neutral workspace on login (if not exists)
- [ ] Neutral workspace as default landing
- [ ] Card-based dashboard view (workspace cards as links, todo cards)
- [ ] Auto-todo creation from cross-workspace events (comments, agent requests)
- [ ] Cross-workspace tools: `workspace_list`, `workspace_switch`, `workspace_create`
- [ ] Task dispatch agent (propose plans from incoming action items)
- [ ] Tool gating by workspace type
- [ ] Tests
- [ ] Gate: typecheck + lint + test-api + test-ui

#### Lot 3 — Initiative personality & maturity foundation
- [ ] Initiative display name per workspace type (UI config from template catalog)
- [ ] Matrix axes labels per workspace type
- [ ] Maturity stage management API (advance, gate check, lineage creation)
- [ ] Antecedent chain navigation (API + UI)
- [ ] Gate definitions per workspace type (configurable: free / soft / hard)
- [ ] Tests
- [ ] Gate: typecheck + lint + test-api

**→ UAT Checkpoint A** (after ~100 commits)

### Segment B — Opportunity & Domain Depth (~100 commits, UAT checkpoint)

#### Lot 4 — Opportunity workspace
- [ ] Opportunity-specific fields in initiative JSONB data
- [ ] Opportunity-specific matrix axes (revenue potential, sales complexity, etc.)
- [ ] Default agents: opportunity qualifier, solution architect
- [ ] Default workflows: opportunity analysis pipeline
- [ ] Workspace creation from neutral with type `opportunity`
- [ ] Tests
- [ ] Gate

#### Lot 5 — Solution, Product, Portfolio concepts
- [ ] Solution: JSONB array in initiative data (v1), API for CRUD
- [ ] Product: lightweight reference table, API for CRUD
- [ ] Portfolio: filtered view of initiatives by maturity stage, API endpoint
- [ ] Bid: typed artifact metadata on initiative, linked to DOCX generation
- [ ] Tests
- [ ] Gate

#### Lot 6 — Maturity gate workflow
- [ ] Gate transition engine (create new initiative with antecedent, copy relevant data)
- [ ] Gate enforcement modes (free / soft-gate with warnings / hard-gate with blockers)
- [ ] Guardrail integration (BR-03 guardrails for gate passage)
- [ ] UI: maturity timeline/progress view on initiative detail
- [ ] Tests
- [ ] Gate

**→ UAT Checkpoint B** (after ~200 commits)

### Segment C — Template & Document Generation (~100 commits, UAT checkpoint)

#### Lot 7 — Template catalog per workspace type + maturity
- [ ] Extend template registry: workspace type → maturity stage → template list
- [ ] New templates: opportunity-card, evaluation-plan, hld-dossier, bid-proposal
- [ ] Template marker contracts for new template families
- [ ] Tests
- [ ] Gate

#### Lot 8 — AI template factory agent (Mode A)
- [ ] Chat tool: `template_create` — generate a reusable DOCX/PPTX template from prompt + source objects
- [ ] Charter/branding input support
- [ ] Generic rendering engine (template + objects → document)
- [ ] Tests
- [ ] Gate

#### Lot 9 — Ad-hoc document generation tool (Mode B)
- [ ] Chat tool: `document_generate` — produce DOCX/PPTX on-the-fly from conversation context
- [ ] PPTX rendering foundation (extend docx-service or new pptx-service)
- [ ] Tests
- [ ] Gate

**→ UAT Checkpoint C** (after ~300 commits)

### Segment D — Polish, Integration & Closure (~100 commits)

#### Lot 10 — UI workspace management polish
- [ ] Workspace type selector in creation dialog (with type descriptions, icons)
- [ ] Workspace type badge in workspace list
- [ ] Neutral dashboard: refined card layout, activity feed
- [ ] Settings: display type + capabilities + gate config
- [ ] Tests
- [ ] Gate

#### Lot 11 — Cross-cutting integration
- [ ] Replace all `isCodeWorkspace` usage with `workspace.type === 'code'`
- [ ] ChatPanel tool filtering by workspace type
- [ ] E2E tests covering multi-workspace flows
- [ ] Non-regression on existing ai-ideas flows
- [ ] Tests
- [ ] Gate

#### Lot N-2 — UAT final
- [ ] UAT-01: neutral workspace auto-creation + landing
- [ ] UAT-02: create workspace of each type from neutral
- [ ] UAT-03: initiative maturity gate passage with lineage
- [ ] UAT-04: opportunity workspace with specific fields/matrix
- [ ] UAT-05: template-driven document generation
- [ ] UAT-06: ad-hoc document generation from chat
- [ ] UAT-07: non-regression ai-ideas

#### Lot N-1 — Docs consolidation
- [ ] Consolidate in `spec/SPEC.md`, `spec/DATA_MODEL.md`, `spec/SPEC_TEMPLATING.md`
- [ ] Update `PLAN.md`, `TODO.md`
- [ ] Impact documentation on downstream branches

#### Lot N — Final validation
- [ ] Full gates: typecheck, lint, test-api, test-ui, test-e2e
- [ ] PR + CI

**→ UAT Checkpoint D / Final** (after ~400 commits)

---

## Open Questions (status updated)

| ID | Question | Status | Decision |
|---|---|---|---|
| OQ-1 | Reuse `use_cases` for opportunity? | **CLOSED** | Yes. `use_cases` is the universal initiative table. Workspace type determines personality. |
| OQ-2 | Neutral workspace discovery of other workspaces? | Open | Likely registry-based (workspace cards in neutral dashboard). |
| OQ-3 | PPTX engine: extend docx-service or separate? | Open | TBD in Lot 9 design. |
| OQ-4 | Maturity transitions: free or gated? | **CLOSED** | Both. Free by default, configurable as soft/hard gates per workspace type. |
| OQ-5 | Template AI assistant: tool or UI? | **CLOSED** | Both. Mode A (template factory) + Mode B (ad-hoc generation tool in chat). |
| OQ-6 | Object naming: "initiative" as universal term? | Open | Proposed. Alternatives: "item", "case", "engagement". Need user validation. |
| OQ-7 | Solution as separate table or JSONB? | Open | v1: JSONB in initiative data. Promote to table if needed. |
| OQ-8 | Bid/Devis: artifact or entity? | Open | v1: typed artifact metadata on initiative. Could evolve to entity. |
| OQ-9 | Gate sequence configurability: per workspace type only or per folder? | Open | Recommend per workspace type with folder-level override possible. |

---

## Impact Analysis on Existing Branches (to be detailed in Lot 0)

| Branch | Impact | Nature |
|---|---|---|
| BR-06 chrome-upstream-v1 | Low | No workspace type dependency |
| BR-07 release-ui-npm-and-pretest | None | Build/CI only |
| BR-08 model-runtime-claude-mistral | Low | Provider abstraction is workspace-agnostic |
| BR-09 sso-google | Low | Auth is workspace-agnostic |
| BR-10 vscode-plugin-v2 | **Medium** | Must respect workspace type for tool gating, code workspace specifics |
| BR-11 chrome-multitab-voice | Low-Medium | Tool gating awareness |
| BR-12 release-chrome-vscode-ci | None | CI/CD only |
| BR-13 chrome-plugin-download | None | Already done |

---

## Target Data Model Overview (to be stabilized in Lot 0)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WORKSPACE LAYER                              │
│  workspace (type: neutral|ai-ideas|opportunity|code)                │
│  workspace_membership (role: admin|editor|commenter|viewer)         │
│  workspace_template_catalog (capabilities, gates, agents, workflows)│
└────────┬────────────────────────────────────────────────────────────┘
         │
┌────────┴────────────────────────────────────────────────────────────┐
│                     BUSINESS OBJECT LAYER                           │
│  organization ──── folder ──── initiative (use_cases table)         │
│                     │              │  antecedent_id (lineage)       │
│                     │              │  maturity_stage                │
│                     │              │  gate_status                   │
│                     │              ├── solution[] (JSONB v1)        │
│                     │              └── bid/artifact metadata        │
│                     └── matrix_config (axes per workspace type)     │
│  product (reference entity, cross-workspace)                        │
│  portfolio (view: initiatives at mature stages)                     │
└────────┬────────────────────────────────────────────────────────────┘
         │
┌────────┴────────────────────────────────────────────────────────────┐
│                     ORCHESTRATION LAYER (BR-03)                     │
│  plan ── todo ── task (with maturity gate integration)              │
│  agent_definition (per workspace type defaults)                     │
│  workflow_definition (per workspace type defaults)                  │
│  execution_run / execution_event                                    │
│  guardrail (gate enforcement)                                       │
└────────┬────────────────────────────────────────────────────────────┘
         │
┌────────┴────────────────────────────────────────────────────────────┐
│                     TEMPLATE & RENDERING LAYER                      │
│  template_catalog (per workspace type × maturity stage)             │
│  docx-service / pptx-service (generic rendering engine)             │
│  template_create tool (Mode A: factory)                             │
│  document_generate tool (Mode B: ad-hoc)                            │
└────────┬────────────────────────────────────────────────────────────┘
         │
┌────────┴────────────────────────────────────────────────────────────┐
│                     CHAT & TOOL LAYER                                │
│  chat_session (workspace-scoped)                                    │
│  tools (gated by workspace type capabilities)                       │
│  cross-workspace tools (neutral only)                               │
│  checkpoint / summary (BR-05)                                       │
└─────────────────────────────────────────────────────────────────────┘
```
