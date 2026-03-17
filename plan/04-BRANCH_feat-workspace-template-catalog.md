# Feature: BR-04 — Workspace Type System, Neutral Orchestrator & Multi-Domain Foundation

## Objective
Deliver a typed workspace system (`neutral`, `ai-ideas`, `opportunity`, `code`) with neutral orchestrator workspace, initiative lifecycle with maturity gating and lineage, extended object model (solution, product, bid/contract), multi-workflow registry, template-driven artifact production with AI generation, and cross-workspace orchestration tools.

## Status
Active — Lot 0 in progress (spec framework & decisions). See `BRANCH.md` for live progress tracking.

## Dependencies
- BR-03 (done, merged) — TODO/steering/workflow runtime
- BR-05 (done, merged) — VSCode plugin v1

## Key specs
- `spec/SPEC_EVOL_WORKSPACE_TYPES.md` — full evolution spec (12 sections with fusion trajectory)
- `plan/04-BRANCH-EVOL-DEMAND.md` — evolution demand document

## Scope
See `BRANCH.md` for full scope boundaries, decision log, and lot-based plan.
This file is a pointer — `BRANCH.md` is the authoritative tracking document.

## UAT Bug Fixes (pre Lot N-2)
- [x] **Bug 2** — ZodError `objectType: "usecase"` in initiative lock/presence. Fixed: replaced `'usecase'` with `'initiative'` in all UI API-facing calls.
- [ ] **Bug 3** — Missing folder action menu ("+") in neutral workspace view. Fix: integrate FileMenu into ViewTemplateRenderer, remove duplicate "Nouveau workspace" button.
- [ ] **Bug 4** — "Nouveau workspace" redirects to `/settings` instead of opening creation modal directly. Fix: extract WorkspaceCreateDialog component, open inline.
- [x] **Bug 5** — Sortable columns in neutral view: removed. Deferred to BR-18 for global implementation.
- [x] **Bug 6** — Folder initiative count always 0. Fixed: UI store field renamed from `useCaseCount` to `initiativeCount` to match API rename.
- [ ] **Bug 7** — `startInitiativeGenerationWorkflow` hardcodes `ai_usecase_generation_v1` workflow regardless of workspace type. Fix: resolve workflow by workspace type via `getWorkflowSeedsForType`.
- [ ] **Bug 8** — Cannot delete a workspace from admin settings UI. Investigate cascade FK.
- [ ] **Bug 9** — Workspace cards in neutral view use a new card component instead of the shared card component used for folders/organizations/initiatives. Fix: use the same card component for consistency.
