# Feature: BR-22 — Rich Markdown List Stabilization

## Objective
Post-BR-04B mini-fix branch to stabilize rich markdown list rendering/editing, starting with the freeze reproduced on initiative `cc884370-765c-40f3-a754-ceaf9a05da04` in the `constraints` field.

## Scope / Guardrails
- Make-only workflow. Branch in `tmp/fix-rich-markdown-list-stabilization`.
- `ENV=fix-rich-markdown-list-stabilization` `API_PORT=8722` `UI_PORT=5122` `MAILDEV_UI_PORT=1022`.
- Starts only after BR-04B is merged, so the fix is based on the merged TemplateRenderer/TipTap stack.
- Scope limited to rich markdown list stabilization and targeted regressions; dashboard print pipeline stays out of scope unless the same root cause is proven.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `api/**`, `ui/**`, `e2e/**`, `plan/22-BRANCH_fix-rich-markdown-list-stabilization.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
- **Conditional Paths**: `api/drizzle/*.sql` (max 1), `.github/workflows/**`, `PLAN.md`

## Feedback Loop

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: isolated post-merge hotfix with one main repro path and one integrated validation cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on the integrated branch only.
- Execution flow: develop/test in `tmp/fix-rich-markdown-list-stabilization`, push, UAT from root on `ENV=dev`, switch back.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline & repro**
  - [ ] Re-read the relevant `.mdc` rules and confirm the live-debug / Playwright lane commands.
  - [ ] Create/confirm isolated worktree `tmp/fix-rich-markdown-list-stabilization`.
  - [ ] Reproduce the freeze on initiative `cc884370-765c-40f3-a754-ceaf9a05da04` with the stabilized Playwright dev harness.
  - [ ] Confirm whether the issue is edit-mode only, locked-mode only, or both.

- [ ] **Lot 1 — Isolate the failing rich-list path**
  - [ ] Reduce the failing `constraints` payload to the minimal markdown pattern that still triggers the freeze.
  - [ ] Trace the path `TemplateRenderer` -> `EditableInput` -> `TipTap` -> markdown helpers.
  - [ ] Decide whether the fix belongs in `forceList` behavior, markdown roundtrip normalization, field-specific opt-out, or API-side normalization.

- [ ] **Lot 2 — Fix + targeted regressions**
  - [ ] Implement the smallest safe fix on the merged BR-04B codebase.
  - [ ] Add targeted tests for markdown list idempotence / rich-list rendering.
  - [ ] Add or adapt a focused Playwright/E2E repro so the `constraints` freeze is covered.
  - [ ] Verify normal initiative pages and other list fields stay stable.

- [ ] **Lot N-2 — UAT**
  - [ ] Open initiative `cc884370-765c-40f3-a754-ceaf9a05da04` from root `ENV=dev` and confirm the page loads without freeze.
  - [ ] Verify `constraints` renders correctly in locked mode and edit mode.
  - [ ] Verify a normal initiative still renders identically.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update PLAN.md / BRANCH docs if scope or diagnosis changed.

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-ui API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-fix-rich-markdown-list-stabilization`
  - [ ] `make lint-ui API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-fix-rich-markdown-list-stabilization`
  - [ ] `make test-ui API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test`
  - [ ] Targeted API checks if API normalization was touched.
  - [ ] Targeted Playwright/E2E repro on dedicated env.
  - [ ] Create/update PR using this branch file as PR body, run CI, then merge after UAT.
