# Refacto: LLM Runtime

## Objective
Refactor the LLM runtime layer from a monolithic 2000+ line file into a well-structured, provider-agnostic architecture. Rename OpenAI-centric function names, split per-provider logic into dedicated modules, and centralize per-model capability matrix.

## Scope / Guardrails
- Scope limited to LLM runtime restructuring (split, rename, capability matrix). No functional change.
- Zero migration in `api/drizzle/*.sql` (pure refactor, no schema change).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/refacto-llm-runtime`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=refacto-llm-runtime` `API_PORT=8714` `UI_PORT=5114` `MAILDEV_UI_PORT=1014`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `e2e/**`
  - `plan/14-BRANCH_refacto-llm-runtime.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `ui/**` (no UI changes expected — pure backend refactor)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**` (CI matrix restructuring for per-provider test isolation)
  - `spec/**`, `PLAN.md`, `TODO.md` (docs consolidation or roadmap sync only)
  - `scripts/**` (only if strictly required)
- **Exception process**:
  - Declare exception ID `BR14-EXn` in this file before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
_(empty — to be populated during implementation)_

## Questions / Notes
- Evaluate if `ChatService` call sites can be updated without UI impact (import path changes only).
- Assess whether per-model capability matrix replaces or complements existing provider-level capabilities.
- Determine granularity: one file per provider vs one file per concern (streaming, messages, tools).

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Pure refactor, single concern, independently mergeable.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot when surface is impacted).
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/refacto-llm-runtime`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/refacto-llm-runtime` after UAT.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read current `llm-runtime/index.ts` structure, identify extraction boundaries.
  - [ ] Confirm isolated worktree and environment mapping.
  - [ ] Inventory all call sites (`chat-service.ts`, tests, other consumers).
  - [ ] Map current provider-specific blocks (OpenAI, Claude, Mistral, Cohere, Gemini) with line ranges.

- [ ] **Lot 1 — Split monolith**
  - [ ] Extract per-provider streaming + message building into dedicated files:
    - `llm-runtime/providers/openai.ts`
    - `llm-runtime/providers/claude.ts`
    - `llm-runtime/providers/mistral.ts`
    - `llm-runtime/providers/cohere.ts`
    - `llm-runtime/providers/gemini.ts`
  - [ ] Keep `llm-runtime/index.ts` as orchestrator (dispatch, shared types, exports).
  - [ ] Extract shared utilities (credential resolution, tool normalization, message conversion).
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-refacto-llm-runtime`
    - [ ] `make lint-api ENV=test-refacto-llm-runtime`
    - [ ] `make test-api ENV=test-refacto-llm-runtime`

- [ ] **Lot 2 — Rename provider-agnostic API**
  - [ ] `callOpenAIResponseStream` → `callProviderStream`
  - [ ] `callOpenAI` → `callProvider`
  - [ ] `CallOpenAIResponseOptions` → `ProviderStreamOptions`
  - [ ] `CallOpenAIOptions` → `ProviderGenerateOptions`
  - [ ] Update all import sites (chat-service, context-usecase, executive-summary, tests).
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-refacto-llm-runtime`
    - [ ] `make lint-api ENV=test-refacto-llm-runtime`
    - [ ] `make test-api ENV=test-refacto-llm-runtime`

- [ ] **Lot 3 — Mutualize & isolate LLM stream tests + CI provider matrix**
  - [ ] Merge 3 duplicated test files (`llm-runtime-{claude,mistral,cohere}-stream.test.ts`) into single `llm-runtime-stream.test.ts` with shared mocks, shared `collectStreamEvents`, and `describe.each` provider/model matrix.
  - [ ] Add missing provider stream tests (OpenAI, Gemini) in the same matrix.
  - [ ] Separate CI test suites: deterministic unit stream tests stay in `unit` job; AI integration tests (`api/tests/ai/`) split by provider into dedicated matrix entries (`ai-openai`, `ai-anthropic`, `ai-mistral`, `ai-cohere`, `ai-gemini`).
  - [ ] Create make targets `test-api-ai-<provider>` (file pattern or vitest tag filtering).
  - [ ] Update `.github/workflows/ci.yml` `test-api-unit-integration` matrix: replace single `ai` entry with per-provider `ai-<provider>` entries.
  - [ ] Validate flaky isolation: each provider failure is independent, does not block other providers.
  - [ ] Lot 3 gate:
    - [ ] `make typecheck-api ENV=test-refacto-llm-runtime`
    - [ ] `make lint-api ENV=test-refacto-llm-runtime`
    - [ ] `make test-api ENV=test-refacto-llm-runtime`

- [ ] **Lot 4 — Per-model capability matrix**
  - [ ] Evaluate and design centralized model capability registry:
    - Context window size
    - Reasoning support (+ parameter mapping)
    - Tool support / tool_choice support
    - Response format support (json_object, structured output)
    - Streaming event format specifics
  - [ ] Consolidate scattered capability checks:
    - `MODEL_CONTEXT_BUDGETS` in chat-service.ts
    - `supportsReasoning` / `supportsTools` in provider files
    - Inline conditionals (`selectedModel.includes('reasoning')`, `isGpt5`, etc.)
  - [ ] Lot 4 gate:
    - [ ] `make typecheck-api ENV=test-refacto-llm-runtime`
    - [ ] `make lint-api ENV=test-refacto-llm-runtime`
    - [ ] `make test-api ENV=test-refacto-llm-runtime`

- [ ] **Lot N-2 — UAT**
  - [ ] Web app
    - [ ] Verify all 5 providers still work (chat, tools, reasoning, generation)
    - [ ] Non-regression on all existing flows

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `spec/SPEC_CHATBOT.md` runtime architecture section.
  - [ ] Update `PLAN.md` BR-14 status to `done`.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
