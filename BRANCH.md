# Feature: LLM Mesh Account Transports Plan

## Objective
Create the durable specification and branch plan for BR-44 account transports.

## Scope / Guardrails
- Scope limited to planning documentation.
- No application, package, migration, or UI implementation in this branch.
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/chore-llm-mesh-account-transports-plan`.
- Automated test campaigns are not required for docs-only changes.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md`
  - `plan/44-BRANCH_feat-llm-mesh-account-transports.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql`
  - `spec/SPEC_EVOL_LLM_MESH.md`
  - `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`
- **Exception process**:
  - Declare exception ID `BR44-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- `acknowledge` BR44-A1: GPT-5.5 xhigh adversarial review completed before this plan branch; findings integrated into the spec: atomic coordinator, short DB locks, reservations, compatibility API migration, and safety gates.

## AI Flaky tests
- Acceptance rule:
  - No AI flaky test acceptance is expected for this docs-only branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: docs-only planning branch with no implementation sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: no UAT is required because this branch only adds planning docs.

## Plan / Todo (lot-based)
- [x] **Lot 0 - Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `harness/plan`, and the branch template.
  - [x] Create isolated worktree `tmp/chore-llm-mesh-account-transports-plan`.
  - [x] Validate branch mechanically with `harness check branch`.
  - [x] Confirm scope is docs-only.

- [x] **Lot 1 - Durable spec and plan**
  - [x] Add `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md`.
  - [x] Add `plan/44-BRANCH_feat-llm-mesh-account-transports.md`.
  - [x] Capture challenger review outcomes in the spec decisions.
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-chore-llm-mesh-account-transports-plan`
    - [x] `git diff --check`

- [ ] **Lot 2 - Final validation and merge**
  - [x] Review diff for docs-only scope.
  - [ ] Commit docs with selective staging.
  - [ ] Push branch.
  - [ ] Remove `BRANCH.md` before merge-ready state.
  - [ ] Merge to `main`.
