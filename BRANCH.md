# Feature: Revert erroneous `gemini-3.5-thinking` model to `gemini-3.1-flash-lite-preview`

## Objective
Remove the non-existent `gemini-3.5-thinking` model (merged by error via commits 8e2ceee3 + 564d4cd5) and restore `gemini-3.1-flash-lite-preview`, which is also the internal evaluator/summary model for the gemini family — restoring `gemini-3.5-flash` to working order.

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
- none

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

- [ ] **Lot 1 — Revert model name across source + tests**
  - [ ] `packages/llm-mesh/src/catalog.ts`: `gemini-3.5-thinking` → `gemini-3.1-flash-lite-preview`, label `Gemini 3.5 Thinking` → `Gemini 3.1 Flash Lite`, capability tier `advanced` → `standard` (this entry only).
  - [ ] `packages/llm-mesh/src/providers.ts`: replace in `knownModelIds` and `knownModelIdsByProvider.gemini`.
  - [ ] `api/src/services/chat-service.ts`: context-window map, summary model (line ~791), evaluator model (line ~2119).
  - [ ] `api/src/services/model-selection-legacy.ts`: retarget `gemini-2.5-flash-lite` → `gemini-3.1-flash-lite-preview`; remove self-referential `gemini-3.1-flash-lite-preview` → `gemini-3.5-thinking` rule.
  - [ ] `packages/chat-core/src/runtime.ts`: update doc-comment example.
  - [ ] Bump `packages/llm-mesh/package.json` + `packages/chat-core/package.json` (patch).
  - [ ] Align tests/spec referencing `gemini-3.5-thinking`.
  - [ ] Lot gate:
    - [ ] `make typecheck-api lint-api ENV=test-gemini-revert`
    - [ ] **API tests**
      - [ ] Update: `api/tests/api/me.test.ts`, `api/tests/api/models.test.ts`, `api/tests/api/ai-settings.test.ts`, `api/tests/api/chat-message-actions.test.ts`, `api/tests/unit/model-selection-legacy.test.ts`, `api/tests/unit/chat-service-tools.test.ts`, `api/tests/unit/gemini-tool-handoff.test.ts`, `api/tests/unit/llm-runtime-stream.test.ts`.
      - [ ] Sub-lot gate: `make test-api ENV=test-gemini-revert`
    - [ ] **Package tests**
      - [ ] Update: `packages/llm-mesh/tests/facade.test.ts`, `packages/chat-core/tests/runtime-reasoning-effort.test.ts`.
      - [ ] Sub-lot gate: `make test-packages ENV=test-gemini-revert` (or workspace test target)
    - [ ] **UI tests (TypeScript only)**
      - [ ] Update: `ui/tests/utils/user-ai-settings-events.test.ts`.
      - [ ] Sub-lot gate: `make test-ui ENV=test`

- [ ] **Lot 2 — Real-model verification (the core of this fix)**
  - [ ] Verify `gemini-3.5-flash` returns a real completion (live API) — no `gemini-3.5-thinking` call in the path.
  - [ ] Verify `gemini-3.1-flash-lite-preview` returns a real completion (live API).
  - [ ] Confirm the old erroneous id `gemini-3.5-thinking` is fully absent from `src/**`.
  - [ ] Record evidence in this file.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest API + packages + UI
  - [ ] Confirm package version bumps (CI `enforce-package-bump`)
  - [ ] PR using `BRANCH.md` as body
  - [ ] CI green
  - [ ] On UAT + CI OK: remove `BRANCH.md`, push, merge
