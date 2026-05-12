# SPEC EVOL - Model Providers Runtime (OpenAI/Gemini/...)

Status: **Delivered** (via `feat/model-runtime-openai-gemini` merged to main). Architecture implemented in `api/src/services/llm-runtime/`, `api/src/services/providers/`, and `api/src/services/provider-registry.ts`. Not part of BR-04 scope.

BR-14c successor note: `feat/llm-mesh-sdk` keeps the delivered provider adapters server-side, but moves public model-access contracts and runtime dispatch selection into `@sentropic/llm-mesh`. After BR-14c, app code must consume model access through the mesh-backed `llm-runtime` boundary; direct app-local provider selector ownership must not be reintroduced.

## 1) Objective
Define a clean provider-runtime architecture with strict ownership boundaries across model providers, and remove mixed-provider implementation paths.

## 2) Problem statement
Current runtime code mixes provider-specific behavior in a misleadingly named file (`api/src/services/openai.ts`) that also contains Gemini request/stream paths. This creates:
- weak ownership boundaries,
- maintenance ambiguity,
- increased regression risk for tool-call continuation and SSE parity.

## 3) Decision (strict cutover)
- Big-bang migration only (no dual code path, no compatibility bridge, no fallback alias).
- `openai.ts` must become OpenAI-only or be fully replaced by neutral orchestration modules.
- Gemini logic must not remain in an `openai*` service file after cutover.

## 4) Target architecture
- `api/src/services/llm-runtime/`:
  - provider-agnostic orchestrator + shared stream event normalization contract.
- `api/src/services/providers/openai/`:
  - OpenAI-only request/stream implementation.
- `api/src/services/providers/gemini/`:
  - Gemini-only request/stream implementation.
- `api/src/services/chat-service.ts`:
  - consumes only orchestrator contracts, never provider-specific mixed files.

## 5) Contract requirements
- Keep identical public stream semantics (`status`, `tool_call_start`, `tool_call_delta`, `tool_call_result`, `done`, `error`).
- Preserve local-tool handoff behavior (`awaiting_local_tool_results` -> tool-results -> resume).
- Preserve model/provider routing behavior and credential precedence.
- Preserve existing SSE/event ordering guarantees.

## 6) Migration constraints
- Direct replacement in one branch slice (big-bang), no temporary alias exports.
- Remove obsolete mixed-provider code paths in same change-set.
- Keep data model unchanged (no schema migration expected for this refactor).

## 7) Acceptance criteria
- No Gemini code remains in `openai.ts` (or file removed/renamed away from provider-specific ambiguity).
- Provider-specific units pass (`openai` and `gemini` stream + tool-call continuation tests).
- Chat scoped non-reg passes for OpenAI and Gemini local-tool flows.
- VSCode and web chat keep identical resume semantics after local tool results.
