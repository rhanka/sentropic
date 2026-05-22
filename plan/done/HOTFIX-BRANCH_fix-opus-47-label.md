# Feature: Gemini 3.5 Thinking catalog replacement

## Objective
Replace the remaining Gemini 3.1 Flash Lite catalog entry with Gemini 3.5 Thinking and correct the Opus 4.7 display label without adding a global roadmap branch number.

## Scope / Guardrails
- Scope limited to model catalog metadata, provider allowlists, legacy model cutover rules, focused tests, and specs that mention the Gemini catalog.
- The same model-catalog scope also covers display-label corrections for active catalog entries.
- No database migration.
- Make-only workflow, no direct Docker/npm commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/fix-gemini-35-thinking`.
- Automated test campaigns run on `ENV=test-fix-gemini-35-thinking`, never on `ENV=dev`.
- In every `make` command, `ENV=test-fix-gemini-35-thinking` must be passed as the last argument when the target accepts an environment.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/providers.ts`
  - `packages/llm-mesh/tests/facade.test.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/services/model-selection-legacy.ts`
  - `api/tests/api/models.test.ts`
  - `api/tests/api/me.test.ts`
  - `api/tests/api/ai-settings.test.ts`
  - `api/tests/api/chat-message-actions.test.ts`
  - `api/tests/unit/chat-service-tools.test.ts`
  - `api/tests/unit/gemini-tool-handoff.test.ts`
  - `api/tests/unit/llm-runtime-stream.test.ts`
  - `api/tests/unit/model-selection-legacy.test.ts`
  - `packages/chat-core/src/runtime.ts`
  - `packages/chat-core/tests/runtime-reasoning-effort.test.ts`
  - `ui/tests/utils/user-ai-settings-events.test.ts`
  - `spec/SPEC_CHATBOT.md`
  - `spec/SPEC_EVOL_LLM_MESH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `PLAN.md`
  - `TODO.md`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `HOTFIX-G35T-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- None.

## AI Flaky tests
- Acceptance rule: only provider/network/model nondeterminism can be accepted as `flaky accepted`, and only after one success on the same commit and command plus explicit user sign-off.
- No flaky test accepted so far.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: hotfix touches one model catalog path and its focused tests.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only.
- Execution flow:
  - [x] Develop and run tests in `tmp/fix-gemini-35-thinking`.
  - [ ] Push branch before UAT.
  - [ ] Run user UAT from root workspace on a UAT branch/worktree if requested.
  - [ ] Switch root back to `main` and continue finalization in `tmp/fix-gemini-35-thinking` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `README.md`, `TODO.md`, and `PLAN.md`.
  - [x] Rebase local `main` on `origin/main`.
  - [x] Create isolated worktree `tmp/fix-gemini-35-thinking`.
  - [x] Confirm branch is `fix/gemini-35-thinking`.
  - [x] Capture Makefile targets needed for debug/testing: `test-llm-mesh`, `typecheck-llm-mesh`, `test-api-unit`, `test-api-endpoints`, `test-ui`, `typecheck-api`, `lint-api`, `test-pkg-chat-core`.
  - [x] Define environment mapping: `ENV=test-fix-gemini-35-thinking`; test ports API `8796`, UI `5186`, Maildev UI `1086`.
  - [x] Confirm command style: `make ... ENV=test-fix-gemini-35-thinking` with `ENV` last.
  - [x] Confirm scope and guardrails.

- [ ] **Lot 1 — Gemini Thinking catalog cutover**
  - [x] Add failing tests that expect Gemini catalog to expose `gemini-3.5-thinking` and no longer expose `gemini-3.1-flash-lite-preview`.
  - [x] Replace the llm-mesh Gemini Flash Lite profile with Gemini 3.5 Thinking.
  - [x] Replace Gemini provider allowlists with `gemini-3.5-thinking`.
  - [x] Add legacy cutovers from `gemini-3.1-flash-lite-preview` and `gemini-2.5-flash-lite` to `gemini-3.5-thinking`.
  - [x] Correct `claude-opus-4-7` display label from `Opus 4.6` to `Opus 4.7`.
  - [x] Update API/UI tests for defaults, model selector payloads, and chat reasoning/tool flows.
  - [x] Update specs to describe Gemini 3.5 Thinking.
  - [ ] Lot gate:
    - [x] Red test observed before implementation: `make test-llm-mesh ENV=test-fix-gemini-35-thinking`.
    - [x] Red test observed for Opus label correction: `make test-llm-mesh ENV=test-fix-gemini-35-thinking` failed on `Opus 4.6` vs `Opus 4.7`.
    - [x] `make test-llm-mesh ENV=test-fix-gemini-35-thinking`.
    - [x] `make test-api-unit SCOPE="tests/unit/model-selection-legacy.test.ts tests/unit/gemini-tool-handoff.test.ts tests/unit/llm-runtime-stream.test.ts tests/unit/chat-service-tools.test.ts" API_PORT=8796 UI_PORT=5186 MAILDEV_UI_PORT=1086 ENV=test-fix-gemini-35-thinking`.
    - [x] `make test-api-endpoints SCOPE="tests/api/models.test.ts tests/api/me.test.ts tests/api/ai-settings.test.ts tests/api/chat-message-actions.test.ts" API_PORT=8796 UI_PORT=5186 MAILDEV_UI_PORT=1086 ENV=test-fix-gemini-35-thinking`.
    - [x] `make test-ui SCOPE=tests/utils/user-ai-settings-events.test.ts API_PORT=8796 UI_PORT=5186 MAILDEV_UI_PORT=1086 ENV=test-fix-gemini-35-thinking`.
    - [x] `make test-pkg-chat-core ENV=test-fix-gemini-35-thinking`.
    - [x] `make typecheck-llm-mesh ENV=test-fix-gemini-35-thinking`.
    - [x] `make typecheck-api API_PORT=8796 UI_PORT=5186 MAILDEV_UI_PORT=1086 ENV=test-fix-gemini-35-thinking`.
    - [x] `make lint-api API_PORT=8796 UI_PORT=5186 MAILDEV_UI_PORT=1086 ENV=test-fix-gemini-35-thinking`.
    - [x] `make typecheck-ui API_PORT=8796 UI_PORT=5186 MAILDEV_UI_PORT=1086 ENV=test-fix-gemini-35-thinking`.

- [ ] **Lot 2 — UAT handoff**
  - [x] Push branch `fix/gemini-35-thinking`.
  - [ ] Web app settings: model selector shows `Gemini 3.5 Thinking` under Gemini.
  - [ ] Web app settings: `Gemini 3.1 Flash Lite` is absent.
  - [ ] Chat model picker shows `Gemini 3.5 Thinking` and can save it as the user default.
  - [ ] Existing Gemini 3.5 Flash remains available.
  - [ ] Legacy saved Gemini Flash Lite defaults migrate to Gemini 3.5 Thinking.

- [ ] **Lot N-1 — Docs consolidation**
  - [x] Confirm no `spec/BRANCH_SPEC_EVOL.md` is needed.
  - [x] Confirm specs touched in Lot 1 are committed.

- [ ] **Lot N — Final validation**
  - [x] Re-read this checklist and confirm all completed boxes are evidence-backed.
  - [x] Push final branch state for UAT.
  - [ ] Record UAT status after user sign-off.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, move branch plan to `plan/done`, push, and merge.
