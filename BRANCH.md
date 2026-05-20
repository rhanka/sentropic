# Feature: XLSX and Google Sheets Indexing

## Objective
Allow uploaded XLSX workbooks and Google Sheets imports to enter the existing document indexing path reliably, so `document_summary` and the `documents` tool can extract spreadsheet text instead of failing or indexing only a CSV slice.

## Scope / Guardrails
- Scope limited to document text extraction, Google Drive spreadsheet ingest export format, local XLSX upload affordance, and targeted tests.
- This is a quick branch outside the numbered `PLAN.md` roadmap; do not add a new roadmap number and do not edit `PLAN.md`.
- One migration max in `api/drizzle/*.sql`; no migration is expected.
- Make-only workflow, no direct Docker/npm commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT and existing branch work; do not switch or clean it.
- Branch development must happen in isolated worktree `tmp/feat-xlsx-gsheet-indexing`.
- Automated test campaigns must run on dedicated environments, never on root `ENV=dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new code, comments, docs, package metadata, and PR text must be English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/document-text.ts`
  - `api/src/services/google-drive-client.ts`
  - `api/tests/unit/document-text.test.ts`
  - `api/tests/unit/google-drive-client.test.ts`
  - `ui/src/lib/utils/documents.ts`
  - `ui/tests/utils/documents.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `PLAN.md`
  - `plan/NN-BRANCH_*.md`
  - `tmp/feat-chat-ui-sdk/**`
  - `tmp/feat-chat-ui-sdk-v2/**`
  - `tmp/refacto-chat-service-core/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/package.json`
  - `api/package-lock.json`
  - `package.json`
  - `package-lock.json`
  - `api/drizzle/*.sql`
  - `spec/**`
  - `TODO.md`
- **Exception process**:
  - Declare exception ID `XLSX-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - No exception is active.

## Feedback Loop
- [x] `clarification`: This branch intentionally follows the `BRANCH.md` lot method without adding a numbered roadmap entry in `PLAN.md`.
- [x] `clarification`: Isolated worktree created at `tmp/feat-xlsx-gsheet-indexing` on branch `feat/xlsx-gsheet-indexing` from `origin/main` (`74f71e3b`).
- [x] `clarification`: Root workspace is currently on `uat/br14a` with untracked UAT artifacts; this branch will not touch or clean root.
- [ ] `attention`: Before UAT, push the branch and run user UAT from root `ENV=dev` only after confirming HEAD parity.
- [x] `validation` XLSX-T1 — Red/green spreadsheet coverage:
  - Red: `make test-api-unit SCOPE=tests/unit/document-text.test.ts API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing` failed because current XLSX extraction flattened cells and did not preserve worksheet names or rows.
  - Red: `make test-api-unit SCOPE=tests/unit/google-drive-client.test.ts API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing` failed because Google Sheets ingestion still exported `text/csv`.
  - Red: `make test-ui SCOPE=tests/utils/documents.test.ts API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing` failed because XLSX was missing from upload accept types and MIME labels.
  - Green: the same three commands now pass on the implemented branch.
- [x] `attention` XLSX-T2 — A scoped endpoint assertion for `.xlsx` MIME fallback was attempted but removed because `api/tests/api/documents.test.ts` times out in the cold `beforeEach` before reaching the XLSX assertion on this lane. No endpoint behavior change is needed for indexing because the extractor detects `.xlsx` by filename when MIME is absent or generic.
- [x] `validation` XLSX-G1 — Quality gates executed:
  - `make typecheck-api API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing` passed.
  - `make lint-api API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing` passed with 0 errors and existing no-console warnings outside this branch scope.
  - `make typecheck-ui API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing` passed with 0 errors and 6 existing Svelte warnings outside this branch scope.
  - `make lint-ui API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing` passed.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** because the change is narrow and all spreadsheet behavior shares the same document indexing path.
- [ ] **Multi-branch** only if unexpected API/UI split risk appears during implementation.
- Rationale: A single branch keeps XLSX extraction, Google Sheets export choice, and upload affordance aligned in one validation cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only after implementation and focused gates.
- **Multi-branch**: no UAT on sub-branches; not expected here.
- UAT checkpoints are listed inside the UAT lot.
- Execution flow:
  - Develop and run tests in `tmp/feat-xlsx-gsheet-indexing`.
  - Push branch before UAT only when implementation lots are ready.
  - Run user UAT from root workspace on `ENV=dev`.
  - Switch back to `tmp/feat-xlsx-gsheet-indexing` after UAT if fixes are needed.

## Environment Mapping
- [x] Worktree: `tmp/feat-xlsx-gsheet-indexing`.
- [x] Branch: `feat/xlsx-gsheet-indexing`.
- [x] Branch ENV: `feat-xlsx-gsheet-indexing`.
- [x] Test ENV: `test-feat-xlsx-gsheet-indexing`.
- [x] E2E ENV: `e2e-feat-xlsx-gsheet-indexing`.
- [x] Branch dev ports: `API_PORT=9090`, `UI_PORT=5290`, `MAILDEV_UI_PORT=1190`, with `ENV=feat-xlsx-gsheet-indexing` last.
- [x] Test ports: `API_PORT=9090`, `UI_PORT=5290`, `MAILDEV_UI_PORT=1190`, with `ENV=test-feat-xlsx-gsheet-indexing` last.
- [x] E2E ports: `API_PORT=9090`, `UI_PORT=5290`, `MAILDEV_UI_PORT=1190`, with `ENV=e2e-feat-xlsx-gsheet-indexing` last.
- [x] Root UAT remains reserved for user dev on `ENV=dev`.

## Plan / Todo (lot-based)
- [x] **Lot 0 - Baseline & constraints**
  - [x] Read mandatory rules: `rules/MASTER.md`, `rules/workflow.md`, and `rules/testing.md`.
  - [x] Read project context: `README.md`, `TODO.md`, `PLAN.md`.
  - [x] Read branch references: `plan/BRANCH_TEMPLATE.md`, `plan/done/16a-BRANCH_feat-gdrive-sso-indexing-16a.md`, and `spec/SPEC_EVOL_GOOGLE_DRIVE_CONNECTOR.md`.
  - [x] Confirm isolated worktree and branch name.
  - [x] Copy root `.env` into the worktree and set branch-local `ENV`/ports.
  - [x] Confirm branch is outside global roadmap numbering.
  - [x] Record branch scope boundaries and forbidden paths.
  - [x] Identify impacted test suites and Make targets.

- [x] **Lot 1 - Spreadsheet indexing support**
  - [x] Add failing API tests proving Google Sheets ingestion uses XLSX export and XLSX extraction reads multi-sheet workbooks.
  - [x] Add failing UI tests proving XLSX appears in the accepted document upload types and label mapping.
  - [x] Implement XLSX text extraction in `document-text.ts` using existing dependencies.
  - [x] Change Google Sheets ingestion export to XLSX while keeping user downloads as XLSX.
  - [x] Allow local XLSX upload selection.
  - [x] Lot gate:
    - [x] `make test-api-unit SCOPE=tests/unit/document-text.test.ts API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing`
    - [x] `make test-api-unit SCOPE=tests/unit/google-drive-client.test.ts API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing`
    - [x] `make test-ui SCOPE=tests/utils/documents.test.ts API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing`
    - [x] Commit with selective `git add`, then `make commit MSG="feat: support spreadsheet document indexing" ENV=test-feat-xlsx-gsheet-indexing`.

- [ ] **Lot N-2 - UAT handoff**
  - [ ] Push branch before UAT.
  - [ ] Confirm UAT HEAD parity between pushed branch and local worktree.
  - [ ] Web app UAT:
    - [ ] Attach a local `.xlsx` workbook through an existing document surface and confirm indexing reaches `ready`.
    - [ ] Import a Google Sheet through Google Drive and confirm indexing reaches `ready`.
    - [ ] Ask chat to consult the attached spreadsheet document and confirm spreadsheet content is available.
    - [ ] Download the Google Sheet document and confirm the user-facing download remains `.xlsx`.
  - [ ] Non-regression UAT:
    - [ ] Attach a PDF or DOCX and confirm existing indexing still reaches `ready`.
    - [ ] Confirm Google Docs import still indexes through the existing path.

- [ ] **Lot N - Final validation**
  - [x] `make typecheck-api API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing`
  - [x] `make lint-api API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing`
  - [x] `make typecheck-ui API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing`
  - [x] `make lint-ui API_PORT=9090 UI_PORT=5290 MAILDEV_UI_PORT=1190 ENV=test-feat-xlsx-gsheet-indexing`
  - [x] Re-run focused API/UI tests from Lot 1.
  - [x] Record executed commands and outcomes in this file before handoff.
