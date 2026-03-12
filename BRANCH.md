# Feature: Model Runtime Claude + Mistral + Cohere (BR-08)

## Objective
Expand the multi-provider AI runtime from 2 providers (OpenAI, Gemini) to 5 providers by adding Anthropic Claude, Mistral AI, and Cohere adapters. Preserve streaming/tool-call orchestration parity and extend the model catalog, credential resolution, and UI selectors accordingly.

## Scope / Guardrails
- Scope limited to provider adapters, model catalog expansion, credential resolution, routing/fallback policy, and UI model selectors.
- One migration max in `api/drizzle/*.sql` (if applicable — likely not needed, no schema change expected).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-model-runtime-claude-mistral-cohere`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-model-runtime-claude-mistral` `API_PORT=8708` `UI_PORT=5108` `MAILDEV_UI_PORT=1008`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `plan/08-BRANCH_feat-model-runtime-claude-mistral.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except BR-08 file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file — unlikely needed)
  - `.github/workflows/**`
  - `spec/**`, `PLAN.md`, `TODO.md` (docs consolidation or roadmap sync only)
  - `scripts/**` (only if strictly required)
- **Exception process**:
  - Declare exception ID `BR08-EXn` in `## Feedback Loop` before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `BR08-FL1` | `attention` | Cohere SDK has no official TypeScript SDK with streaming parity — may need raw HTTP adapter (like Gemini). Assess during Lot 1.
- `BR08-FL2` | `clarification` | MPA-Q5 (fallback behavior): recommend user-driven retry only (no same-request fallback across providers) for initial implementation.
- `BR08-FL3` | `attention` | Claude tool-call streaming uses a different event model (`content_block_start`/`content_block_delta`/`content_block_stop`) vs OpenAI chunks — requires careful normalization in the adapter.

## Questions / Notes
- MPA-Q4: Provider request/response retention compliance baseline — deferred, no impact on adapter implementation.
- MPA-Q5: Fallback behavior in same request vs user-driven retry — recommend user-driven retry for BR-08.
- Cohere embeddings and reranking capabilities are catalogued but implementation of actual embedding/reranking endpoints is deferred to BR-17 (RAG).
- Tool-call support parity: Claude supports tools natively; Mistral supports tools; Cohere supports tools. All three support streaming.

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
- Rationale: This branch is scoped to one capability (provider expansion) and remains independently mergeable. All three providers follow the same adapter pattern.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot when UI/plugin surface is impacted).
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-model-runtime-claude-mistral-cohere`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-model-runtime-claude-mistral-cohere` after UAT.

---

## Existing Architecture Summary

### Provider abstraction (delivered in BR-01)
- **`ProviderRuntime` interface** (`api/src/services/provider-runtime.ts`): defines `listModels()`, `generate()`, `streamGenerate()`, `validateCredential()`, `normalizeError()`.
- **`ProviderId` type**: currently `'openai' | 'gemini'` — must be extended to `'openai' | 'gemini' | 'claude' | 'mistral' | 'cohere'`.
- **`ProviderRegistry`** (`api/src/services/provider-registry.ts`): singleton map `ProviderId -> ProviderRuntime`. Constructor instantiates OpenAI + Gemini. New providers register here.
- **Provider implementations**:
  - `api/src/services/providers/openai-provider.ts` — uses `openai` npm SDK, supports Chat Completions + Responses API modes, Codex transport.
  - `api/src/services/providers/gemini-provider.ts` — raw HTTP + SSE parsing (no SDK), custom `readSse()` generator.
- **LLM Runtime orchestrator** (`api/src/services/llm-runtime/index.ts`): ~1000+ lines. Contains `callOpenAI()`, `callOpenAIStream()`, `callOpenAIResponseStream()`. Each function dispatches to the correct provider based on `selection.providerId` with if/else branching (`if (selection.providerId === 'gemini') { ... } else { /* openai */ }`). This is the main integration point for new providers.
- **Model catalog** (`api/src/services/model-catalog.ts`): exposes `getModelCatalogPayload()` which aggregates providers + models + user defaults. Served via `GET /api/v1/models/catalog`.
- **Credential resolution** (`api/src/services/provider-credentials.ts`): precedence chain: request override > user BYOK > workspace key > environment variable. `getEnvironmentCredential()` currently only handles `openai` and `gemini`.
- **Model selection legacy** (`api/src/services/model-selection-legacy.ts`): handles old model ID migration rules.
- **Chat service** (`api/src/services/chat-service.ts`): consumes `callOpenAI`, `callOpenAIResponseStream` from `llm-runtime/index.ts`. Does NOT directly reference providers.
- **Env config** (`api/src/config/env.ts`): has `OPENAI_API_KEY` and `GEMINI_API_KEY`. Must add `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`.

### Stream event normalization
All providers must emit identical `StreamEvent` types: `status`, `reasoning_delta`, `content_delta`, `tool_call_start`, `tool_call_delta`, `tool_call_result`, `error`, `done`.

### Tool-call orchestration
- OpenAI: native tool_calls in chat completion chunks (index-based tracking).
- Gemini: `functionCall` in content parts, normalized to `tool_call_start` events.
- Claude: will use `content_block_start`/`content_block_delta`/`content_block_stop` with `type: 'tool_use'`.
- Mistral: OpenAI-compatible tool_calls format.
- Cohere: tool_calls in streaming chunks with `tool-call-start`/`tool-call-delta` event types.

---

## Plan / Todo (lot-based)

### Lot 0 — Baseline & Constraints (READ-ONLY SCOPING)
- [x] Read relevant `.mdc` files (`workflow.mdc`, `MASTER.mdc`, `subagents.mdc`, `architecture.mdc`, `testing.mdc`).
- [x] Read `README.md`, `TODO.md`, `PLAN.md`.
- [x] Read `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`, `spec/SPEC_EVOL_MODEL_PROVIDERS_RUNTIME.md`, `spec/SPEC_CHATBOT.md`.
- [x] Read `plan/08-BRANCH_feat-model-runtime-claude-mistral.md`, `plan/BRANCH_TEMPLATE.md`.
- [x] Explore existing provider runtime implementation.
- [x] Confirm isolated worktree and environment mapping.
- [x] Capture architecture summary and per-provider adapter assessment.
- [x] Create detailed BRANCH.md (this file).

### Lot 1 — Provider Adapter Implementation (Claude + Mistral + Cohere)

#### 1.1 Core type and registry extension
- [ ] Extend `ProviderId` type in `api/src/services/provider-runtime.ts`: add `'claude' | 'mistral' | 'cohere'`.
- [ ] Update `providerIds` array in same file.
- [ ] Add env vars to `api/src/config/env.ts`: `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY` (all optional).
- [ ] Extend `getEnvironmentCredential()` in `api/src/services/provider-credentials.ts` for the 3 new providers.

#### 1.2 Claude (Anthropic) adapter
- [ ] Create `api/src/services/providers/claude-provider.ts`:
  - Install `@anthropic-ai/sdk` via `make install-api @anthropic-ai/sdk`.
  - Implement `ClaudeProviderRuntime` class with `ProviderRuntime` interface.
  - Model catalog entries: `claude-sonnet-4` (advanced, tools+streaming), `claude-haiku-4` (light, tools+streaming).
  - `validateCredential()`: check `ANTHROPIC_API_KEY` or override.
  - `generate()`: use `client.messages.create()` (non-streaming).
  - `streamGenerate()`: use `client.messages.stream()`, return async iterable.
  - `normalizeError()`: map Anthropic error codes to `NormalizedProviderError`.

#### 1.3 Mistral adapter
- [ ] Create `api/src/services/providers/mistral-provider.ts`:
  - Install `@mistralai/mistralai` via `make install-api @mistralai/mistralai`.
  - Implement `MistralProviderRuntime` class with `ProviderRuntime` interface.
  - Model catalog entries: `mistral-large-latest` (advanced, tools+streaming), `mistral-small-latest` (light, tools+streaming).
  - `validateCredential()`: check `MISTRAL_API_KEY` or override.
  - `generate()`: use Mistral chat completions (OpenAI-compatible format).
  - `streamGenerate()`: use Mistral streaming, return async iterable.
  - `normalizeError()`: map Mistral error codes.

#### 1.4 Cohere adapter
- [ ] Create `api/src/services/providers/cohere-provider.ts`:
  - Install `cohere-ai` via `make install-api cohere-ai`.
  - Implement `CohereProviderRuntime` class with `ProviderRuntime` interface.
  - Model catalog entries: `command-r-plus` (advanced, tools+streaming), `command-r` (standard, tools+streaming).
  - Note: Cohere also supports embeddings (`embed-v4.0`) and reranking (`rerank-v3.5`) — catalog these as `defaultContexts: ['embedding']` / `['reranking']` but defer actual embedding/reranking endpoint implementation to BR-17.
  - `validateCredential()`: check `COHERE_API_KEY` or override.
  - `generate()`: use `client.chat()` (v2 API).
  - `streamGenerate()`: use `client.chatStream()` (v2 API), return async iterable.
  - `normalizeError()`: map Cohere error codes.

#### 1.5 Registry wiring
- [ ] Update `api/src/services/provider-registry.ts`: instantiate and register `ClaudeProviderRuntime`, `MistralProviderRuntime`, `CohereProviderRuntime` in the constructor Map.

#### 1.6 LLM Runtime orchestrator extension
- [ ] Update `api/src/services/llm-runtime/index.ts`:
  - Add `getClaudeProvider()`, `getMistralProvider()`, `getCohereProvider()` helper functions.
  - Extend `callOpenAI()` with Claude/Mistral/Cohere non-streaming branches (message format conversion, response normalization to `ChatCompletion`-compatible shape).
  - Extend `callOpenAIStream()` with Claude/Mistral/Cohere streaming branches (stream event normalization to `StreamEvent`).
  - Extend `callOpenAIResponseStream()` with Claude/Mistral/Cohere streaming branches (including tool-call continuation semantics, structured output support where available).
  - For each new provider, implement message format conversion from OpenAI messages format to provider-native format (similar to `buildGeminiRequestBody`).
  - For each new provider, implement stream chunk normalization to `StreamEvent` types (similar to Gemini stream chunk parsing).

#### 1.7 Lot 1 gate
- [ ] `make typecheck-api ENV=test-feat-model-runtime-claude-mistral`
- [ ] `make lint-api ENV=test-feat-model-runtime-claude-mistral`
- [ ] `make test-api ENV=test-feat-model-runtime-claude-mistral`
- [ ] `make typecheck-ui ENV=test-feat-model-runtime-claude-mistral`
- [ ] `make lint-ui ENV=test-feat-model-runtime-claude-mistral`
- [ ] `make test-ui ENV=test-feat-model-runtime-claude-mistral`

### Lot 2 — Routing, UI, and Non-Regression

#### 2.1 UI model selector updates
- [ ] Update `ui/src/lib/components/ChatPanel.svelte`: ensure grouped model selector renders 5 provider groups.
- [ ] Update `ui/src/routes/settings/+page.svelte`: ensure provider/model dropdowns include new providers.
- [ ] Update `ui/src/routes/folder/new/+page.svelte`: ensure model override includes new providers.
- [ ] Verify provider badge display normalization for long model IDs (like Gemini compaction pattern).
- [ ] Update `ui/src/locales/en.json` and `ui/src/locales/fr.json` with provider labels if needed.

#### 2.2 Routing hardening
- [ ] Add provider routing constraints: capability-aware selection (e.g., if a provider does not support structured output, route to fallback).
- [ ] Validate chat and structured flows across all 5 providers.
- [ ] Verify credential precedence chain works for all 5 providers.
- [ ] Verify provider status is `'ready'` when API key is configured, `'planned'` otherwise.

#### 2.3 Lot 2 gate
- [ ] `make typecheck-api ENV=test-feat-model-runtime-claude-mistral`
- [ ] `make lint-api ENV=test-feat-model-runtime-claude-mistral`
- [ ] `make test-api ENV=test-feat-model-runtime-claude-mistral`
- [ ] `make typecheck-ui ENV=test-feat-model-runtime-claude-mistral`
- [ ] `make lint-ui ENV=test-feat-model-runtime-claude-mistral`
- [ ] `make test-ui ENV=test-feat-model-runtime-claude-mistral`

### Lot 3 — Tests

#### 3.1 API tests
- [ ] **Existing tests to update**:
  - `api/tests/api/models.test.ts` — verify catalog returns 5 providers and expected models.
  - `api/tests/api/ai-settings.test.ts` — verify default selection with new providers.
  - `api/tests/unit/provider-credentials.test.ts` — add credential resolution cases for claude/mistral/cohere.
  - `api/tests/unit/model-selection-legacy.test.ts` — verify no regression with new provider IDs.
  - `api/tests/unit/gemini-provider-sse.test.ts` — no change expected (Gemini-specific).
  - `api/tests/unit/gemini-response-schema.test.ts` — no change expected.
  - `api/tests/unit/gemini-tool-handoff.test.ts` — no change expected.
- [ ] **New tests to create**:
  - `api/tests/unit/claude-provider.test.ts` — unit test for Claude adapter (mock SDK, validate generate/streamGenerate/validateCredential/normalizeError).
  - `api/tests/unit/mistral-provider.test.ts` — unit test for Mistral adapter.
  - `api/tests/unit/cohere-provider.test.ts` — unit test for Cohere adapter.
  - `api/tests/unit/provider-registry-expansion.test.ts` — verify registry lists all 5 providers with correct capabilities.
  - `api/tests/unit/llm-runtime-claude-stream.test.ts` — verify Claude stream event normalization.
  - `api/tests/unit/llm-runtime-mistral-stream.test.ts` — verify Mistral stream event normalization.
  - `api/tests/unit/llm-runtime-cohere-stream.test.ts` — verify Cohere stream event normalization.
- [ ] Scoped runs: `make test-api-endpoints SCOPE=tests/unit/claude-provider.test.ts ENV=test-feat-model-runtime-claude-mistral`
- [ ] Sub-lot gate: `make test-api ENV=test-feat-model-runtime-claude-mistral`
- [ ] AI flaky tests run: `make test-api-ai ENV=test-feat-model-runtime-claude-mistral` (non-blocking, document signature)

#### 3.2 UI tests (TypeScript only)
- [ ] **Existing tests to verify** (no changes expected, non-regression):
  - `ui/tests/` — verify existing model selection tests pass with expanded catalog.
- [ ] Sub-lot gate: `make test-ui ENV=test`

#### 3.3 E2E tests
- [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=8708 UI_PORT=5108 MAILDEV_UI_PORT=1008 ENV=e2e-feat-model-runtime-claude-mistral`
- [ ] **Existing E2E tests to verify** (non-regression):
  - `e2e/tests/03-chat.spec.ts` — verify chat works with default provider (AI flaky allowlist).
  - `e2e/tests/00-ai-generation.spec.ts` — verify generation works (AI flaky allowlist).
- [ ] Sub-lot gate: `make clean test-e2e API_PORT=8708 UI_PORT=5108 MAILDEV_UI_PORT=1008 ENV=e2e-feat-model-runtime-claude-mistral`
- [ ] AI flaky tests run (non-blocking only under acceptance rule)

### Lot N-2 — UAT
- [ ] Web app
  - [ ] Start branch environment: `make dev API_PORT=8708 UI_PORT=5108 MAILDEV_UI_PORT=1008 ENV=feat-model-runtime-claude-mistral`
  - [ ] **Evolution tests**:
    - [ ] Open settings, verify all 5 providers appear in model selector dropdown.
    - [ ] Select a Claude model as default, save, verify sticky.
    - [ ] Select a Mistral model as default, save, verify sticky.
    - [ ] Select a Cohere model as default, save, verify sticky.
    - [ ] Open chat, verify new conversation uses selected default model.
    - [ ] Switch model mid-conversation to Claude, send message, verify response.
    - [ ] Switch model mid-conversation to Mistral, send message, verify response.
    - [ ] Switch model mid-conversation to Cohere, send message, verify response.
    - [ ] Open folder generation, verify model override includes new providers.
    - [ ] Verify provider readiness endpoint shows correct status per configured API keys.
  - [ ] **Non-regression tests**:
    - [ ] Verify OpenAI chat still works (no regression).
    - [ ] Verify Gemini chat still works (no regression).
    - [ ] Verify folder generation with OpenAI works.
    - [ ] Verify user BYOK credential flow works for OpenAI/Gemini.
    - [ ] Verify model badge display is correct for all providers.

### Lot N-1 — Docs consolidation
- [ ] Update `spec/SPEC_CHATBOT.md` model runtime baseline section: add Claude, Mistral, Cohere to delivered providers list.
- [ ] Update `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`: mark W2 provider expansion as delivered.
- [ ] Update `plan/08-BRANCH_feat-model-runtime-claude-mistral.md` status.
- [ ] Update `PLAN.md` BR-08 status to `done`.

### Lot N — Final validation
- [ ] Typecheck & Lint: `make typecheck-api typecheck-ui lint-api lint-ui ENV=test-feat-model-runtime-claude-mistral`
- [ ] Retest API: `make test-api ENV=test-feat-model-runtime-claude-mistral`
- [ ] Retest UI: `make test-ui ENV=test`
- [ ] Retest E2E: `make clean test-e2e API_PORT=8708 UI_PORT=5108 MAILDEV_UI_PORT=1008 ENV=e2e-feat-model-runtime-claude-mistral`
- [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures.
- [ ] Record explicit user sign-off if any AI flaky test is accepted.
- [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
- [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
- [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.

---

## Per-Provider Adapter Assessment

### Claude (Anthropic)
- **SDK**: `@anthropic-ai/sdk` (official TypeScript SDK, well-maintained).
- **Streaming**: Native streaming via `client.messages.stream()` returns `MessageStream` with event emitter pattern. Events: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`.
- **Tool calls**: Supported via `content_block_start` with `type: 'tool_use'` + `content_block_delta` with `type: 'input_json_delta'`. Args are streamed as JSON deltas.
- **Structured output**: Supported via `tool_use` pattern (no native JSON mode like OpenAI, but can be worked around).
- **Message format**: Different from OpenAI — uses `role: 'user' | 'assistant'`, system prompt is a separate top-level field, no `developer` role. Tool results are `tool_result` content blocks.
- **Complexity**: Medium. Stream event normalization requires mapping Anthropic's block-based events to the flat `StreamEvent` model.
- **Risk**: Low. SDK is mature and widely used.

### Mistral
- **SDK**: `@mistralai/mistralai` (official TypeScript SDK).
- **Streaming**: Uses OpenAI-compatible chat completions streaming (SSE chunks with `choices[0].delta`).
- **Tool calls**: OpenAI-compatible `tool_calls` in delta chunks.
- **Structured output**: Supported via `response_format: { type: 'json_object' }`.
- **Message format**: OpenAI-compatible (`role: 'system' | 'user' | 'assistant' | 'tool'`).
- **Complexity**: Low. Most similar to OpenAI, minimal message format conversion needed.
- **Risk**: Low. OpenAI-compatible format reduces normalization work.

### Cohere
- **SDK**: `cohere-ai` (official TypeScript SDK).
- **Streaming**: V2 API uses `client.v2.chatStream()` returning events: `message-start`, `content-start`, `content-delta`, `content-end`, `tool-call-start`, `tool-call-delta`, `tool-call-end`, `message-end`.
- **Tool calls**: Supported via `tool-call-start`/`tool-call-delta`/`tool-call-end` events.
- **Structured output**: Supported via `response_format: { type: 'json_object' }` in v2 API.
- **Message format**: V2 API is OpenAI-compatible. Uses `role: 'system' | 'user' | 'assistant' | 'tool'`.
- **Complexity**: Medium. Event model is different from both OpenAI and Anthropic, needs custom normalization. Also has unique capabilities (embeddings, reranking) to catalog.
- **Risk**: Low-medium. SDK is stable but less commonly used in this project's stack.
- **Future value**: Embed and rerank capabilities position Cohere for BR-17 (RAG) integration.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| LLM runtime orchestrator is large (~1000+ lines) with provider-specific if/else branching | Medium | Add new branches following existing Gemini pattern; refactor to dispatch table is deferred to avoid regression risk |
| Claude stream event model is block-based (different from OpenAI chunk-based) | Medium | Map `content_block_start/delta/stop` to `tool_call_start/delta`, `content_delta` in adapter |
| Provider SDK version instability | Low | Pin SDK versions; use semantic versioning |
| Cohere SDK may have limited TypeScript streaming support | Low | Fall back to raw HTTP if SDK streaming is unreliable (like Gemini approach) |
| Regression in existing OpenAI/Gemini flows when extending orchestrator | Medium | Comprehensive unit tests per provider + non-regression API/E2E tests |
| 3 new npm dependencies increase API image size | Low | Dependencies are necessary; monitor bundle size |

---

## Files Impact Summary

### New files
- `api/src/services/providers/claude-provider.ts`
- `api/src/services/providers/mistral-provider.ts`
- `api/src/services/providers/cohere-provider.ts`
- `api/tests/unit/claude-provider.test.ts`
- `api/tests/unit/mistral-provider.test.ts`
- `api/tests/unit/cohere-provider.test.ts`
- `api/tests/unit/provider-registry-expansion.test.ts`
- `api/tests/unit/llm-runtime-claude-stream.test.ts`
- `api/tests/unit/llm-runtime-mistral-stream.test.ts`
- `api/tests/unit/llm-runtime-cohere-stream.test.ts`

### Modified files
- `api/src/services/provider-runtime.ts` (extend ProviderId type)
- `api/src/services/provider-registry.ts` (register 3 new providers)
- `api/src/services/provider-credentials.ts` (extend getEnvironmentCredential)
- `api/src/services/llm-runtime/index.ts` (add provider dispatch branches)
- `api/src/services/model-catalog.ts` (no changes expected — generic over providers)
- `api/src/config/env.ts` (add 3 new API key env vars)
- `api/package.json` (add 3 new dependencies)
- `ui/src/lib/components/ChatPanel.svelte` (verify grouped selector works with 5 providers)
- `ui/src/routes/settings/+page.svelte` (verify model selector)
- `ui/src/routes/folder/new/+page.svelte` (verify model override)
- `ui/src/locales/en.json`, `ui/src/locales/fr.json` (provider labels if needed)

### Existing tests to verify (non-regression)
- `api/tests/api/models.test.ts`
- `api/tests/api/ai-settings.test.ts`
- `api/tests/unit/provider-credentials.test.ts`
- `api/tests/unit/model-selection-legacy.test.ts`
- `api/tests/unit/gemini-provider-sse.test.ts`
- `api/tests/unit/gemini-response-schema.test.ts`
- `api/tests/unit/gemini-tool-handoff.test.ts`
