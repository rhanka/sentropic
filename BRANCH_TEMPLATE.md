# Feature: <Title>

## Objective
<One or two sentences describing the goal.>

## Scope / Guardrails
- Scope limited to <areas>.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- All new text in English.

## Questions / Notes
- <Open questions that affect scope or sequencing.>

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: <Why this mode is selected>

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read the relevant `.mdc` files and `README.md`.
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Confirm scope and guardrails.
  - [ ] If the branch is complex, add `spec/BRANCH_SPEC_EVOL.md` (initial draft).

- [ ] **Lot 1 — <Main change>**
  - [ ] <Task 1>
  - [ ] <Task 2>
  - [ ] <Lot gate: `make typecheck-<ui/api>` + `make lint-<ui/api>`>
  - [ ] <UAT checklist if UI is involved>

- [ ] **Lot 2 — <Next change>**
  - [ ] <Task 1>
  - [ ] <Task 2>
  - [ ] <Lot gate: `make typecheck-<ui/api>` + `make lint-<ui/api>`>
  - [ ] <UAT checklist if UI is involved>

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Refactor and integrate `spec/BRANCH_SPEC_EVOL.md` into existing specs (if not a new standalone spec).
  - [ ] Delete `spec/BRANCH_SPEC_EVOL.md` after integration.

- [ ] **Lot N — Final validation**
  - [ ] **API tests**
    - [ ] <Exhaustive list of API test updates (file-by-file, existing + new)>
    - [ ] <Evolve or add API tests (e.g., update `api/tests/api/organizations.spec.ts` or add `api/tests/api/new-feature.spec.ts`)>
    - [ ] <Scoped runs while evolving tests: `make test-api-<suite> SCOPE=tests/your-file.spec.ts`>
    - [ ] Sub-lot gate: `make test-api`
  - [ ] **UI tests (TypeScript only)**
    - [ ] <Exhaustive list of UI TS test updates (file-by-file, existing + new)>
    - [ ] <Evolve or add UI TS tests (e.g., update `ui/tests/stores/organizations.spec.ts` or add `ui/tests/utils/new-feature.spec.ts`)>
    - [ ] <Scoped runs while evolving tests: `make test-ui SCOPE=tests/your-file.spec.ts`>
    - [ ] Sub-lot gate: `make test-ui`
  - [ ] **E2E tests**
    - [ ] Prepare E2E build: `make build-api build-ui-image`
    - [ ] <Exhaustive list of E2E test updates (file-by-file, existing + new)>
    - [ ] <Evolve or add E2E tests (e.g., update `e2e/tests/05-organizations.spec.ts` or add `e2e/tests/10-new-feature.spec.ts`)>
    - [ ] <Scoped runs while evolving tests: `make test-e2e E2E_SPEC=tests/your-file.spec.ts`>
    - [ ] Sub-lot gate: `make clean test-e2e`
  - [ ] Final gate: Créate PR with BRANCH.md content as initial message & Verify CI for the branch
  - [ ] Final commit removes `BRANCH.md` and checks `TODO.md`
