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
- BR04-D1 (to freeze in Lot 0): `steer` = in-flight user guidance to an active run (not governance/approval mode).
- BR04-D2 (to freeze in Lot 0): split `todo_tool` (assistant-executable) vs `todo_user` (conductor/user-managed tasks).
- BR04-D3 (to freeze in Lot 0): workflow = stage-based agent orchestration (not settings-panel CRUD).
- AWT-Q3 (to freeze in Lot 0): migration semantics when workspace template changes with existing artifacts.
- AWT-Q4 (to freeze in Lot 0): fallback semantics when assigned template is disabled/unavailable.
- OQ-1 (closed): reuse `use_cases` table for all initiative types. Workspace type determines personality.
- OQ-6 (to freeze in Lot 0): "initiative" as universal object name? Alternatives: "item", "case", "engagement".
- OQ-7 (to freeze in Lot 0): solution as JSONB v1 or separate table?
- OQ-8 (to freeze in Lot 0): bid/devis as artifact or entity?
- OQ-9 (to freeze in Lot 0): gate sequence configurability — per workspace type only or also per folder?

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

- [ ] **0.1 Baseline setup**
  - [ ] Confirm branch `feat/workspace-template-catalog` created from `main` (post BR-03 + BR-05).
  - [ ] Resolve worktree cleanup (`tmp/feat-workspace-template-catalog` needs sudo for Docker-owned files).
  - [ ] Commit demand document (`plan/04-BRANCH-EVOL-DEMAND.md`) and this `BRANCH.md`.
  - [ ] Cherry-pick useful code from old BR-04 branch (catalog service pattern, projection logic, test patterns). Evaluate via diff analysis — only cherry-pick if rebase is cleaner than rewrite.
  - [ ] Confirm environment mapping: `ENV=feat-workspace-template-catalog`, ports 8704/5104/1004.

- [ ] **0.2 Freeze open decisions**
  - [ ] BR04-D1: confirm `steer` = in-flight guidance (not governance). Document in spec.
  - [ ] BR04-D2: confirm `todo_tool` vs `todo_user` split semantics. Document in spec.
  - [ ] BR04-D3: confirm workflow = stage-based agent orchestration. Document in spec.
  - [ ] AWT-Q3: define migration semantics (initiative keeps original template; new template applies to new initiatives only). Document in spec.
  - [ ] AWT-Q4: define fallback (default to `ai-ideas` template if assigned template is disabled). Document in spec.
  - [ ] OQ-6: freeze universal object name ("initiative" vs alternatives). Document in spec.
  - [ ] OQ-7: freeze solution model (JSONB v1 with promotion path). Document in spec.
  - [ ] OQ-8: freeze bid/devis model (typed artifact on initiative v1). Document in spec.
  - [ ] OQ-9: freeze gate configurability (per workspace type, with folder-level override possible). Document in spec.

- [ ] **0.3 Target data model design**
  - [ ] Design stable target data model covering all segments:
    - Workspace layer: `workspaces.type`, template catalog, capability map
    - Business objects: initiative (use_cases) with `antecedent_id`, `maturity_stage`, `gate_status`; solution (JSONB v1); product (table); portfolio (view)
    - Orchestration: agent/workflow defaults per workspace type; gate enforcement via guardrails
    - Template/rendering: template catalog per type × maturity stage; rendering engine abstraction
  - [ ] Produce ERD (Mermaid) for the target model.
  - [ ] Review against existing schema (`api/src/db/schema.ts`) for backward compatibility.
  - [ ] Identify single migration file content (all DDL in one file).

- [ ] **0.4 Spec evolution documents (100% framed)**
  - [ ] Create `spec/SPEC_EVOL_WORKSPACE_TYPES.md` — full spec for workspace type system:
    - Workspace type taxonomy and lifecycle
    - Neutral workspace: auto-creation, landing view, cross-workspace tools, todo automation, task dispatch
    - Initiative object model: personality per type, maturity gates, lineage, fields per stage
    - Extended objects: solution, product, portfolio, bid/artifact
    - Gate system: free / soft-gate / hard-gate, configurable per type
    - Agent catalog per workspace type
    - Template catalog per type × maturity stage
    - Document generation: Mode A (template factory) + Mode B (ad-hoc)
    - API contracts for all new/modified endpoints
    - UI surfaces inventory
  - [ ] Update `spec/SPEC.md` — sections impacted:
    - §1 Functional map: add neutral workspace landing, opportunity screens
    - §2 Data model: add workspace type, initiative maturity, products, solution, portfolio
    - §3 API contracts: add workspace type endpoints, initiative maturity endpoints, product CRUD, template catalog per type
  - [ ] Update `spec/DATA_MODEL.md` — new ERD with all additions.
  - [ ] Update `spec/SPEC_TEMPLATING.md` — template families per workspace type × maturity stage.
  - [ ] Update `spec/TOOLS.md` — new tools (cross-workspace, template_create, document_generate).
  - [ ] Update `spec/SPEC_EVOL_AGENTIC_WORKSPACE_TODO.md` — residual items impacted by neutral workspace todo automation.

- [ ] **0.5 Impact analysis on future branches**
  - [ ] Document impact of BR-04 on each non-done branch (BR-06 through BR-12).
  - [ ] Identify which branches need scope/dependency updates.

- [ ] **0.6 Rewrite branch plans**
  - [ ] Rewrite `plan/04-BRANCH_feat-workspace-template-catalog.md` — align with this BRANCH.md (copy final lot structure).
  - [ ] Rewrite `plan/06-BRANCH_feat-chrome-upstream-v1.md` — add BR-04 dependency awareness.
  - [ ] Rewrite `plan/07-BRANCH_feat-release-ui-npm-and-pretest.md` — verify no BR-04 impact.
  - [ ] Rewrite `plan/08-BRANCH_feat-model-runtime-claude-mistral.md` — verify no BR-04 impact.
  - [ ] Rewrite `plan/09-BRANCH_feat-sso-google.md` — verify no BR-04 impact.
  - [ ] Rewrite `plan/10-BRANCH_feat-vscode-plugin-v2-multi-agent.md` — add BR-04 dependency (workspace type for tool gating).
  - [ ] Rewrite `plan/11-BRANCH_feat-chrome-upstream-multitab-voice.md` — add BR-04 awareness.
  - [ ] Rewrite `plan/12-BRANCH_feat-release-chrome-vscode-ci-publish.md` — verify no BR-04 impact.
  - [ ] Rewrite `PLAN.md` — new timeline, updated dependency graph, BR-04 as structural branch.
  - [ ] Update `TODO.md` — roadmap sync.

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
