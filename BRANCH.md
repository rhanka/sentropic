# Feature: BR-40bc + BR-38a Integrated UAT

## Objective
Integrate BR-38a multimodal image input, BR-40b xlsx multi-tab document query, and BR-40c folder xlsx export into one qualification branch for combined preUAT and UAT.

## Scope / Guardrails
- Scope limited to merging already validated branch work from `feat/multimodal-image-input`, `feat/xlsx-multitab-query`, and `feat/folder-xlsx-export`.
- No new product behavior beyond conflict resolution and integration fixes required to make the combined branch build, test, and run.
- One existing migration from BR-38a is included: `api/drizzle/0027_chat_message_attachments.sql`.
- Make-only workflow, no direct Docker or npm commands.
- Branch development happens in `tmp/feat-40bc-38a`.
- Automated tests use `ENV=test-feat-40bc-38a` or `ENV=e2e-feat-40bc-38a`; never root `ENV=dev`.
- Root UAT clone/worktree is `uat/40bc-38a` only after integration gates are coherent.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `package-lock.json`
  - `api/package.json`
  - `api/drizzle/0027_chat_message_attachments.sql`
  - `api/drizzle/meta/_journal.json`
  - `api/src/db/schema.ts`
  - `api/src/routes/api/chat.ts`
  - `api/src/routes/api/documents.ts`
  - `api/src/routes/api/google-drive.ts`
  - `api/src/routes/api/xlsx.ts`
  - `api/src/routes/api/index.ts`
  - `api/src/services/**`
  - `api/tests/**`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/chat-core/package.json`
  - `packages/chat-core/src/**`
  - `packages/chat-core/tests/**`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/src/**`
  - `packages/chat-ui/tests/**`
  - `packages/events/package.json`
  - `packages/events/src/**`
  - `packages/events/tests/**`
  - `ui/src/lib/**`
  - `ui/src/routes/folders/[id]/+page.svelte`
  - `ui/src/locales/en.json`
  - `ui/src/locales/fr.json`
  - `ui/tests/**`
  - `e2e/tests/**`
  - `spec/DATA_MODEL.md`
  - `spec/SPEC_CHATBOT.md`
  - `spec/SPEC_EVOL_LLM_MESH.md`
  - `spec/SPEC_EVOL_GOOGLE_DRIVE_CONNECTOR.md`
  - `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md`
  - `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`
  - `spec/TOOLS.md`
  - `spec/COLLAB.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` except already existing source branch plan files if documentation sync becomes mandatory.
- **Conditional Paths (allowed only with explicit `BR40bc38a-EXn` exception)**:
  - `.github/workflows/**`
  - Additional `api/drizzle/*.sql` files beyond BR-38a `0027_chat_message_attachments.sql`.
- **Exception process**:
  - Declare `BR40bc38a-EXn` in `## Feedback Loop` with reason, impact, and rollback.

## Feedback Loop
- **BR40bc38a-M1** `acknowledge`: integration branch created from local `main` `ff32a06f` because BR-40b/40c were based there; remote `origin/main` is currently older in this clone.
- **BR40bc38a-M2** `acknowledge`: first 38a merge conflict in `packages/llm-mesh/src/catalog.ts` resolved by keeping `main`'s `gemini-3.1-flash-lite` replacement for erroneous `gemini-3.5-thinking`, while preserving BR-38a vision capability on the real Gemini model.
- **BR40bc38a-M3** `attention`: root currently has a `dev` stack on `8791/5177/1081`; integrated UAT must avoid clobbering it until the requested `uat/40bc-38a` clone/worktree is ready.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism.
  - Non-systematic means at least one success on the same commit and command.
  - Never add timeouts.
  - Record exact command, failing file, and signature here.
  - Capture explicit user sign-off before merge if accepting any AI flaky result.
- Known allowlist inherited from source branches:
  - API AI suites under `api/tests/ai/**`.
  - E2E `03-chat.spec.ts`, `00-ai-generation.spec.ts`, `03-chat-chrome-extension.spec.ts`, `07_comment_assistant.spec.ts`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick/merge integration**.
- [ ] Multi-branch.
- Rationale: user requested one combined 40bc+38a qualification branch to simplify preUAT/UAT.

## UAT Management (in orchestration context)
- Integration worktree: `tmp/feat-40bc-38a`.
- UAT clone/worktree: `uat/40bc-38a` after integration gates.
- Test envs: `ENV=test-feat-40bc-38a`, `ENV=e2e-feat-40bc-38a`.
- Proposed UAT ports: `API_PORT=9203`, `UI_PORT=5403`, `MAILDEV_UI_PORT=1303`.
- Root `ENV=dev` must not be used for automated tests.

## Plan / Todo (lot-based)
- [x] **Lot 38a-0 - Baseline & constraints**
  - [x] Imported BR-38a scope, guardrails, migration exception, and UAT notes.
- [x] **Lot 38a-1 - Mesh and provider vision contract**
  - [x] Imported llm-mesh image/file content handling and capability guards.
  - [x] Integration conflict resolved for Gemini model catalog.
- [x] **Lot 38a-2 - Document and Drive image ingestion**
  - [x] Imported local and Google Drive image MIME support.
- [x] **Lot 38a-3 - Chat API/runtime media attachments**
  - [x] Imported persisted message attachments and vision hydration.
- [x] **Lot 38a-4 - Chat UI and documents UX**
  - [x] Imported composer attachments, timeline rendering, lightbox, and host adapter contracts.
- [x] **Lot 38a-U1 - Image attachment UX feedback**
  - [x] Imported unified attachment UX fixes and related tests.
- [x] **Lot 38a-U2 - Durable per-message attachment model**
  - [x] Imported per-message attachment model, pending-only composer band, and vision proof E2E scenario.
- [x] **Lot 40b-0 - Baseline & constraints**
  - [x] Imported BR-40b resolved framing: absorb spreadsheet indexing, add sheet-aware document tools.
- [x] **Lot 40b-1 - ExcelJS xlsx reader**
  - [x] Imported xlsx extraction with formulas plus computed values.
- [x] **Lot 40b-2 - Query-tool sheet awareness**
  - [x] Imported `list_sheets` and `get_sheet_content` document tool actions.
- [x] **Lot 40b-3 - E2E coverage**
  - [x] Imported `08-xlsx-multisheet-query.spec.ts` and formula workbook fixture.
- [ ] **Lot 40b-N-2 - UAT**
  - [ ] Upload a multi-sheet xlsx with a cross-sheet formula.
  - [ ] Ask the agent to list sheets.
  - [ ] Ask the agent for one sheet's content and verify formula plus computed value.
  - [ ] Verify full content still labels all sheets.
  - [ ] Verify single-sheet xlsx and pdf/docx/pptx document reads still work.
- [ ] **Lot 40c-0 - Baseline, async pattern & chart spike**
  - [ ] Merge BR-40c into this integration branch.
- [ ] **Lot 40c-R - Rebase/import validation**
  - [ ] Preserve BR-40c rebase decisions and lockfile/package changes.
- [ ] **Lot 40c-1 - XLSX generation service**
  - [ ] Import folder xlsx generation service and native chart injection.
- [ ] **Lot 40c-2 - Route and queue wiring**
  - [ ] Import `/api/xlsx` route and `xlsx_generate` queue handling.
- [ ] **Lot 40c-3 - UI export entry point**
  - [ ] Import folder page xlsx export action and i18n.
- [ ] **Lot 40c-4 - Live cross-sheet formulas**
  - [ ] Import formula cells for scores/quadrants and read-back tests.
- [ ] **Lot 40c-5 - E2E**
  - [ ] Import `07-import-export.spec.ts` xlsx export coverage.
- [ ] **Lot 40c-N-2 - UAT**
  - [ ] Export a scored folder as xlsx.
  - [ ] Verify 3 tabs, live formulas, native editable scatter chart.
  - [ ] Verify DOCX/PPTX/ZIP exports still work.
- [ ] **Lot 40bc38a-I - Integration gates**
  - [ ] Resolve merge conflicts across 38a, 40b, and 40c.
  - [ ] `make typecheck-api API_PORT=9203 UI_PORT=5403 MAILDEV_UI_PORT=1303 ENV=test-feat-40bc-38a`
  - [ ] `make typecheck-ui API_PORT=9203 UI_PORT=5403 MAILDEV_UI_PORT=1303 ENV=test-feat-40bc-38a`
  - [ ] `make lint-api API_PORT=9203 UI_PORT=5403 MAILDEV_UI_PORT=1303 ENV=test-feat-40bc-38a`
  - [ ] `make lint-ui API_PORT=9203 UI_PORT=5403 MAILDEV_UI_PORT=1303 ENV=test-feat-40bc-38a`
  - [ ] Run focused API/UI/package tests covering 38a, 40b, and 40c changed surfaces.
  - [ ] Build API/UI images for e2e.
  - [ ] Run scoped E2E: `03-chat`, `07-import-export`, `08-xlsx-multisheet-query`.
- [ ] **Lot 40bc38a-UAT - Combined preUAT**
  - [ ] Prepare `uat/40bc-38a` clone/worktree at the integration HEAD.
  - [ ] Start stack on `API_PORT=9203`, `UI_PORT=5403`, `MAILDEV_UI_PORT=1303`.
  - [ ] Playwright preUAT: image attachment visible per message and sent to vision-capable model.
  - [ ] Playwright preUAT: xlsx multi-sheet upload/query workflow.
  - [ ] Playwright preUAT: folder xlsx export workflow including formula workbook download.
  - [ ] Manual UAT checklist ready for user.
- [ ] **Lot 40bc38a-N - Final validation**
  - [ ] Update this `BRANCH.md` with actual commands and results.
  - [ ] Verify package version bumps are present for touched package `src/**`.
  - [ ] Push only after user confirmation.
  - [ ] Create PR using this `BRANCH.md` as body when ready.
