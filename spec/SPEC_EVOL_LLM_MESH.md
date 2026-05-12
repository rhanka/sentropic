# SPEC EVOL - LLM Mesh

Status: In progress for BR-14c; runtime cutover scope reopened on 2026-05-07, npm publication scope added on 2026-05-08, package/runtime cutover implemented on branch.

Owner branch: `feat/llm-mesh-sdk`.

Related orchestration spec: `spec/SPEC_EVOL_SENTROPIC_BR14_ORCHESTRATION.md`.

## Objective

Define `@sentropic/llm-mesh`, the first standalone Sentropic npm service. The package must provide a provider-agnostic model access contract for OpenAI, Anthropic/Claude, Google/Gemini, Mistral, and Cohere, become the application LLM runtime in BR-14c through a strict cutover, and be published through CI/CD as the first `@sentropic` npm library.

This spec owns the durable classification of reusable LLM runtime functions, current code usage validation, external framework comparison, and scope decisions for BR-14c. After BR-14c, it remains the transition reference for the model catalog pivot in BR-14g and chat-service modularization above the runtime in BR-14b.

## BR-14c Implementation Snapshot

BR-14c establishes `packages/llm-mesh` as a contract-first TypeScript package with:

- Public provider and model identifiers for OpenAI, Google Gemini, Anthropic Claude, Mistral, and Cohere.
- Model-profile-first capabilities using explicit `supported`, `unsupported`, `partial`, and `unknown` states.
- Normalized request, response, streaming, tool-use, structured-output, retryable-error, and auth contracts.
- Redacted `AuthDescriptor` surfaces separated from server-only `SecretAuthMaterial`.
- Codex account auth represented as an account transport, with Gemini Code Assist and Claude Code left as planned extension hooks.
- Deterministic provider adapter scaffolds with injected clients.
- A minimal `createLlmMesh` facade with registry, auth resolver, hooks, `generate()`, and `stream()`.
- A real API workspace import of `@sentropic/llm-mesh` through `api/src/services/llm-runtime/mesh-dispatch.ts`.
- Application runtime dispatch for `callLLM` and `callLLMStream` routed through the mesh facade.
- Replaced app-local runtime dispatch selectors removed; provider SDK clients remain server-only implementation details behind the mesh adapter boundary.
- API provider runtimes derive provider descriptors, model lists, and capability booleans from the `@sentropic/llm-mesh` catalog; there is no second app-local model/capability catalog.
- Package metadata, README, dist build, pack validation, and CI/CD npm publication wiring for `@sentropic/llm-mesh@0.1.0`.
- Make-backed dev/test startup preparation for mounted workspace `node_modules` and package `dist/` artifacts, so branch UAT/dev stacks consume the real package import instead of a relative source path.

Validated branch state after rebase on the post-PR #139 `main` baseline:

- `make typecheck-llm-mesh API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-feat-llm-mesh-sdk`
- `make test-llm-mesh API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-feat-llm-mesh-sdk`
- `make pack-llm-mesh API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-feat-llm-mesh-sdk`
- `make typecheck-api API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-feat-llm-mesh-sdk`
- `make lint-api API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-feat-llm-mesh-sdk`
- `make up-api-test API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-feat-llm-mesh-sdk`
- `make test-api-unit API_PORT=8714 UI_PORT=5114 MAILDEV_UI_PORT=1014 ENV=test-feat-llm-mesh-sdk` — 59 files passed, 472 passed, 8 skipped.

Remaining before PR completion:

- Run credential-gated live AI split tests when branch credentials are available.
- Push the branch and verify CI package validation is triggered by `packages/llm-mesh/**`.
- Validate root UAT chat streaming against the mesh-backed runtime before merge.
- After merge, confirm the `main` npm publication job either publishes `@sentropic/llm-mesh@0.1.0` or explicitly skips because that exact version already exists.

BR-14c must keep:

- Provider credential precedence, quota logic, retry behavior, streaming order, tool-call continuation, reasoning controls, trace/audit metadata, and live AI behavior.
- Chat-service orchestration above the model runtime; BR-14c may update call sites but must not modularize the full chat-service reasoning/tool loop.

BR-14c intentionally does not:

- Extract chat UI behavior. BR-14a owns `@sentropic/chat`.
- Modularize the full chat-service reasoning/tool loop. BR-14b owns chat-service core modularization above the mesh runtime.
- Update GPT-5.4 / Claude Opus 4.6 catalog versions; BR-14g owns the GPT-5.5 / Opus 4.7 pivot.

## As-Is Runtime Contract Inventory and BR-14c Test Mapping

This inventory is the BR-14c freeze point for the application model-access contract. The package contract must map the current application runtime behavior; it must not reinterpret provider semantics while extracting `@sentropic/llm-mesh`.

Contract sources:

- Stable runtime catalog: `@sentropic/llm-mesh` model profiles, exposed to the API through `api/src/services/provider-runtime.ts` and `api/src/services/provider-registry.ts`.
- Stable app stream normalizer: `api/src/services/llm-runtime/index.ts`.
- Stable chat-visible boundary: assistant message `content` is built from `content_delta`; reasoning is stored separately from `reasoning_delta`.
- Package boundary: `packages/llm-mesh/src/*`.

Normalized event rules:

- Provider-visible text becomes `content_delta`.
- Provider-native thinking, thought, reasoning, tool-plan, or reasoning-summary chunks become `reasoning_delta`.
- Provider-native function/tool calls become `tool_call_start` and, when the provider streams arguments, `tool_call_delta`.
- Local tool execution results remain above the model runtime and are emitted by chat orchestration as `tool_call_result`.
- `reasoning_delta` must never be concatenated into assistant visible content.
- Gemini reasoning requests keep the legacy provider contract: when `reasoningEffort` is present and not `none`, `generationConfig.thinkingConfig` contains `thinkingBudget` and `includeThoughts: true`; when reasoning is not requested, no Gemini thinking config is sent.

Coverage invariant:

- `api/tests/unit/llm-runtime-stream.test.ts` owns the provider stream normalization matrix.
- The matrix must include every model returned by `providerRegistry.listModels()`.
- If a catalog model advertises `supportsTools`, the matrix must include a tool fixture for that exact model.
- If a catalog model has `reasoningTier !== "none"`, the matrix must include a reasoning fixture for that exact model.
- `api/tests/unit/provider-mesh-contract-proof.test.ts` must verify that package model profiles stay aligned with the application runtime catalog for provider ID, model ID, label, reasoning tier, and non-unsupported advertised tools/streaming/reasoning capabilities.
- `packages/llm-mesh/tests/facade.test.ts` must verify that reasoning-capable package models are not marked as `unsupported`.

| Provider/model | As-is provider stream shape | Normalized contract | Required tests |
| --- | --- | --- | --- |
| OpenAI `gpt-4.1-nano` | Responses `response.output_text.delta`; function-call item and argument deltas; no reasoning tier. | `content_delta`, `tool_call_start`, `tool_call_delta`, no `reasoning_delta` requirement. | `llm-runtime-stream` matrix content/tool row; GPT-4.1 Nano reasoning stripping test. |
| OpenAI `gpt-5.4` | Responses output text, reasoning text / reasoning summary events, function-call argument deltas. | `content_delta`, `reasoning_delta`, `tool_call_start`, `tool_call_delta`, `status.response_created`, `done`. | `llm-runtime-stream` matrix content/tool/reasoning row. |
| OpenAI `gpt-5.4-nano` | Same Responses family as GPT-5.4 with standard reasoning tier. | Same normalized contract as GPT-5.4, with model-specific capability tier. | `llm-runtime-stream` matrix content/tool/reasoning row. |
| Gemini `gemini-3.1-flash-lite-preview` | Generate Content `parts[].text`, `parts[].thought`, `parts[].functionCall`. | text without `thought` -> `content_delta`; `thought: true` -> `reasoning_delta`; `functionCall` -> `tool_call_start`. | `gemini-tool-handoff` request-body tests; `llm-runtime-stream` matrix content/tool/reasoning row. |
| Gemini `gemini-3.1-pro-preview-customtools` | Same Generate Content shape; reasoning is requested through `thinkingConfig.includeThoughts: true` when app reasoning is requested. | Same Gemini normalized contract; thoughts are visible only through `reasoning_delta`, not assistant content. | `gemini-tool-handoff` includeThoughts test; `llm-runtime-stream` matrix content/tool/reasoning row and thought-routing test. |
| Anthropic `claude-sonnet-4-6` | Messages stream `text_delta`, `thinking_delta`, `tool_use`, `input_json_delta`. | `content_delta`, `reasoning_delta`, `tool_call_start`, `tool_call_delta`. | `llm-runtime-stream` matrix content/tool/reasoning row. |
| Anthropic `claude-opus-4-6` | Same Claude stream shape with advanced reasoning tier. | Same normalized contract as Sonnet, with advanced tier. | `llm-runtime-stream` matrix content/tool/reasoning row. |
| Mistral `mistral-small-2603` | Chat stream text deltas, typed thinking/text content arrays, OpenAI-like tool call deltas. | `content_delta`, `reasoning_delta`, `tool_call_start`, `tool_call_delta`. | `llm-runtime-stream` matrix content/tool/reasoning row. |
| Mistral `magistral-medium-2509` | Same Mistral stream family with advanced reasoning tier. | Same normalized contract as Mistral Small, with advanced tier. | `llm-runtime-stream` matrix content/tool/reasoning row. |
| Cohere `command-a-03-2025` | V2 chat `content-delta` with `text` or `thinking`, `tool-plan-delta`, `tool-call-start`, `tool-call-delta`. | text -> `content_delta`; thinking/tool plan -> `reasoning_delta`; tool events -> `tool_call_start`/`tool_call_delta`. | `llm-runtime-stream` matrix content/tool/reasoning row. |
| Cohere `command-a-reasoning-08-2025` | Same Cohere stream family with advanced reasoning tier. | Same normalized contract as Command A, with advanced tier and package capability not `unsupported`. | `llm-runtime-stream` matrix content/tool/reasoning row; package catalog alignment tests. |

Known non-goal for BR-14c:

- Provider-specific thought signatures, token usage accounting, and durable reasoning export remain represented in package capability fields but are not fully implemented beyond current app behavior. They remain future package evolution work, not justification to suppress provider thoughts from the current reasoning stream.

## Non-Goals

- Do not extract chat UI behavior. BR-14a owns `@sentropic/chat`.
- Do not keep dual runtime paths. BR-14c owns strict application runtime migration to the mesh contract.
- Do not modularize the full chat-service reasoning/tool loop. BR-14b owns that higher-level chat-service extraction.
- Do not execute operational DNS, repository, Scaleway container/registry, or secret transitions. BR-14d owns transition operations. Npm publication for `@sentropic/llm-mesh` is not a BR-14d transition item; it belongs to BR-14c because this is the first package branch.
- Do not complete the final codebase naming sweep. BR-14e owns final naming cleanup.
- Do not build a FinOps platform inside the MVP package.
- Do not bind the package to Sentropic's database, settings service, encrypted settings storage, or workspace model.

## Graphify Validation

Graphify runtime proof:

- `.graphify/.graphify_runtime.json` reports `runtime: typescript`.
- Runtime version: `0.4.24`.
- Graph size: 4743 nodes, 6709 edges, 237 communities.

Graphify summary identified `Call LLM` as a key community:

- Community: `Call LLM`.
- Size: 144 nodes, 222 internal edges.
- Top nodes: `index.ts`, `model-catalog.ts`, `callLLM()`.

Graphify review analysis for these current runtime files returned high blast radius:

- `api/src/services/provider-runtime.ts`
- `api/src/services/provider-registry.ts`
- `api/src/services/model-catalog.ts`
- `api/src/services/llm-runtime/index.ts`
- `api/src/services/provider-credentials.ts`
- `api/src/services/provider-connections.ts`
- `api/src/services/codex-provider-auth.ts`

Result:

- Blast radius: high, score 179.
- Impacted files: 26.
- Impacted communities: 5.
- Highest impacted community: `Call LLM`.
- Test-gap hints were surfaced for `provider-runtime.ts`, `model-catalog.ts`, `llm-runtime/index.ts`, `provider-credentials.ts`, `provider-connections.ts`, and `codex-provider-auth.ts`.

Graphify review analysis for provider adapters returned:

- Blast radius: high, score 122.
- Impacted files: 14.
- Impacted communities: 3.
- Bridge node: `GeminiProviderRuntime`.
- Test-gap hint: `api/src/services/providers/openai-provider.ts`.

Interpretation:

- `@sentropic/llm-mesh` is not a shallow type extraction. The current code mixes provider contracts, provider SDK adapters, credential resolution, Codex account transport, model selection, schema transforms, streaming normalization, and chat/application orchestration.
- BR-14c should define the stable package contract, extract reusable primitives, and cut over the application LLM runtime to those primitives. It should avoid broad chat-service rewiring, but it must not leave a duplicate model runtime behind.
- Graphify did not surface every exported function by name. For example, `resolveProviderCredential` was not directly matched as a node, so direct source inspection remains required for function-level precision.

## Current Runtime Inventory

### Provider Runtime Contract

Current file:

- `api/src/services/provider-runtime.ts`

Current exports:

- `ProviderId`
- `ProviderStatus`
- `ReasoningTier`
- `DefaultContext`
- `ProviderCapabilities`
- `ProviderDescriptor`
- `ModelCatalogEntry`
- `CredentialValidationResult`
- `NormalizedProviderError`
- `ProviderRuntime`
- `providerIds`
- `isProviderId`
- `listRuntimeModelsByProvider`
- `buildRuntimeProviderDescriptor`

Reusable in `@sentropic/llm-mesh`:

- Provider identifier model, now imported from the package.
- Provider descriptor and model profile source data, now imported from the package.
- Capability flags and reasoning tier abstraction, now imported from the package.
- Credential validation result shape.
- Normalized provider error shape.

Needs redesign before package extraction:

- `DefaultContext` is application-oriented (`chat`, `structured`, `summary`, `doc`). The package should expose generic use-case tags or leave context defaults outside core.
- `ProviderRuntime.generate(request: unknown)` and `streamGenerate(request: unknown)` are too weakly typed for a public SDK.
- Capability fields are too coarse for current provider differences. The package needs explicit capabilities for tool calls, streaming tool-call deltas, structured output strategy, reasoning controls, reasoning summaries, multimodal input/output, context window, JSON schema subset, and account transports.

### Provider Registry

Current file:

- `api/src/services/provider-registry.ts`

Current role:

- Instantiates OpenAI, Gemini, Claude, Mistral, and Cohere runtime classes.
- Lists providers and models.
- Resolves providers by ID.

Reusable in `@sentropic/llm-mesh`:

- Registry interface.
- Provider/model listing contract.
- Provider resolution semantics.

App-local until BR-14c runtime cutover:

- Singleton construction.
- Direct dependency on app provider classes.
- Environment-aware provider readiness.

Package direction:

- Expose a registry factory, not an application singleton.
- Let consumers register direct SDK adapters, gateway adapters, or custom adapters.
- Support model aliases without forcing runtime routing in the MVP.

### Model Catalog

Current file:

- `api/src/services/model-catalog.ts`

Current role:

- Maps provider runtime models to API payloads.
- Resolves default provider/model selection from settings.
- Applies legacy model cutover rules.
- Exposes reasoning helpers.

Reusable in `@sentropic/llm-mesh`:

- Provider/model selection primitives.
- Capability matrix.
- Reasoning support detection.

App-specific compatibility layer:

- `settingsService` dependency.
- Legacy cutover policy until BR-14g updates model versions.
- API response snake_case mapping.
- Current app contexts.

Package direction:

- Define a provider-neutral model profile format.
- Keep legacy Sentropic model cutovers in the app or a compatibility adapter, not in package core.
- Add a capability source that can be static in MVP and extensible later.

### Provider Adapters

Current files:

- `api/src/services/providers/openai-provider.ts`
- `api/src/services/providers/claude-provider.ts`
- `api/src/services/providers/gemini-provider.ts`
- `api/src/services/providers/mistral-provider.ts`
- `api/src/services/providers/cohere-provider.ts`

Reusable in `@sentropic/llm-mesh`:

- Provider model lists and capability profiles are now owned by the package catalog.
- SDK request/stream entry points.
- Error normalization patterns.
- Mocked-client test patterns.

App-local until BR-14c runtime cutover:

- Imports from `../../config/env`.
- OpenAI Codex fetch wiring embedded inside the OpenAI provider.
- Provider-specific request payload shapes exposed as public request types.
- Credential fallback to process env inside provider classes.

Package direction:

- Adapters should receive credentials/transports through call context or adapter config.
- Codex account transport should be represented as an account transport, not hardwired to OpenAI provider internals.
- Provider-native request types can be allowed through an escape hatch, but the main contract must be normalized.

### LLM Runtime

Current file:

- `api/src/services/llm-runtime/index.ts`

Current exported/publicly useful concepts:

- `CallLLMOptions`
- `CallLLMStreamOptions`
- `StreamEventType`
- `StreamEvent`
- `sanitizeGeminiResponseSchema`
- `buildGeminiRequestBody`
- `callLLM`
- `callLLMStream`

Reusable in `@sentropic/llm-mesh`:

- Normalized stream event taxonomy.
- Tool-call normalization rules.
- Structured-output schema sanitizers.
- Provider-specific stream mappers.
- `call` and `stream` facade shape.

App-local until BR-14c runtime cutover:

- Chat message conversion tied to OpenAI Chat Completions shapes.
- Runtime selection from user/workspace settings.
- Credential resolution from Sentropic services.
- Retry and continuation orchestration tied to chat service flow.
- Chat-service context budgeting.
- Direct provider singleton calls.

Package direction:

- Split request compilation from execution.
- Expose normalized events as discriminated unions.
- Keep provider-native chunks available in metadata for debugging and advanced consumers.
- Model tool calls and tool result continuation without assuming OpenAI Responses API.

### Credentials and Account Transports

Current files:

- `api/src/services/provider-credentials.ts`
- `api/src/services/provider-connections.ts`
- `api/src/services/codex-provider-auth.ts`

Current precedence:

- Request override.
- User BYOK.
- Workspace key.
- Environment.
- None.

Reusable in `@sentropic/llm-mesh`:

- Auth source enum.
- Resolver contract.
- Account transport shape such as `{ accessToken, accountId }`.
- Transport mode distinction.
- Future account-provider extension point.

App-specific after BR-14c package cutover:

- Encrypted settings storage.
- Workspace/user lookup.
- `settingsService` integration.
- Codex device enrollment persistence.
- UI settings routes.
- Secrets and operational OAuth endpoints.

Package direction:

- Core should define auth contracts and transport interfaces.
- Sentropic app should implement resolvers.
- Future managed SSO/account flows should be plugins or app-level integrations, not package core.

## External Framework Benchmark

Benchmark date: 2026-04-21.

Only official sources are used for final decisions.

### Cross-Framework Decision Matrix

| System | Primary shape | Strong ideas to reuse | Scope boundary for Sentropic |
| --- | --- | --- | --- |
| Vercel AI SDK | TypeScript app SDK | Generation/streaming facade, typed tool lifecycle, provider registry, middleware, telemetry hooks | Good reference for `@sentropic/llm-mesh` core API |
| Vercel AI Gateway | Hosted gateway | BYOK, model fallbacks, provider timeouts, spend/model usage logs | Defer hosted gateway behavior; expose metadata/hooks only |
| LangChain JS / LangGraph | Agent/workflow framework | Model profiles, stream modes, structured output strategies | Keep orchestration in `@sentropic/flow`, not mesh core |
| Google Gemini / Vertex AI | Provider-native model APIs | Function calling limits, streamed tool arguments, schema subset limits, thinking signatures | Encode as capability metadata and provider adapter behavior |
| LiteLLM | SDK plus proxy/gateway | Virtual keys, budgets, routing, SSO, callbacks, provider failover | Treat as FinOps/gateway inspiration, not MVP package scope |
| Portkey / Cloudflare / OpenRouter / Helicone | Gateways | Fallbacks, retry, cache, cost analytics, OpenAI-compatible routing | Later gateway or deployment layer; package should remain embeddable |
| Langfuse / Braintrust / LangSmith / OpenAI Agents tracing | Observability/evaluation | Trace/span/event model, prompt/eval linkage, redaction needs | Define exporter hooks; do not hardwire one backend |

Decision:

- BR-14c should create a small embeddable SDK contract, not an Sentropic-hosted gateway.
- The package must expose enough metadata and lifecycle events for later FinOps and observability.
- Cost accounting, budgets, SSO, gateway-managed virtual keys, persistent traces, and dashboards are separate systems.
- Application-level orchestration remains outside `@sentropic/llm-mesh`.

### Vercel AI SDK

Relevant official sources:

- `generateText`: https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text
- `streamText`: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
- Structured output: https://ai-sdk.dev/docs/reference/ai-sdk-core/output
- Tool calling: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- Reasoning middleware: https://ai-sdk.dev/docs/reference/ai-sdk-core/extract-reasoning-middleware
- Provider registry: https://ai-sdk.dev/docs/reference/ai-sdk-core/provider-registry
- Telemetry: https://ai-sdk.dev/docs/ai-sdk-core/telemetry
- Error handling: https://ai-sdk.dev/docs/ai-sdk-core/error-handling

Observed design:

- Core functions are centered on `generateText`, `streamText`, structured output, embeddings, image, audio, and video generation.
- Provider management supports custom providers, aliases, model limiting, provider registry, OpenAI-compatible providers, and language model middleware.
- Tool calling is strongly typed and includes tool input lifecycle hooks such as streamed input start/delta/available events.
- Structured output is part of text generation and can be combined with tool calling.
- Telemetry is experimental and OpenTelemetry-based, with explicit per-call enablement and controls for input/output recording.
- Error handling distinguishes simple stream errors from full stream error parts.
- Provider-specific options are available, but the core facade stays provider-neutral.

Implications for Sentropic:

- Copy the separation between generation facade, provider registry, and middleware hooks.
- Adopt typed tool-call lifecycle events.
- Keep telemetry as a hook/integration layer in BR-14c, not as a mandatory persistence system.
- Provide provider-specific options without leaking provider-specific request types as the main API.

### Vercel AI Gateway

Relevant official sources:

- Overview: https://vercel.com/docs/ai-gateway
- Provider options: https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
- Model fallbacks: https://vercel.com/docs/ai-gateway/models-and-providers/model-fallbacks
- Provider timeouts: https://vercel.com/docs/ai-gateway/models-and-providers/provider-timeouts
- Authentication and BYOK: https://vercel.com/docs/ai-gateway/authentication-and-byok
- Observability: https://vercel.com/docs/ai-gateway/capabilities/observability
- Usage: https://vercel.com/docs/ai-gateway/capabilities/usage

Observed design:

- AI Gateway separates hosted routing/reliability from the local SDK facade.
- Gateway behavior includes provider fallbacks, provider-specific timeouts, BYOK, usage, spend logs, and request observability.
- Timeout and fallback behavior can have billing side effects because timed-out provider requests may still be charged depending on provider cancellation behavior.

Implications for Sentropic:

- Keep `@sentropic/llm-mesh` gateway-compatible but not gateway-owned.
- Add request metadata needed for later gateway routing: correlation ID, tenant/workspace/user IDs, selected model, attempted providers, fallback reason, timing, token usage, and cost estimates.
- Defer persistent gateway state, dashboard, BYOK vault, and org-level spend governance.

### LangChain JS and LangGraph

Relevant official sources:

- LangChain JS models: https://docs.langchain.com/oss/javascript/langchain/models
- LangChain JS structured output: https://docs.langchain.com/oss/javascript/langchain/structured-output
- LangChain JS streaming: https://docs.langchain.com/oss/javascript/langchain/streaming
- LangChain JS observability: https://docs.langchain.com/oss/javascript/langchain/observability
- LangSmith tracing: https://docs.langchain.com/langsmith/trace-with-langchain

Observed design:

- Chat models support `invoke`, `stream`, and `batch`.
- Tool calling is exposed through binding tools to models; parallel tool calls are part of the model abstraction where supported.
- Streaming can expose agent progress, LLM tokens, reasoning tokens, and custom updates through multiple stream modes.
- Structured output supports schemas such as Zod and JSON Schema.
- Model profile data can describe tool calling, structured output, modalities, and token limits.
- Observability is integrated through LangSmith tracing and captures agent/model/tool steps when enabled.

Implications for Sentropic:

- Separate model streaming from agent/workflow streaming.
- Adopt model profiles/capability records as first-class data.
- Do not put LangGraph-like orchestration into `llm-mesh`; that belongs to `@sentropic/flow`.
- Consider a stream mode abstraction, but keep BR-14c focused on model stream events.
- Keep trace export as a generic hook so LangSmith-style backends remain pluggable.

### Google Vertex AI and Google Gen AI SDK

Relevant official sources:

- Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini thinking: https://ai.google.dev/gemini-api/docs/thinking
- Google Gen AI SDK JavaScript: https://github.com/googleapis/js-genai/blob/main/README.md
- Vertex AI function calling: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling
- Vertex AI function calling reference: https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling
- Vertex AI structured output: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output
- Vertex AI thinking: https://cloud.google.com/vertex-ai/generative-ai/docs/thinking
- Application Default Credentials: https://cloud.google.com/docs/authentication/provide-credentials-adc

Observed design:

- Function calling uses tool/function declarations and can return structured function call data for application execution.
- Gemini supports parallel function calling on supported models.
- Gemini 3 Pro and later can stream function call arguments with `streamFunctionCallArguments`.
- Structured output uses response schemas, but only a subset of schema fields is supported.
- Thinking models expose thought signatures and thought token counts; thought signatures must be preserved correctly across tool/function turns.
- Vertex AI auth is primarily cloud/project oriented through Google Cloud credentials, service accounts, OAuth, and the Google Gen AI SDK configuration.

Implications for Sentropic:

- Capability matrix must represent schema subset limits, streamed tool-call-argument support, parallel tool calls, thought signatures, and thought token accounting.
- Reasoning cannot be a single boolean. It needs controls, summaries, hidden signatures, visible summaries, and usage accounting.
- Google account/service-account auth should be an app or deployment integration, while the package exposes credential/provider hooks.

### LiteLLM

Relevant official sources:

- LiteLLM docs: https://docs.litellm.ai/
- Proxy quick start: https://docs.litellm.ai/docs/proxy/quick_start
- Virtual keys: https://docs.litellm.ai/docs/proxy/virtual_keys
- Reliability: https://docs.litellm.ai/docs/proxy/reliability
- Provider budget routing: https://docs.litellm.ai/docs/proxy/provider_budget_routing
- Cost tracking: https://docs.litellm.ai/docs/proxy/cost_tracking
- Logging: https://docs.litellm.ai/docs/proxy/logging
- Admin UI SSO: https://docs.litellm.ai/docs/proxy/admin_ui_sso

Observed design:

- LiteLLM acts as both SDK and AI gateway/proxy.
- It offers OpenAI-compatible access across many providers.
- Virtual keys track spend and control model access.
- Spend can be tracked by key, user, and team.
- Routing supports model aliases, load balancing, fallback, rate-limit aware routing, latency-based routing, least-busy routing, custom routing, and cost-based routing.
- Observability is callback-based and integrates with tools such as Langfuse, LangSmith, Helicone, Traceloop, Sentry, PostHog, Arize, and OpenTelemetry.
- Admin UI SSO supports providers such as Okta, Google, Microsoft, and generic OAuth/OIDC, with roles and team/org management.

Implications for Sentropic:

- LiteLLM is closer to a gateway/FinOps product than a small TypeScript SDK.
- BR-14c should not clone LiteLLM proxy concerns.
- BR-14c should define hooks and metadata needed for later spend tracking, budgets, routing, and observability.
- Managed keys, SSO, roles, team budgets, and admin UI belong outside the package core.

### Gateway and Observability Ecosystem

Relevant official sources:

- Portkey AI Gateway: https://portkey.ai/docs/product/ai-gateway
- Portkey fallbacks: https://portkey.ai/docs/product/ai-gateway/fallbacks
- Cloudflare AI Gateway: https://developers.cloudflare.com/ai-gateway/
- Cloudflare AI Gateway caching: https://developers.cloudflare.com/ai-gateway/features/caching/
- Cloudflare AI Gateway analytics: https://developers.cloudflare.com/ai-gateway/observability/analytics/
- Cloudflare AI Gateway costs: https://developers.cloudflare.com/ai-gateway/observability/costs/
- OpenRouter model routing: https://openrouter.ai/docs/model-routing
- Helicone AI Gateway: https://docs.helicone.ai/gateway/overview
- Helicone caching: https://docs.helicone.ai/features/advanced-usage/caching
- Langfuse overview: https://langfuse.com/docs
- Langfuse observability: https://langfuse.com/docs/observability/overview
- Braintrust observability: https://www.braintrust.dev/docs/observe
- Braintrust playgrounds/evaluations: https://www.braintrust.dev/docs/evaluate/playgrounds
- Mastra observability: https://mastra.ai/observability

Observed design:

- Gateways converge around OpenAI-compatible endpoints, routing/fallbacks, retries, rate limits, caching, BYOK or managed keys, usage logs, and cost dashboards.
- Observability platforms converge around traces, spans, token/cost/latency capture, prompt/version linkage, evaluation datasets, and asynchronous export.
- Some systems combine gateway and observability; others keep SDK, gateway, and observability separate.

Implications for Sentropic:

- `llm-mesh` should not own the policy engine, cache store, or trace database.
- `llm-mesh` should emit enough structured events to let a future Sentropic gateway, LiteLLM, Portkey, Cloudflare AI Gateway, Langfuse, Braintrust, LangSmith, Helicone, or OpenTelemetry exporter consume the same lifecycle.
- The package contract should include redaction controls before any prompt/completion payload can be exported.

### OpenAI Agents SDK

Relevant official source:

- Tracing: https://openai.github.io/openai-agents-js/guides/tracing/
- Handoffs: https://openai.github.io/openai-agents-js/guides/handoffs/

Observed design:

- Tracing covers agent runs, LLM generations, tool calls, handoffs, guardrails, and custom events.
- Tracing is enabled by default in server runtimes and can be disabled globally or per run.
- Custom trace processors can export traces elsewhere.
- ZDR policy can make tracing unavailable.
- Handoffs are modeled as tool-like transfers between agents.

Implications for Sentropic:

- Tracing should be designed as an exportable event/span hook.
- Privacy and zero-retention constraints must be explicit.
- `llm-mesh` should not assume a single hosted trace dashboard.
- Agent handoffs belong in `@sentropic/flow`; mesh only needs model/tool event support.

## Recommended Scope Split

## Review Corrections Accepted on 2026-04-22

The BR-14c strategic review confirmed the direction but tightened the public contract before freeze.

### Package Gates

`make typecheck-api` and `make lint-api` do not prove that `packages/llm-mesh` builds or tests. BR-14c must add deterministic package-specific make targets before the public contract is considered validated:

- `make typecheck-llm-mesh`
- `make test-llm-mesh`
- `make lint-llm-mesh` if package linting is not covered by an existing target

These targets are part of BR14c-EX1 because they touch make/build scaffolding, not runtime behavior.

### npm Publication Lane

BR-14c must finish with `@sentropic/llm-mesh` publishable and published by CI/CD after merge to `main`.

Required publication work:

- Package metadata:
  - Stable package name: `@sentropic/llm-mesh`.
  - Non-placeholder version policy for the first release.
  - `main`, `types`, `exports`, `files`, side-effects, license, and README suitable for npm consumers.
  - Built `dist/**` contents generated from the package TypeScript source, not checked in unless the package policy explicitly requires it.
- Make targets:
  - `make build-llm-mesh`
  - `make pack-llm-mesh`
  - `make publish-llm-mesh`
  - All targets remain Docker-first and must not require host npm.
- CI validation:
  - `.github/workflows/ci.yml` must detect `packages/llm-mesh/**` and package publication workflow changes as package-relevant changes.
  - Pull requests must run package typecheck, package tests, package build, and package pack/dry-run.
  - The package validation job must block merge on real failures.
- CI publication:
  - Publish only from `main` after branch gates pass.
  - Use npm Trusted Publishing through GitHub OIDC only; do not require a long-lived npm publish token.
  - Use automatic npm provenance when supported by the CI environment.
  - A publish skip is acceptable only when the exact package version already exists and the job records that reason explicitly.

Scope boundary:

- BR-14c owns only `@sentropic/llm-mesh` npm publication.
- BR-07 and BR-12 keep ownership of UI, Chrome, and VSCode package publication.

### SDK Facade

The package cannot remain a vocabulary-only extraction. BR-14c must expose a minimal consumable facade:

```ts
const mesh = createLlmMesh({ registry, authResolver, hooks });

await mesh.generate({ model: 'openai:gpt-5.4', messages, tools });
for await (const event of mesh.stream({ providerId: 'google', modelId: 'gemini-3.1-pro-preview', messages })) {
  // normalized stream event
}
```

Required facade behavior:

- Resolve `provider:model` aliases and `{ providerId, modelId }` pairs.
- Resolve auth through an injected `AuthResolver`.
- Validate the selected model profile and fail early when a requested feature is unsupported.
- Delegate to provider adapters.
- Normalize errors, stream events, tool calls, tool results, usage, and finish reasons.
- Apply redaction before hooks or metadata export.

### Capability Matrix Stance

"Less optimistic capability matrix" means the package must not claim provider-wide support for features that are actually model-specific or unverified.

Bad public contract:

```ts
google.supportsTools = true;
google.supportsStructuredOutput = true;
google.supportsReasoning = true;
```

Better public contract:

```ts
gemini31Pro.capabilities.tools.support = 'supported';
gemini31Pro.capabilities.tools.parallelCalls = 'supported';
gemini31Pro.capabilities.tools.streamedArgumentDeltas = 'supported';
geminiFlashLegacy.capabilities.tools.streamedArgumentDeltas = 'unknown';
claudeSonnet.capabilities.structuredOutput.jsonSchema = 'partial';
cohereCommand.capabilities.reasoning = 'unsupported';
```

Required stance:

- Capabilities belong primarily to `ModelProfile`, not to broad `ProviderDescriptor` defaults.
- Every non-trivial feature should be represented as `supported`, `unsupported`, `partial`, or `unknown`; booleans may exist only as derived helpers.
- `unknown` is the default when the behavior has not been verified against official docs or tests.
- `partial` must carry limits, such as unsupported JSON Schema keywords, missing strict mode, no streamed tool argument deltas, no parallel calls, no thought signatures, or provider-specific continuation limits.
- Model IDs must distinguish provider-native model IDs from Sentropic aliases.

This avoids over-promising to BR-14b and prevents runtime code from making unsafe assumptions such as "Google supports every tool feature" or "Anthropic structured output is equivalent to OpenAI JSON Schema strict mode."

### Auth Boundary

"Separate server secrets from auth descriptors" means the package needs two distinct shapes:

- `SecretAuthMaterial`: executable credential material used only inside server-side adapters, such as API keys, OAuth access tokens, refresh tokens, account tokens, and provider headers.
- `AuthDescriptor`: redacted metadata safe for events, UI, logs, traces, and browser-safe package subsets, such as source type, provider, account label, expiry presence, and redacted fingerprint.

Rules:

- `AuthResolver` may return secret material to the server-side mesh execution path.
- Public lifecycle events, stream metadata, traces, errors, and usage records must receive only `AuthDescriptor`.
- Browser-safe entry points must never accept or expose refresh tokens, account tokens, or provider API keys unless the caller explicitly opts into a direct client-side provider integration outside Sentropic's default path.
- Request-level direct token overrides are allowed for server SDK use, but they must be excluded from exported metadata and must never be copied into provider-native chunks.
- Codex account remains an experimental account transport. Gemini Code Assist and Claude Code remain interface hooks only until a dedicated auth branch defines enrollment and storage.

### Tool and Result Contract

"Strengthen tools/results for MCP and streaming" means the current `ToolResult.output: unknown` shape is too small for modern tool ecosystems.

Required contract direction:

- Tool definitions remain provider-neutral and JSON-Schema based, but can carry provider/MCP annotations.
- Tool-call streaming must distinguish:
  - tool call announced,
  - input argument delta,
  - input available/complete,
  - tool execution result,
  - continuation submitted back to the provider.
- Tool results must support rich content, not just opaque JSON:
  - text content,
  - JSON/structured content,
  - image/audio references,
  - resource links,
  - embedded resources where safe,
  - typed tool errors,
  - annotations such as title, audience, cacheability, sensitivity, and display hints.
- Provider-native call IDs and Sentropic call IDs must both be preserved so continuation can resume correctly across OpenAI, Gemini, Anthropic, and MCP-style tools.
- Stream events may keep the current high-level event taxonomy, but the `tool_call_*` payloads must contain enough lifecycle detail to render partial arguments, execute tools deterministically, and continue generation without provider-specific leakage.

BR-14c does not need to implement a full MCP client. It must avoid freezing a contract that would make MCP-compatible tools or streamed tool input lifecycle impossible later.

### BR-14c MVP

- Package boundary for `@sentropic/llm-mesh`.
- Public TypeScript contract.
- Provider IDs and model profiles.
- Capability matrix with explicit per-model capabilities.
- Normalized `generate` and `stream` facade.
- Normalized stream events.
- Tool-call and tool-result continuation contract.
- Structured-output contract and schema capability metadata.
- Provider error normalization.
- Auth resolver interface and auth source taxonomy.
- Account transport interface for Codex account mode.
- Correlation IDs and per-call lifecycle events.
- Usage metadata envelope with provider-native raw usage preserved.
- Deterministic unit tests for contracts and stream normalization.
- Real application runtime cutover to `@sentropic/llm-mesh`.
- Deletion of replaced app-local provider/runtime implementation.
- Runtime UAT proving chat generation uses the mesh-backed path.

### BR-14c Interfaces Only

- Observability hook interface.
- Usage accounting metadata interface.
- Cost metadata fields.
- Routing policy interface.
- Retry/fallback policy interface.
- Cache key metadata interface.
- Redaction policy interface.
- Trace/exporter interface compatible with OpenTelemetry-style spans without depending on OpenTelemetry.
- Future account transport interfaces for Gemini Code Assist and Claude Code.

### BR-14b

- Modularize chat-service behavior above the mesh runtime.
- Extract reasoning-loop, tool-loop, continuation, cancellation, and retry orchestration boundaries where they are reusable.
- Preserve chat streaming, local-tool handoff, tool-result continuation, cancellation, checkpoints, traces, audit, and current API behavior.
- Avoid redefining provider/model access; all model access must continue through `@sentropic/llm-mesh`.

### BR-14d

- Operational provider/account setup.
- DNS and deployment transition.
- Secrets and environment variable names.
- OAuth callback URLs and allowed redirect URIs.
- Gateway/proxy deployment names if Sentropic later adds a hosted mesh gateway.

### Later FinOps and Observability Branch

- Spend tracking persistence.
- Budgets by key/user/workspace/team/org.
- Rate limits and throttling policy.
- Fallback routing based on cost, latency, availability, or quotas.
- Observability storage, dashboards, and admin UI.
- Integration with Langfuse, LangSmith, Helicone, OpenTelemetry, or a custom Sentropic trace store.
- Virtual keys or managed gateway keys if Sentropic chooses a proxy architecture.

## Open Product Questions

- Q1: Should BR-14c include a minimal executable fallback engine, or only define fallback policy contracts and retryable error metadata?
- Q2: Should JSON Schema be the canonical package schema, with Zod/Pydantic adapters kept peripheral?
- Q3: Is `codex-account` a public v1 auth mode or an experimental Sentropic adapter until the account transport contract is stable?
- Q4: How much reasoning should the public contract expose: hidden signatures only, visible summaries, reasoning token counts, or provider-native reasoning payloads?
- Q5: Should streaming expose fine-grained tool-call argument deltas, or a simplified `tool_call_delta` event with provider-native deltas in metadata?
- Q6: Should the first package be Node-only, or include a browser-safe subset with no secret-bearing transports?
- Q7: What is the default redaction policy for prompts, completions, tool payloads, and provider-native chunks before observability export?
- Q8: Should `@sentropic/llm-mesh` expose a Vercel-like `generateText` / `streamText` API, or an Sentropic-specific `mesh.generate` / `mesh.stream` API?
- Q9: Should model IDs be `provider:model` strings, separate `{ providerId, modelId }` pairs, or both?
- Q10: Should OpenAI-compatible gateways such as LiteLLM/OpenRouter be first-class providers in BR-14c, or deferred as adapter examples?
- Q11: Should app contexts such as `chat`, `summary`, and `doc` remain outside the package, or become generic task profiles?

## Current Recommendation

Use BR-14c to build a small SDK core and cut the current app runtime over to it, not to build a gateway:

- Core API: normalized generation, streaming, tools, structured output, reasoning controls, provider/model registry, capability matrix, auth hooks.
- Optional hooks: observability, usage, cost metadata, routing policy, retry/fallback policy, redaction policy.
- Strict cutover: API imports `@sentropic/llm-mesh`; replaced app-local runtime code is removed in the same branch.
- Deferred systems: SSO, managed virtual keys, budgets, dashboards, persistent traces, billing, and gateway deployment.

This keeps `@sentropic/llm-mesh` useful as an npm library while leaving enough contract surface for later FinOps and observability without forcing those systems into the MVP.
