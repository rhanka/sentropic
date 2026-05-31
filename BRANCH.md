# Feature: BR-40b XLSX Multi-Tab Query (formulas + values)

## Objective
Build the multi-sheet xlsx query layer on top of the already-absorbed multi-sheet indexing
(`02188f8b`: `document-text.ts` extracts each sheet as `Sheet: <name>`). The agent must discover
sheets and fetch per-sheet content including BOTH the formula (e.g. `=SUM(B2:B3)`) and the computed
value, via two new `documents` tool actions: `list_sheets` and `get_sheet_content`. `get_content`
keeps returning ALL sheets, each labelled `Sheet: <name>`.

## Scope / Guardrails
- Scope limited to xlsx multi-sheet query-tool awareness (list sheets / fetch per-sheet content with
  formulas+values) + tests. No RAG/connector refactor, no BR-40c/40d work.
- Read xlsx with `exceljs` (`cell.value` = `{ formula, result }` for formula cells; raw value
  otherwise). officeparser stays only for pdf/docx/pptx — xlsx is NOT routed through it.
- Principle (Anthropic xlsx skill): preserve formulas, never collapse to values; describe cross-sheet
  references with `Sheet!A1` semantics.
- Make-only workflow; root `ENV=dev` stays stable; work in `tmp/feat-xlsx-multitab-query`.
- Tests on `ENV=test-feat-xlsx-multitab-query` / `ENV=e2e-feat-xlsx-multitab-query`; `ENV` LAST arg.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `plan/40b-BRANCH_feat-xlsx-multitab-query.md`
  - `api/src/services/document-text.ts`
  - `api/src/services/tools.ts`
  - `api/src/services/tool-service.ts`
  - `api/package.json` + `api/package-lock.json` (exceljs dependency only)
  - `api/tests/unit/document-text.test.ts`
  - `api/tests/**` (document query / tool-service specs)
  - `e2e/tests/**` (document indexing/query specs)
  - `ui/src/lib/utils/documents.ts` (absorbed from #185 — see BR40b-EX1)
  - `ui/tests/utils/documents.test.ts` (absorbed from #185 — see BR40b-EX1)
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` except this branch file
- **Conditional Paths (explicit `BR40b-EXn` exception required)**:
  - `api/src/db/schema.ts` + `api/drizzle/*.sql` (max 1 file) — only if per-sheet metadata MUST be
    persisted (vs derived at query time). Default: derive at query time, NO schema change. STOP and
    ask before touching.
  - `.github/workflows/**`
- **Exception process**: declare `BR40b-EXn` in `## Feedback Loop` with reason, impact, rollback.

## Feedback Loop (framing questions — RESOLVED 2026-05-30)
- **BR40b-Q1** `acknowledge`: disposition = **ABSORB (done)**. PR #185 was cherry-picked as `02188f8b`
  (the branch baseline HEAD) and #185 is CLOSED. The multi-sheet indexing code is already on this
  branch — it is NOT redone; BR-40b builds the query layer on top of it.
- **BR40b-Q2** `acknowledge`: query-tool sheet API shape = **option 1**. Extend the `documents` tool
  (`documentsTool` in `tools.ts`) + `getDocumentContent` flow (`tool-service.ts`) with two actions:
  `list_sheets(documentId)` → sheet names (+ row counts), and
  `get_sheet_content(documentId, sheetName|sheetIndex)` → that sheet's content (formulas + values).
  `get_content` keeps returning ALL sheets labelled `Sheet: <name>`.
- **BR40b-NEW-REQ** `acknowledge`: per-cell output surfaces BOTH formula text and computed value. Read
  xlsx with exceljs; add via `make install-api exceljs` only.
- **BR40b-EX1** `clarification`: scope exception (approved by conductor in launch packet). The two UI
  accept-list files `ui/src/lib/utils/documents.ts` and `ui/tests/utils/documents.test.ts` entered this
  branch's scope via the #185 absorption (`02188f8b`).
  - Reason: #185 changed those UI files (xlsx mime in upload-accept list + "Excel workbook" label +
    their unit assertions); absorbing #185 as the branch baseline brings them under this branch.
  - Impact: query-layer work does not edit them; they remain on the branch as inherited indexing
    changes and ship in the same PR. Listed in Allowed Paths so a scope check does not flag them.
  - Rollback: the UI change is a pure additive accept-list/label entry; reverting `02188f8b`'s UI hunk
    removes it without affecting the query layer.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism; one success on
  same commit + command; never add timeouts; record signature + user sign-off.
- E2E AI allowlist (per `rules/testing.md`): `00-ai-generation`, `03-chat`,
  `03-chat-chrome-extension`, `07_comment_assistant`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**.
- [ ] Multi-branch
- Rationale: one backend capability (query-tool sheet awareness on absorbed indexing); single final
  test cycle.

## UAT Management (in orchestration context)
- Development worktree: `tmp/feat-xlsx-multitab-query`.
- Branch ports (slot 1): `API_PORT=9201`, `UI_PORT=5401`, `MAILDEV_UI_PORT=1301`.
- Test envs: `ENV=test-feat-xlsx-multitab-query`, `ENV=e2e-feat-xlsx-multitab-query`.
- Root UAT env: `ENV=dev`, commit-identical to branch HEAD.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Verify branch `feat/xlsx-multitab-query` @ baseline HEAD `02188f8b`.
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`,
        `README.md`, `PLAN.md`, `plan/40b-BRANCH_feat-xlsx-multitab-query.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Inspect absorbed indexing (`document-text.ts`), query layer (`tools.ts` `documentsTool` +
        `tool-service.ts` `getDocumentContent`), and the #185 UI accept-list files.
  - [x] Confirm slot-1 ports + `ENV=...` last; record Q1/Q2/NEW-REQ/BR40b-EX1.

- [x] **Lot 1 — exceljs xlsx reader (formulas + values)**
  - [x] `make install-api NPM_LIB=exceljs` → exceljs `^4.4.0` (resolved 4.4.0 in root workspace lock).
  - [x] In `document-text.ts`: replaced the JSZip+xmldom xlsx path with an exceljs-based reader.
        Added an exported structured extractor `extractXlsxSheets` (per-sheet: `name`, `index`,
        `rowCount`, `text`) where each formula cell renders as `=FORMULA → value` (raw value
        otherwise). Kept flattened `text` (`Sheet: <name>` sections) + `headingsH1[]` for
        indexing/`get_content` parity. Removed dead JSZip/xmldom xlsx helpers from this file.
  - [x] Lot gate: `make typecheck-api ENV=test-feat-xlsx-multitab-query` (clean) +
        `make lint-api ENV=test-feat-xlsx-multitab-query` (clean).
  - [x] **API tests**
    - [x] Updated `api/tests/unit/document-text.test.ts`: builds a workbook (exceljs) with a
          cross-sheet formula cell `=Budget!B2+Budget!B3`; asserts flattened text still labels each
          sheet, surfaces `=Budget!B2+Budget!B3 → 320`, and that `extractXlsxSheets` returns structured
          per-sheet content. 3/3 passing.
    - [x] Scoped run: `make test-api SCOPE=tests/unit/document-text.test.ts ENV=test-feat-xlsx-multitab-query` → 3 passed.

- [x] **Lot 2 — Query-tool sheet awareness (list_sheets / get_sheet_content)**
  - [x] `tools.ts`: added `list_sheets` + `get_sheet_content` to the `documents` action enum; added
        `sheetName` / `sheetIndex` params; documented them; wired dispatch to the new tool-service
        methods (sheetName OR sheetIndex required for get_sheet_content).
  - [x] `tool-service.ts`: added `listDocumentSheets` (sheet names + 1-based index + row counts) and
        `getDocumentSheetContent` (per-sheet content incl. formulas+values, by name or index). Shared
        private `loadXlsxDocument`/`fetchDocumentRow` reuse the same security/context checks as
        `getDocumentContent` (`assertDocumentExplorable`, context match) and load bytes via
        `loadContextDocumentContent`. Non-xlsx documents raise a clear "not a spreadsheet" error;
        unknown sheet selector raises an error listing available sheets.
  - [x] Kept `get_content` returning all sheets labelled (unchanged behavior).
  - [x] Lot gate: `make typecheck-api ENV=test-feat-xlsx-multitab-query` (clean) +
        `make lint-api ENV=test-feat-xlsx-multitab-query` (0 errors, 178 pre-existing no-console warnings).
  - [x] **API tests**
    - [x] Added `api/tests/unit/xlsx-sheet-query.test.ts`: unit-tests the structured extractor +
          per-sheet selection by name and index, formula+value surfacing
          (`Sum\t=Inputs!B2+Inputs!B3 → 42`), and the `isXlsxDocument` guard. 4/4 passing.
    - [x] Scoped run: `make test-api SCOPE=tests/unit/xlsx-sheet-query.test.ts ENV=test-feat-xlsx-multitab-query` → 4 passed.
    - [x] Sub-lot gate: `make test-api ENV=test-feat-xlsx-multitab-query` → all suites green
          (smoke 20, endpoints 49, queue 30, +others; 0 FAIL) on a clean test env. (A first run showed
          4 unrelated endpoint failures caused by a dirty DB from a concurrent dev stack on the same
          ENV — the documented npm-ci/live-stack footgun; resolved by `make down` then a clean rerun.)

- [x] **Lot 3 — E2E coverage**
  - [x] Prepare build: `make build-api build-ui-image API_PORT=9201 UI_PORT=5401 MAILDEV_UI_PORT=1301 ENV=e2e-feat-xlsx-multitab-query`.
  - [x] Build fix: externalized exceljs in the api esbuild bundle (`api/package.json` build script:
        added `--external:exceljs` next to `--external:officeparser`). exceljs does
        `require('crypto')` dynamically, which esbuild's bundled ESM cannot resolve at runtime
        (`Error: Dynamic require of "crypto" is not supported`); externalizing loads it from
        node_modules at runtime (same pattern as officeparser). exceljs is a production dependency so it
        survives `npm prune --omit=dev` in the api image; no high/critical audit findings.
  - [x] Added `e2e/tests/08-xlsx-multisheet-query.spec.ts` + committed binary fixture
        `e2e/tests/fixtures/multi-sheet-formula.xlsx` (2 sheets: Inputs + Totals; Totals!B2 =
        `Inputs!B2+Inputs!B3` → 42, generated via exceljs). The spec uploads the multi-sheet workbook,
        polls to `ready` (proving the exceljs extraction ran end-to-end during indexing on a
        formula-bearing workbook), and confirms the bytes round-trip as a valid xlsx for the sheet-aware
        tool actions to load. Per-sheet formula+value surfacing asserted at the unit level
        (document-text + xlsx-sheet-query specs); chat-driven `list_sheets`/`get_sheet_content`
        invocation is AI-nondeterministic, exercised in UAT (allowlisted) — noted in spec docstring.
  - [x] Scoped run: `make test-e2e E2E_SPEC=tests/08-xlsx-multisheet-query.spec.ts API_PORT=9201 UI_PORT=5401 MAILDEV_UI_PORT=1301 ENV=e2e-feat-xlsx-multitab-query` → 1 passed (17.9s test).
  - [x] `make clean ... ENV=e2e-feat-xlsx-multitab-query` afterward; `make ps-all` shows no remaining services.

- [ ] **Lot N-2 — UAT** (web app only; no chrome/vscode surface impact)
  - [ ] Upload a multi-tab xlsx with at least one formula (e.g. cross-sheet sum).
    - [ ] Évol: ask the agent to list sheets → both tab names returned with row counts.
    - [ ] Évol: ask the agent for a specific sheet's content → returns that sheet only, with the
          formula text `=...` AND the computed value visible.
    - [ ] Évol: ask for full content → all sheets returned, each labelled `Sheet: <name>`.
    - [ ] Non-reg: single-sheet xlsx still indexes and reads via `get_content`.
    - [ ] Non-reg: a pdf/docx/pptx document still summarizes/reads (officeparser path untouched).

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update the document/RAG spec (if a relevant spec exists) describing the two new sheet actions
        and the formula+value surfacing principle. No standalone `spec/BRANCH_SPEC_EVOL.md` needed
        (single backend capability).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint: `make typecheck-api ENV=test-feat-xlsx-multitab-query` +
        `make lint-api ENV=test-feat-xlsx-multitab-query`.
  - [ ] Retest API: `make test-api ENV=test-feat-xlsx-multitab-query`.
  - [ ] Retest UI: `make test-ui SCOPE=tests/utils/documents.test.ts ENV=test-feat-xlsx-multitab-query`
        (absorbed accept-list assertions).
  - [ ] Retest E2E (doc spec group): `make clean test-e2e API_PORT=9201 UI_PORT=5401 MAILDEV_UI_PORT=1301 ENV=e2e-feat-xlsx-multitab-query E2E_GROUP=<group>`.
  - [ ] No `packages/<pkg>/src/**` touched → no package bump required (verify).
  - [ ] STOP after local gates: report to conductor for integration. Do NOT push, do NOT open PR.
