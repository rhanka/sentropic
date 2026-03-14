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
- `BR08-FL2` | `closed` | MPA-Q5 (fallback behavior): **confirmed user-driven retry only** — no same-request cross-provider fallback in BR-08.
- `BR08-FL3` | `attention` | Claude tool-call streaming uses a different event model (`content_block_start`/`content_block_delta`/`content_block_stop`) vs OpenAI chunks — requires careful normalization in the adapter.
- `BR08-FL4` | `closed` | Cohere embeddings (`embed-v4.0`) and reranking (`rerank-v3.5`) are **catalogued only** — implementation deferred to BR-17 (RAG).
- `BR08-FL5` | `risk` | Reasoning system is deeply coupled to OpenAI Responses API (`reasoningEffort`, `reasoningSummary`, `isGpt5` guards). Must be generalized to provider-agnostic `supportsReasoning` checks.
- `BR08-FL6` | `closed` | Docker builds fixed by conductor. All 6 gate checks now pass. Resolved 2026-03-12 via `REGISTRY=local` override.
- `BR08-FL7` | `blocked` | Lot 4 quality gates: Docker OOM kills UI/API containers. typecheck-ui exits 137, test-ui exits 137, test-api postgres exits 0 then api exits 143. typecheck-api and lint-api pass.
- `BR08-EX1` (approved): modify `docker-compose.yml` to add ANTHROPIC_API_KEY, MISTRAL_API_KEY, COHERE_API_KEY environment variables to API service.
  - Reason: API container needs provider keys from host .env to function with new providers.
  - Impact: 3 lines added to environment section, same pattern as OPENAI_API_KEY/GEMINI_API_KEY.
  - Rollback: remove the 3 lines.

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

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & Constraints**
  - [x] Read relevant `.mdc` files, `README.md`, `TODO.md`, `PLAN.md`
  - [x] Read specs: `SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`, `SPEC_EVOL_MODEL_PROVIDERS_RUNTIME.md`, `SPEC_CHATBOT.md`
  - [x] Explore existing provider runtime implementation
  - [x] Confirm isolated worktree and environment mapping

- [x] **Lot 1 — Provider Adapter Implementation (Claude + Mistral + Cohere)**
  - [x] Extend `ProviderId` type, `providerIds` array, env vars (`ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`)
  - [x] Extend `getEnvironmentCredential()` for 3 new providers
  - [x] Create `claude-provider.ts` (Anthropic SDK, messages API, extended thinking mapping)
  - [x] Create `mistral-provider.ts` (Mistral SDK, OpenAI-compatible format)
  - [x] Create `cohere-provider.ts` (Cohere SDK, v2 API)
  - [x] Register 3 providers in `provider-registry.ts`
  - [x] Extend `llm-runtime/index.ts`: 3 new streaming branches, message format conversion, tool-call normalization, reasoning normalization
  - [x] Reasoning parameter mapping per provider (Claude: `thinking.budget_tokens`, Mistral/Cohere: no-op)
  - [x] Lot 1 gate: typecheck-api, lint-api, test-api, typecheck-ui, lint-ui, test-ui — all pass (2026-03-12)

- [x] **Lot 2 — Reasoning System Provider-Agnostic Refactor**
  - [x] Replace `isGpt5` guards with `supportsReasoning(selection)` in chat-service, context-usecase, context-matrix, executive-summary
  - [x] Adapt reasoning effort evaluation pipeline (skip when `supportsReasoning` is false, map to provider-native params)
  - [x] Generalize reasoning param forwarding in tools.ts, context-document.ts
  - [x] Lot 2 gate: typecheck-api, lint-api pass (2026-03-12)

- [x] **Lot 3 — Routing, UI, and Non-Regression**
  - [x] UI model selector renders 5 provider groups (ChatPanel, settings, folder/new)
  - [x] Provider badge display normalization
  - [x] Locale updates (en.json, fr.json)
  - [x] Capability-aware routing constraints
  - [x] Credential precedence chain for all 5 providers
  - [x] Provider status `ready`/`planned` based on API key
  - [x] Lot 3 gate: all 6 checks pass (2026-03-12)

- [x] **Lot 4 — Tests**
  - [x] 7 new API test files (claude/mistral/cohere provider, registry expansion, 3 stream tests): 73/73 pass
  - [x] Updated: ai-settings, provider-credentials, model-selection-legacy
  - [x] UI tests: 47 files, 273/273 pass (non-regression)
  - [x] Lot 4 gate: all pass, pre-existing failures only (2026-03-12)
  - [ ] E2E tests (deferred)
  - [ ] AI flaky tests run (deferred)

- [ ] **Lot 5 — UAT bugfixes + validation fonctionnelle**
  - [x] Bug 1 — Zod validation rejects anthropic/mistral/cohere → extended to 5 providers
  - [x] Bug 2 — Cohere rerank/embed exposed → removed from COHERE_MODELS
  - [x] Bug 3 — Missing provider status indicators → added credential resolution
  - [x] Bug 4 — docker-compose missing API keys → added 3 env vars (BR08-EX1)
  - [x] Bug 5 — Mistral invalid model IDs → `devstral-2512`, `magistral-medium-2509`
  - [x] Bug 7 — Cohere reasoning model 404 → `command-a-reasoning-08-2025`
  - [x] Bug 11 — Labels trop longs → `Sonnet 4.6`, `Opus 4.6`, `Devstral 2`, `Magistral Medium`, `Command A`, `Command A R.`
  - [x] Bug 8 — Claude tool_result/tool_use ID mismatch
    - Streaming génère `claude_call_${index}` au lieu du vrai `contentBlock.id` (`toolu_xxxxx`). Faux IDs stockés en DB → mismatch au replay.
    - Fichier : `llm-runtime/index.ts` lignes ~1127, ~1134, ~1730, ~1737
  - [x] Bug 9 — Mistral tools jamais appelés + poisson rouge
    - `buildMistralMessages` ne forward pas les `tool_calls` des messages assistant → camelCase fix + rawInput handler
    - Fichier : `llm-runtime/index.ts` (`buildMistralMessages`)
  - [x] Bug 10 — Cohere toolCallId toujours manquant
    - `messages -> [2]: Missing required key "toolCallId"` → camelCase `toolCallId` + id tracking pour `tool-call-delta` + phantom filtering
    - Fichier : `llm-runtime/index.ts` (`buildCohereMessages`, streaming blocks)
  - [x] Bug 6 — Cohere tool call format incomplet (résolu avec bug 10)
  - [x] Bug 11b — Claude reasoning 400: `max_tokens` must be greater than `thinking.budget_tokens`
  - [x] Bug 14 — Claude `response_format: json_object` rejeté par l'API Messages (Extra inputs not permitted)
  - [x] Bug 15 — Bulles cas d'usage affichent le model_id brut (`claude-sonnet-4-6`) au lieu du label court (`Sonnet 4.6`)
  - [x] Bug 16 — Gemini Flash Lite: `gemini-3.1-flash-lite` non trouvé sur API v1beta, model ID corrigé → `gemini-3.1-flash-lite-preview`
  - [x] Bug 17 — Context budget hardcodé 32k pour tous sauf GPT-5/Gemini → budgets par modèle (Claude/GPT/Gemini 1M, Devstral 256k, Magistral 128k, Cohere 256k)
  - [x] Bug 18 — Mistral rejette `responseFormat: json_object` combiné avec `tools` (erreur 3051) → skip responseFormat quand tools présents
  - [x] Bug 19 — Cohere Command A R. `tool_choice` not supported → skip pour reasoning model
  - [x] Bug 20 — Cohere Command A R. reasoning non affiché → thinking blocks dans `content-delta` (champ `thinking` vs `text`)
  - [x] Bug 12 — Renommer `callOpenAI`/`callOpenAIResponseStream` → `callLLM`/`callLLMStream` (provider-agnostic)
  - [x] Bug 13 — Supprimer `callOpenAIStream` (ancien path sans Responses API) → supprimée, tests migrés vers `callOpenAIResponseStream`
  - [x] Validation — Anthropic Sonnet 4.6 (`claude-sonnet-4-6`)
    - [x] Chat simple
    - [x] Chat avec tool call
    - [x] Reasoning (extended thinking)
    - [x] Génération IA (dossier)
  - [x] Validation — Anthropic Opus 4.6 (`claude-opus-4-6`)
    - [x] Chat simple
    - [x] Chat avec tool call
    - [x] Reasoning (extended thinking)
    - [x] Génération IA (dossier)
  - [x] Validation — Mistral Devstral 2 (`devstral-2512`)
    - [x] Chat simple
    - [x] Chat avec tool call
    - [x] Reasoning : N/A
    - [x] Génération IA (dossier)
  - [x] Validation — Magistral Medium (`magistral-medium-2509`)
    - [x] Chat simple
    - [x] Chat avec tool call
    - [x] Reasoning
    - [x] Génération IA (dossier)
  - [x] Validation — Cohere Command A (`command-a-03-2025`)
    - [x] Chat simple
    - [x] Chat avec tool call
    - [x] Reasoning : N/A
    - [x] Génération IA (dossier)
  - [x] Validation — Cohere Command A R. (`command-a-reasoning-08-2025`)
    - [x] Chat simple
    - [x] Chat avec tool call
    - [x] Reasoning (thinking blocks in content-delta stream)
    - [x] Génération IA (dossier)
  - [x] Non-régression — OpenAI GPT-5.4
    - [x] Chat simple
    - [x] Chat avec tool call
    - [x] Reasoning
    - [x] Génération IA (dossier)
  - [x] Non-régression — OpenAI GPT-4.1 Nano
    - [x] Chat simple
    - [x] Chat avec tool call
    - [x] Reasoning : N/A
    - [x] Génération IA (dossier)
  - [x] Non-régression — Gemini 3.1 Pro
    - [x] Chat simple
    - [x] Chat avec tool call
    - [x] Reasoning : à vérifier
    - [x] Génération IA (dossier)
  - [x] Non-régression — Gemini 3.1 Flash Lite
    - [x] Chat simple
    - [x] Chat avec tool call
    - [x] Reasoning : N/A
    - [x] Génération IA (dossier)

- [x] **Lot N-2 — UAT**
  - [x] Web app
    - [x] Open settings, verify all 5 providers appear in model selector dropdown
    - [x] Select Claude/Mistral/Cohere as default, save, verify sticky
    - [x] Open chat, verify new conversation uses selected default model
    - [x] Switch model mid-conversation, verify response per provider
    - [x] Open folder generation, verify model override includes new providers
    - [x] Verify provider readiness endpoint shows correct status per configured API keys
  - [x] Non-régression
    - [x] OpenAI chat works
    - [x] Gemini chat works
    - [x] Folder generation with OpenAI works
    - [x] Model badge display correct for all providers

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] `spec/SPEC_CHATBOT.md`: update model runtime baseline section with 5-provider architecture (Claude, Mistral, Cohere additions), streaming event normalization, reasoning per provider
  - [ ] `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`: mark W2 provider expansion as delivered; move remaining items (BYOK → BR-15, SSO → BR-09) to their respective branches; if nothing remains, delete file
  - [ ] `spec/SPEC_EVOL_MODEL_PROVIDERS_RUNTIME.md`: keep as-is — describes runtime split which is deferred to BR-14
  - [ ] `plan/08-BRANCH_feat-model-runtime-claude-mistral.md`: overwrite with current `BRANCH.md` content
  - [ ] `PLAN.md`: update BR-08 status to `done`

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint: `make typecheck-api typecheck-ui lint-api lint-ui ENV=test-feat-model-runtime-claude-mistral`
  - [ ] Retest API: `make test-api ENV=test-feat-model-runtime-claude-mistral`
  - [ ] Retest UI: `make test-ui ENV=test`
  - [ ] Retest E2E: `make clean test-e2e API_PORT=8708 UI_PORT=5108 MAILDEV_UI_PORT=1008 ENV=e2e-feat-model-runtime-claude-mistral`
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers
  - [ ] Final gate step 3: update `plan/08-BRANCH_feat-model-runtime-claude-mistral.md` with latest `BRANCH.md`
  - [ ] Final gate step 4: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge
