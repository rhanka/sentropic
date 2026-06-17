# Feature: Restore PPTX E2E Scope

## Objective
Restore the PPTX organization generation E2E workflow that was changed during PR #333 and only remove the excessive timeout from that existing E2E path.

## Scope / Guardrails
- Scope limited to reverting the PPTX E2E detour and adjusting the excessive timeout in the existing E2E.
- No migrations.
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/fix-pptx-e2e-timeout-only`.
- Automated test campaigns must run on dedicated environments, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/routes/api/pptx.ts`
  - `e2e/tests/08-pptx-org-generation.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- None.

## AI Flaky tests
- No AI flaky acceptance planned. If the restored E2E is AI-dependent and fails by provider/network/model nondeterminism, stop and report the exact signature.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Single scoped revert/fix branch.

## UAT Management (in orchestration context)
- No manual UAT planned for this revert-only test scope.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, and `rules/testing.md`.
  - [x] Create isolated worktree `tmp/fix-pptx-e2e-timeout-only`.
  - [x] Confirm scope and guardrails.

- [ ] **Lot 1 — Restore E2E and timeout-only change**
  - [x] Restore `e2e/tests/08-pptx-org-generation.spec.ts` to the previous full E2E workflow.
  - [x] Remove the excessive 300000ms/5 minute timeout from the restored E2E.
  - [x] Remove the backend deterministic PPTX endpoint added only for the test detour.
  - [ ] Lot gate:
    - [x] `make scope-check API_PORT=9250 UI_PORT=5450 MAILDEV_UI_PORT=1325 ENV=test-fix-pptx-e2e-timeout-only`
    - [x] `make typecheck-api API_PORT=9250 UI_PORT=5450 MAILDEV_UI_PORT=1325 REGISTRY=local ENV=test-fix-pptx-e2e-timeout-only`
    - [x] `make test-e2e E2E_SPEC=tests/08-pptx-org-generation.spec.ts API_PORT=9251 UI_PORT=5451 MAILDEV_UI_PORT=1326 REGISTRY=local ENV=e2e-fix-pptx-e2e-timeout-only`

- [ ] **Lot 2 — Final validation**
  - [ ] Commit scoped change.
  - [ ] Push branch and open PR.
  - [ ] Verify CI.
  - [ ] Remove `BRANCH.md`, push, and merge when green.
