# Feature: Replace erroneous `gemini-3.5-thinking` model with `gemini-3.1-flash-lite`

## Objective
Remove the non-existent `gemini-3.5-thinking` model (merged by error via commits 8e2ceee3 + 564d4cd5) and set the gemini slot-2 model to `gemini-3.1-flash-lite` (live GA id), which is also the internal evaluator/summary model for the gemini family — restoring `gemini-3.5-flash` to working order. The original pre-merge id `gemini-3.1-flash-lite-preview` is now 404 ("no longer available") on Google, superseded by the GA id without the `-preview` suffix.

## Scope / Guardrails
- Scope limited to the gemini model catalog entry and its references (llm-mesh, api services, chat-core doc, aligned tests).
- No migration files.
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/gemini-revert-35-thinking`.
- Automated tests run on dedicated env (`ENV=test-gemini-revert`), never on root `dev`.
- In every `make` command, `ENV=<env>` is passed last.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/providers.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/tests/**`
  - `packages/chat-core/src/runtime.ts`
  - `packages/chat-core/package.json`
  - `packages/chat-core/tests/**`
  - `api/src/services/chat-service.ts`
  - `api/src/services/model-selection-legacy.ts`
  - `api/tests/**`
  - `ui/tests/**`
  - `spec/SPEC_EVOL_LLM_MESH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (none expected)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRGRT-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- BRGRT-N1 `acknowledge`: live Google API check (user GEMINI key) — `gemini-3.5-flash` 200, `gemini-3.1-flash-lite` 200, `gemini-3.1-flash-lite-preview` 404 (retired), `gemini-3.5-thinking` 404. User confirmed slot-2 target = `gemini-3.1-flash-lite` (GA successor of the retired preview id).
- BRGRT-N2 `acknowledge`: scope widened to `spec/SPEC_CHATBOT.md` (model list) in addition to `spec/SPEC_EVOL_LLM_MESH.md`; both live under non-forbidden `spec/*.md`.
- Legacy cutover migrations added for retired/erroneous ids (`gemini-3.1-flash-lite-preview`, `gemini-3.5-thinking`) → `gemini-3.1-flash-lite` so saved user/workspace defaults do not 404.

## AI Flaky tests
- Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
- Real gemini calls validated manually (Lot 2) count as evidence, not as added timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single, cross-cutting model-name revert; one logical change, one test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch only.
- Real-model verification (Lot 2) executed from the isolated worktree against the live Gemini API.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Create isolated worktree `tmp/gemini-revert-35-thinking` from `origin/main`.
  - [x] Define env mapping and ports: `ENV=test-gemini-revert`, `API_PORT=8795`, `UI_PORT=5185`, `MAILDEV_UI_PORT=1095`.
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — Set gemini slot-2 model across source + tests**
  - [x] `packages/llm-mesh/src/catalog.ts`: slot-2 → `gemini-3.1-flash-lite`, label `Gemini 3.1 Flash Lite`, `reasoningTier: 'standard'`, `defaultTaskHints: ['chat']`, capability tier `standard`.
  - [x] `packages/llm-mesh/src/providers.ts`: replaced in `knownModelIds` and `knownModelIdsByProvider.gemini`.
  - [x] `api/src/services/chat-service.ts`: context-window map, summary model (~791), evaluator model (~2119) → `gemini-3.1-flash-lite`.
  - [x] `api/src/services/model-selection-legacy.ts`: `gemini-2.5-flash-lite` → `gemini-3.1-flash-lite`; added migrations `gemini-3.1-flash-lite-preview` → `gemini-3.1-flash-lite` and `gemini-3.5-thinking` → `gemini-3.1-flash-lite`.
  - [x] `packages/chat-core/src/runtime.ts`: doc-comment example updated.
  - [x] Bumped `packages/llm-mesh/package.json` + `packages/chat-core/package.json` to `0.1.2`.
  - [x] Aligned tests/spec; zero residual `gemini-3.5-thinking` / `gemini-3.1-flash-lite-preview` outside legacy `fromModelId`s.
  - [x] Lot gate (all on `ENV=test-gemini-revert`):
    - [x] `typecheck-llm-mesh` + `typecheck-chat-core` + `typecheck-api` PASS; `build-llm-mesh` + `build-chat-core` PASS.
    - [x] **Package tests**: `test-llm-mesh` PASS (facade), `test-pkg-chat-core` PASS (245).
    - [x] **API tests (scoped to changed files)**: `test-api-unit` 77 passed (model-selection-legacy, chat-service-tools, gemini-tool-handoff, llm-runtime-stream); `test-api-endpoints` 25 passed (models, me, ai-settings, chat-message-actions).
    - [x] **UI tests**: `test-ui SCOPE=tests/utils/user-ai-settings-events.test.ts` 2 passed.

- [x] **Lot 2 — Real-model verification (the core of this fix)**
  - [x] `gemini-3.5-flash` → live `generateContent` HTTP 200 (works).
  - [x] `gemini-3.1-flash-lite` → live `generateContent` HTTP 200 (works) — slot-2 model.
  - [x] `gemini-3.5-thinking` → live HTTP 404 NOT_FOUND (confirms why it was broken) and fully absent from `src/**` (only legacy `fromModelId`).
  - [x] `gemini-3.1-flash-lite-preview` → live HTTP 404 "no longer available" (justifies GA id choice).

- [ ] **Lot N — Final validation**
  - [x] Typecheck + package/api/ui tests green (see Lot 1 gate).
  - [x] Package version bumps done (`@sentropic/llm-mesh` 0.1.2, `@sentropic/chat-core` 0.1.2).
  - [ ] PR using `BRANCH.md` as body.
  - [ ] CI green.
  - [ ] On UAT + CI OK: remove `BRANCH.md`, push, merge.
