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
- [ ] **Bug 2** — ZodError `objectType: "usecase"` in initiative lock/presence. UI sends `'usecase'` but API enum expects `'initiative'` (BR-08 rename). Fix: replace `'usecase'` with `'initiative'` in `ui/src/lib/utils/object-lock.ts`, `ui/src/lib/utils/comments.ts`, `ui/src/lib/utils/documents.ts`, `ui/src/routes/initiative/[id]/+page.svelte` lock/presence calls.
- [ ] **Bug 3** — Missing folder action menu ("+") in neutral workspace view. Add standard folder menu to `/neutral` page replacing "Nouveau workspace" button position.
- [ ] **Bug 4** — "Nouveau workspace" redirects to `/settings` instead of opening creation modal directly. Fix: open workspace creation modal inline or via query param.
- [ ] **Bug 5** — Sortable columns in neutral view: remove tri/sorting from neutral page (inconsistent with other list views). Deferred to BR-18 for global implementation.
- [ ] **Bug 6** — Initiative count always 0 in neutral workspace cards. Fix: correct the `GET /neutral/dashboard` SQL/query to count initiatives per workspace.
