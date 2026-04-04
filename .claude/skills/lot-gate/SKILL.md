---
name: lot-gate
description: Run lot gate checks — typecheck, lint, and scoped tests for current lot
paths: "**/BRANCH.md"
allowed-tools: Read Bash Grep
---

# Lot Gate

Workflow skill to run the standard lot gate sequence for the current lot in BRANCH.md.

## Steps

1. **Read BRANCH.md**
   Parse the current lot and its gate checklist. Identify:
   - Lot number and name
   - Which components are in scope (API, UI, E2E)
   - Scoped test files listed in the gate checklist
   - Branch environment slug (`ENV=<test|e2e>-<branch-slug>`)

2. **Typecheck**
   Run typecheck for in-scope components:
   ```bash
   make typecheck-api ENV=<branch-env>
   make typecheck-ui ENV=<branch-env>
   ```
   Only run for components that have changes in this lot.

3. **Lint**
   Run lint for in-scope components:
   ```bash
   make lint-api ENV=<branch-env>
   make lint-ui ENV=<branch-env>
   ```
   Only run for components that have changes in this lot.

4. **Scoped tests**
   Run each test category listed in the lot gate checklist:
   - **API tests**: `make test-api SCOPE=<test-file> ENV=test-<branch-slug>`
   - **UI tests**: `make test-ui SCOPE=<test-file> ENV=test`
   - **E2E tests**: `make test-e2e E2E_SPEC=<test-file> API_PORT=<port> UI_PORT=<port> MAILDEV_UI_PORT=<port> ENV=e2e-<branch-slug>`
   Run scoped tests first (individual files), then the full sub-lot gate command.

5. **Report pass/fail**
   For each gate item, report:
   - PASS or FAIL status
   - If FAIL: error summary (first 20 lines of output)
   - If AI flaky: check against acceptance rule (non-systematic, at least one success on same commit)

6. **Update BRANCH.md checkboxes**
   Mark each completed gate item with `[x]` in BRANCH.md.
   For failures, leave `[ ]` and add a `blocked` feedback loop entry.

## Rules

- Never increase timeouts — it masks bugs
- Never run tests on `ENV=dev` — afterEach hooks purge real data
- Always pass `ENV` as the last argument to `make`
- E2E tests require all 3 ports: `API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT`
- AI flaky tests: accept only non-systematic provider/network nondeterminism; document failure signature in BRANCH.md
