# Feature: BR-40b XLSX Multi-Tab Indexing & Query

## Objective
Correctly handle multi-tab (multi-sheet) xlsx sources end to end: in indexing (each sheet preserved
and labelled in the extracted/indexed content) and in the documentary query tool (the AI agent can
discover sheets and retrieve per-sheet content, not just a flattened blob).

## Context — relationship to `feat/xlsx-gsheet-indexing` (UNMERGED, UAT-ready)
The in-flight branch `feat/xlsx-gsheet-indexing` (commits `57ed82f4`, `ae01ee18`, `94bb793f`) already:
- adds multi-sheet xlsx text extraction in `api/src/services/document-text.ts` (JSZip + xmldom,
  each sheet prefixed `Sheet: <name>`, tab-separated rows, sheet names in `headingsH1[]`);
- switches Google Sheets export to xlsx in `api/src/services/google-drive-client.ts` (preserving tabs);
- updates the UI file-picker accept list + unit tests.
It does **not** add per-sheet awareness to the documentary query tool
(`api/src/services/tools.ts` `documentsTool` / `api/src/services/tool-service.ts` `getDocumentContent`),
which still returns flattened full text. **BR40b-Q1 decides how the two branches relate.**

## Scope / Guardrails
- Scope limited to: xlsx multi-sheet indexing parity and query-tool sheet awareness (list sheets /
  fetch per-sheet content), plus tests. No unrelated RAG/connector refactors.
- Make-only workflow; root `ENV=dev` stays stable; work in `tmp/feat-xlsx-multitab-query`.
- Tests on `ENV=test-feat-xlsx-multitab-query` / `ENV=e2e-feat-xlsx-multitab-query`; `ENV` last.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `plan/40b-BRANCH_feat-xlsx-multitab-query.md`
  - `api/src/services/document-text.ts`
  - `api/src/services/tools.ts`
  - `api/src/services/tool-service.ts`
  - `api/src/services/google-drive-client.ts` (only if not already covered by the merged base)
  - `api/tests/unit/document-text.test.ts`
  - `api/tests/**` (document query / tool-service specs)
  - `e2e/tests/**` (document indexing/query specs)
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` except this branch file
- **Conditional Paths (explicit `BR40b-EXn` exception required)**:
  - `api/src/db/schema.ts` + `api/drizzle/*.sql` (max 1 file) — only if per-sheet metadata must be
    persisted (vs derived at query time). Default: derive at query time, no schema change.
  - `.github/workflows/**`
- **Exception process**: declare `BR40b-EXn` in `## Feedback Loop` with reason, impact, rollback.

## Feedback Loop (open framing questions)
- **BR40b-Q1** `attention`: disposition of `feat/xlsx-gsheet-indexing`. Options:
  (a) **merge-first** — merge that branch to main, then BR-40b builds only the query-tool sheet
      awareness on top (smallest, cleanest; BR-40b = net-new query layer);
  (b) **absorb** — rebase its 3 commits into BR-40b and ship indexing + query together as one PR;
  (c) **rename/supersede** — treat `feat/xlsx-gsheet-indexing` as BR-40b itself and extend it in place.
  Stakes: determines BR-40b's diff size, whether the extraction work is re-reviewed, and merge order.
  Recommendation: (a) merge-first if that branch is genuinely UAT-clean; else (b). Needs user decision.
- **BR40b-Q2** `clarification`: query-tool sheet API shape. Proposed: extend `documentsTool` with
  `list_sheets` (return sheet names + sizes) and `get_sheet_content` (per-sheet text by name/index),
  keeping `get_content` returning all sheets labelled. Confirm or adjust.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism; one success on
  same commit + command; never add timeouts; record signature + user sign-off.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**.
- [ ] Multi-branch
- Rationale: one backend capability (indexing parity + query sheet awareness); single final test cycle.

## UAT Management (in orchestration context)
- Development worktree: `tmp/feat-xlsx-multitab-query`.
- Branch ports (slot 1): `API_PORT=9201`, `UI_PORT=5401`, `MAILDEV_UI_PORT=1301`.
- Test envs: `ENV=test-feat-xlsx-multitab-query`, `ENV=e2e-feat-xlsx-multitab-query`.
- Root UAT env: `ENV=dev`, commit-identical to branch HEAD.

## Plan / Todo (lot-based) — DRAFT pending BR40b-Q1/Q2
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `README.md`, `TODO.md`, `PLAN.md`, this branch file.
  - [ ] Inspect `feat/xlsx-gsheet-indexing` diff; confirm BR40b-Q1 disposition with conductor.
  - [ ] Create worktree `tmp/feat-xlsx-multitab-query` from the agreed base (main, or post-merge main).
  - [ ] Confirm slot-1 ports + `ENV=...` last.

- [ ] **Lot 1 — Indexing multi-sheet parity** (only if not inherited via BR40b-Q1 base)
  - [ ] Ensure each sheet is labelled and preserved in extracted text + `headingsH1[]`.
  - [ ] Lot gate: `make typecheck-api` + `make lint-api`; `api/tests/unit/document-text.test.ts`.

- [ ] **Lot 2 — Query-tool sheet awareness**
  - [ ] Add `list_sheets` + `get_sheet_content` actions to `documentsTool` (per BR40b-Q2).
  - [ ] Implement per-sheet retrieval in `tool-service.ts` from the labelled extracted text (or
        per-sheet metadata if BR40b-EX1 approved).
  - [ ] Keep `get_content` returning all sheets, clearly labelled.
  - [ ] Lot gate: `make typecheck-api` + `make lint-api`; tool-service / document query API tests.

- [ ] **Lot 3 — E2E coverage**
  - [ ] Upload a multi-sheet xlsx, index it, and verify the agent can list sheets + fetch one sheet.
  - [ ] Lot gate: scoped `make test-e2e` on the document spec with slot-1 ports.

- [ ] **Lot N-2 — UAT** (upload multi-tab xlsx, ask agent per-sheet questions; non-reg: single-sheet
      xlsx + other doc types).
- [ ] **Lot N-1 — Docs consolidation** (update document/RAG spec).
- [ ] **Lot N — Final validation** (typecheck/lint, API/E2E retests, package bumps if any, PR → CI →
      remove `BRANCH.md` → merge via merge commit).
