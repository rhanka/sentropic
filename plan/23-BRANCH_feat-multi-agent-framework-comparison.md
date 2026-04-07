# Feature: BR-23 — Multi-Agent Framework Comparison

## Objective
Compare LangGraph, Agno, and Temporal for multi-agent orchestration. Produce a recommendation and plan the runtime extensions needed to implement it.

## Scope / Guardrails
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-multi-agent-framework-comparison`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/**`
  - `plan/23-BRANCH_feat-multi-agent-framework-comparison.md`
  - `api/src/services/queue-manager.ts`
  - `api/src/services/workflow-*.ts`
  - `api/src/config/default-workflows.ts`
  - `api/tests/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BR23-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single research + implementation branch.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on integrated branch only.
- Execution flow:
  - Develop and run tests in `tmp/feat-multi-agent-framework-comparison`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-multi-agent-framework-comparison` after UAT.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Research & comparison**
  - [ ] Read current workflow runtime: `spec/SPEC_WORKFLOW_RUNTIME.md`, `api/src/services/queue-manager.ts`, `api/src/config/default-workflows.ts`
  - [ ] Research LangGraph: architecture, graph primitives, state management, human-in-the-loop, persistence, pricing/licensing
  - [ ] Research Agno: architecture, agent primitives, tool integration, multi-agent coordination, pricing/licensing
  - [ ] Research Temporal: workflow engine, activity workers, durability, replay, versioning, pricing/licensing
  - [ ] Produce comparison matrix: feature coverage, complexity, migration cost from current runtime, operational overhead, vendor lock-in
  - [ ] Plan the following runtime extensions in the context of each framework:
    - [ ] Generic runtime message / interrupt / resume API exposed to product/UI surfaces
    - [ ] Generic child/sub-workflow execution across arbitrary workflow families
    - [ ] Advanced reducers / reusable join strategies beyond the needs of current workflows
    - [ ] Compensation / saga patterns and broader workflow-version migration concerns
  - [ ] Produce recommendation with rationale

- [ ] **Lot N — Final validation**
  - [ ] Review spec/recommendation for completeness
  - [ ] Create/update PR using `BRANCH.md` text as PR body
  - [ ] Run/verify branch CI on PR
  - [ ] Once CI OK, commit removal of `BRANCH.md`, push, merge
