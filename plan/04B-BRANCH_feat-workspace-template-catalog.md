# Feature: BR-04B — Workspace Template Catalog (continuation)

## Objective
Continuation of BR-04. Covers usecase→initiative data migration, multi-org workflow adaptation, view template system, extended object views, document generation, dashboard, and final polish.

## Baseline
Branch off BR-04 after UAT Checkpoint B' validation.

---

#### Lot 1 — Complete usecase → initiative rename (code + data migration)

**Tasks:**
- [ ] Migration 0024: `UPDATE chat_contexts SET context_type = 'initiative' WHERE context_type = 'usecase'` and `UPDATE chat_sessions SET primary_context_type = 'initiative' WHERE primary_context_type = 'usecase'`. Also update `comments`, `context_documents`, `context_modification_history`, `object_locks`.
- [ ] Execute UPDATE on dev DB directly (migration already applied).
- [ ] Grep/replace `'usecase'` → `'initiative'` in all API code.
- [ ] Grep/replace `usecase` → `initiative` in all UI code (~490 occurrences).
- [ ] Remove temporary `'usecase'` acceptance in `chat-service.ts`.
- [ ] **Zero-legacy verification**: `grep -rn "'usecase'" api/src/ ui/src/ | grep -v locales | grep -v .test. | grep -v node_modules | grep -v "\.css"` returns 0 results.

**Gate:**
- [ ] `make typecheck-api`
- [ ] `make typecheck-ui`
- [ ] `make lint-api`
- [ ] `make test-api`

---

#### Lot 2 — Multi-org workflow adaptation + UI (B, B')

**Tasks:**
- [ ] B: Workflow adaptation — reorder `opportunity_identification` workflow: `opportunity_list` produces **pairs (initiative, organisation)** first, then `create_organizations` creates missing orgs (dedup), then `opportunity_detail` generates each initiative linked to its org(s). See SPEC_VOL §B.
- [ ] B: UI multi-select — replace single-select organisation in folder creation form with multi-select.
- [ ] B': UI batch org prompt — dedicated prompt surface or chat tool to trigger batch organisation creation.

**Gate:**
- [ ] `make typecheck-api`
- [ ] `make typecheck-ui`
- [ ] `make test-api SCOPE=api/generic-dispatch`

---

### Segment C — View templates, container refactoring, workflow launch, template catalog

#### Lot 3 — View template API & seed data

**Tasks:**
- [ ] Implement view template CRUD API (list, get, update, fork, detach).
- [ ] Implement view template resolution service: `(workspace_type, object_type, maturity_stage?)` → descriptor.
- [ ] Create seed view template descriptors for all workspace types × object types.
- [ ] Seed view templates on workspace creation.
- [ ] Tests: CRUD, resolution, fork/detach, seed on workspace creation.

**Gate:**
- [ ] `make typecheck-api`
- [ ] `make lint-api`
- [ ] `make test-api`

---

#### Lot 4 — ViewTemplateRenderer & container view refactoring

**Tasks:**
- [ ] Implement widget renderer components for all widget types.
- [ ] Implement tab layout renderer.
- [ ] Refactor folder detail page → `ViewTemplateRenderer` with container `object_type`.
- [ ] Refactor workspace root page → container view.
- [ ] Refactor neutral landing → container view from API view template.
- [ ] Tests: widget rendering, container view at all levels.

**Gate:**
- [ ] `make typecheck-ui`
- [ ] `make lint-ui`
- [ ] `make test-ui`

---

#### Lot 5 — Initiative detail view-template-driven + extended object views

**Tasks:**
- [ ] Refactor initiative detail to use `ViewTemplateRenderer` — resolve template per workspace type.
- [ ] Implement solution editor (view-template-driven CRUD).
- [ ] Implement product editor (view-template-driven CRUD).
- [ ] Implement bid editor (view-template-driven CRUD with tabs: clauses/products/pricing).
- [ ] Implement `PricingGridWidget` and `ClauseEditorWidget` for bid views.
- [ ] Implement `ChildListWidget` for embedded solution/product/bid lists in initiative detail.
- [ ] Tests: view rendering per workspace type, CRUD operations.

**Gate:**
- [ ] `make typecheck-ui`
- [ ] `make lint-ui`
- [ ] `make test-ui`

---

#### Lot 6 — Workflow launch templatizing & template catalog

**Tasks:**
- [ ] Refactor `/home` page to use `ViewTemplateRenderer` with `workflow_launch` object type.
- [ ] Implement `WorkflowPickerWidget` — lists registered workflows for current workspace type.
- [ ] Seed workflow launch templates per workspace type.
- [ ] Template catalog UI in settings (per workspace type).
- [ ] Tests: workflow launch per workspace type, template catalog display.

**Gate:**
- [ ] `make typecheck-api`
- [ ] `make typecheck-ui`
- [ ] `make lint-api`
- [ ] `make lint-ui`
- [ ] `make test-api`
- [ ] `make test-ui`
- [ ] `make test-e2e`

---

#### UAT Checkpoint C

- [ ] **Web app**
  - [ ] Neutral landing → container view with workspace cards.
  - [ ] Workspace root → container view with folders.
  - [ ] Folder → container view with initiatives.
  - [ ] `ai-ideas` initiative detail → vertical layout.
  - [ ] `opportunity` initiative detail → tabs (Overview / Pipeline / Lineage).
  - [ ] Pipeline tab → embedded lists of solutions, bids, products.
  - [ ] Solution/product/bid editors → view-template-driven CRUD.
  - [ ] Bid editor → tabs (Clauses / Products / Pricing).
  - [ ] `/home` → workflow launch form driven by workspace type.
  - [ ] Settings → view template catalog per workspace type.
  - [ ] Non-regression: `ai-ideas` generation workflow still works end-to-end.
- [ ] **Chrome plugin**
  - [ ] Chat renders correctly with workspace-type-aware context.
- [ ] **VSCode plugin**
  - [ ] Plugin context references updated.

---

### Segment D — Document generation, dashboard, polish, E2E, final validation

#### Lot 7 — Document generation (Mode A + Mode B)

**Tasks:**
- [ ] Implement new DOCX template families per workspace type × maturity stage.
- [ ] Implement `document_generate` chat tool (ad-hoc generation from chat context).
- [ ] Integrate document generation tasks in opportunity workflow (Mode A).
- [ ] Tests: template rendering for new object types, chat tool generation.

**Gate:**
- [ ] `make typecheck-api`
- [ ] `make lint-api`
- [ ] `make test-api`

---

#### Lot 8 — Dashboard per workspace type & neutral todo automation

**Tasks:**
- [ ] Implement per-workspace-type dashboard views.
- [ ] Extend analytics API for opportunity pipeline metrics.
- [ ] Implement neutral todo automation: event listener on `execution_events` → auto-create todos in neutral workspace.
- [ ] Tests: dashboard rendering per type, todo automation events.

**Gate:**
- [ ] `make typecheck-api`
- [ ] `make typecheck-ui`
- [ ] `make lint-api`
- [ ] `make lint-ui`
- [ ] `make test-api`
- [ ] `make test-ui`

---

#### Lot 9 — E2E tests & cross-cutting polish

**Tasks:**
- [ ] Write E2E scenarios for all new surfaces.
- [ ] Update existing E2E tests for initiative rename.
- [ ] Cross-cutting polish: navigation breadcrumbs, error states, loading states, empty states.
- [ ] Accessibility pass on new views.
- [ ] Performance check: view template resolution, container view rendering.

**Gate:**
- [ ] Full typecheck + lint + test + E2E

---

#### UAT Checkpoint D (Final)

- [ ] **Web app**
  - [ ] Full scenario: register → neutral landing → create opportunity workspace → create folder → generate initiatives → advance gates → create solution → create products → create bid → finalize → generate documents.
  - [ ] Full scenario: create ai-ideas workspace → generate initiatives → view in container → detail → dashboard → export DOCX.
  - [ ] Neutral workspace: workspace cards, activity feed, auto-generated todos from gate events.
  - [ ] Container view at all levels.
  - [ ] View template rendering per workspace type.
  - [ ] Workflow launch per workspace type.
  - [ ] Chat tools per workspace type.
  - [ ] Settings: workflow registry, view template management.
  - [ ] Non-regression: all existing functionality.
- [ ] **Chrome plugin**
  - [ ] Chat with workspace-type-aware tool scoping.
  - [ ] Context references use `initiative` (not `usecase`).
- [ ] **VSCode plugin**
  - [ ] Connection and tool execution with renamed endpoints.

---

#### Docs consolidation

- [ ] Consolidate `spec/SPEC_EVOL_WORKSPACE_TYPES.md` into canonical specs.
- [ ] Update `PLAN.md` and `TODO.md`.

---

#### Final validation

- [ ] Re-run full branch gates.
- [ ] Verify CI status.
- [ ] User sign-off on final UAT.
- [ ] Merge to main.
