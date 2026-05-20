# Feature: Gemini 3.5 Flash catalog replacement

## Objective
Replace the Gemini 3.1 Pro catalog entry with Gemini 3.5 Flash without adding a global roadmap branch number.

## Scope / Guardrails
- Scope limited to model catalog metadata, model-selection tests, chat context budget metadata, and matching specs.
- No database migration.
- Make-only workflow for build, quality, tests, and commits.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT and must remain stable.
- Branch development happens in isolated worktree `tmp/fix-gemini-35-flash`.
- Automated test campaigns run on `ENV=test-fix-gemini-35-flash`, never on `ENV=dev`.
- In every `make` command, `ENV=test-fix-gemini-35-flash` must be passed as the last argument when the target accepts an environment.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/providers.ts`
  - `packages/llm-mesh/tests/facade.test.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/services/model-selection-legacy.ts`
  - `api/tests/api/*.test.ts`
  - `api/tests/unit/*.test.ts`
  - `ui/tests/**/*.test.ts`
  - `packages/chat-core/tests/**/*.test.ts`
  - `spec/SPEC_CHATBOT.md`
  - `spec/SPEC_EVOL_LLM_MESH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `PLAN.md`
  - `plan/NN-BRANCH_*.md`
  - `plan/done/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `QG35-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [ ] No active blocker.

## AI Flaky tests
- [ ] No AI flaky test accepted.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Single catalog replacement with tightly scoped tests and no independent sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only.
- UAT checkpoints are listed inside Lot N-2.
- Execution flow:
  - [x] Develop and run tests in `tmp/fix-gemini-35-flash`.
  - [ ] Push branch before UAT.
  - [ ] Run user UAT from root workspace on the pushed branch or deployment target selected by the user.
  - [ ] Switch back to `tmp/fix-gemini-35-flash` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`.
  - [x] Read `rules/workflow.md`.
  - [x] Read `README.md`, `TODO.md`, and `PLAN.md`.
  - [x] Create isolated worktree `tmp/fix-gemini-35-flash`.
  - [x] Confirm branch is `fix/gemini-35-flash`.
  - [x] Copy root `.env` into the worktree.
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Define environment mapping: `ENV=test-fix-gemini-35-flash`; UAT ports if needed: API `8795`, UI `5185`, Maildev UI `1085`.
  - [x] Confirm command style: `make ... ENV=test-fix-gemini-35-flash` with `ENV` last.
  - [x] Confirm scope boundaries.

- [x] **Lot 1 — Replace Gemini Pro catalog entry**
  - [x] Add failing tests that expect Gemini catalog to expose `gemini-3.5-flash` and no longer expose `gemini-3.1-pro-preview-customtools`.
  - [x] Replace the llm-mesh Gemini Pro profile with Gemini 3.5 Flash.
  - [x] Update chat-service context budget metadata for the new model id.
  - [x] Add a legacy cutover from `gemini-3.1-pro-preview-customtools` to `gemini-3.5-flash`.
  - [x] Update API/UI/package tests that reference the replaced Gemini model.
  - [x] Update specs that document the active Gemini catalog.
  - [x] Lot gate:
    - [x] Red test observed before implementation: `make test-llm-mesh ENV=test-fix-gemini-35-flash` failed on missing `gemini-3.5-flash` catalog profile.
    - [x] `make test-llm-mesh ENV=test-fix-gemini-35-flash`
    - [x] `make test-api-unit SCOPE="tests/unit/model-selection-legacy.test.ts tests/unit/gemini-tool-handoff.test.ts tests/unit/llm-runtime-stream.test.ts tests/unit/chat-service-tools.test.ts" API_PORT=8795 UI_PORT=5185 MAILDEV_UI_PORT=1085 ENV=test-fix-gemini-35-flash`
    - [x] `make test-api-endpoints SCOPE="tests/api/models.test.ts tests/api/me.test.ts" API_PORT=8795 UI_PORT=5185 MAILDEV_UI_PORT=1085 ENV=test-fix-gemini-35-flash`
    - [x] `make test-ui SCOPE=tests/utils/user-ai-settings-events.test.ts API_PORT=8795 UI_PORT=5185 MAILDEV_UI_PORT=1085 ENV=test-fix-gemini-35-flash`
    - [x] `make typecheck-llm-mesh ENV=test-fix-gemini-35-flash`
    - [x] `make typecheck-api API_PORT=8795 UI_PORT=5185 MAILDEV_UI_PORT=1085 ENV=test-fix-gemini-35-flash`
    - [x] `make lint-api API_PORT=8795 UI_PORT=5185 MAILDEV_UI_PORT=1085 ENV=test-fix-gemini-35-flash`

- [ ] **Lot N-2 — UAT**
  - [ ] Web app settings: model selector shows `Gemini 3.5 Flash` under Gemini.
  - [ ] Web app settings: model selector does not show `Gemini 3.1 Pro`.
  - [ ] Chat model picker shows `Gemini 3.5 Flash` and can save it as the user default.
  - [ ] Existing Gemini Flash Lite remains available.

- [x] **Lot N-1 — Docs consolidation**
  - [x] Update existing specs only; no temporary branch spec required.

- [ ] **Lot N — Final validation**
  - [x] Review `git diff --stat` and scope boundaries.
  - [x] Run targeted verification commands.
  - [x] Commit runtime/docs alignment with `make commit MSG="test: align gemini flash runtime coverage"`.
  - [ ] Push branch before UAT.
  - [ ] Hand off UAT instructions to the user.
