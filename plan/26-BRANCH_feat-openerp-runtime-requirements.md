# Feat: BR-26 — OpenERP Runtime Requirements

## Objective

Specify and stage the 6 runtime capabilities required by the OpenERP project (`github.com/rhanka/openerp`) from `@sentropic`. OpenERP arbitrated its MVP decision pack on 2026-05-14 and identified `@sentropic` as its agent runtime base. The capabilities listed here are functional contracts; implementation is staged for a follow-up branch after spec validation.

## Scope / Guardrails

- Spec branch only. No runtime code in this branch.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`). Branch work in isolated worktree `tmp/feat-openerp-runtime-requirements`.
- All new text in English (spec convention) with cross-references to French source decision-pack OpenERP.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `plan/26-BRANCH_feat-openerp-runtime-requirements.md`
  - `spec/SPEC_OPENERP_REQUIREMENTS.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `e2e/**`
  - `rules/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - other `spec/**` files
- **Exception process**:
  - Declare exception ID `BR26-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop

## AI Flaky tests

- N/A (docs-only)

## Orchestration Mode (AI-selected)

- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: docs-only spec scaffolding, no CI dependency.

## UAT Management (in orchestration context)

- **Mono-branch**: UAT on integrated branch only.
- N/A — no user-facing changes.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `PLAN.md`
  - [ ] Read OpenERP decision-pack: `~/src/openerp/docs/study/10-mvp-specs/decision-pack.md`
  - [ ] Read OpenERP agentic spec: `~/src/openerp/docs/study/10-mvp-specs/agentic-impacts.md`
  - [ ] Read OpenERP shared-entities canon: `~/src/openerp/docs/study/10-mvp-specs/shared-entities-v1.md`
  - [ ] Confirm BR-26 free and queue position relative to BR-23/24/25 and BR-14c

- [ ] **Lot 1 — Requirements spec**
  - [ ] Author `spec/SPEC_OPENERP_REQUIREMENTS.md` with 6 capability sections (MCP client+server, OTel hooks, Policy hooks, Multi-tenant identity primitives, Marketplace publication primitives, Sandbox API + capability manifest)
  - [ ] Cross-reference each capability to the OpenERP decision pack entry that motivates it (PG-06, PG-07, PG-09, AGT-D-01, AGT-D-04, etc.)
  - [ ] Lot gate: spec self-review (placeholder scan, internal consistency, ambiguity check)

- [ ] **Lot 2 — Validation handoff**
  - [ ] Open PR against `main` with spec + plan
  - [ ] Tag the PR for handoff to follow-up implementation branches (per capability or grouped)
  - [ ] Lot gate: PR CI green

- [ ] **Lot N — Final validation**
  - [ ] Review spec for consistency and no contradictions with `PLAN.md` orchestration order
  - [ ] Once approved, capabilities split into implementation branches: candidates `BR-27` (MCP), `BR-28` (OTel + policy hooks), `BR-29` (multi-tenant identity), `BR-30` (marketplace + sandbox API). Exact split decided in follow-up scoping.

## Dependencies

- BR-14c (LLM Mesh SDK) — must land first; capabilities here build above the mesh contract.
- No blocking on BR-23/24/25.

## Exit criteria

- `spec/SPEC_OPENERP_REQUIREMENTS.md` reviewed and merged on `main`.
- Implementation branches scoped in follow-up `PLAN.md` update.
- OpenERP project linked in cross-references for traceability.

## Cross-references

- OpenERP decision pack: `~/src/openerp/docs/study/10-mvp-specs/decision-pack.md`
- OpenERP shared entities canon: `~/src/openerp/docs/study/10-mvp-specs/shared-entities-v1.md`
- OpenERP agentic impacts: `~/src/openerp/docs/study/10-mvp-specs/agentic-impacts.md`
- `@sentropic` PLAN: `PLAN.md` §3 branch catalog
