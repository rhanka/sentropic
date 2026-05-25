# BR-38b Image Generation Design

## Status
- Branch: `feat/image-generation-tool`
- Date: 2026-05-24
- Approval: user approved the provider matrix and mesh-first design on 2026-05-24.
- Lifecycle: temporary branch spec. Consolidate into `SPEC_EVOL_LLM_MESH.md`, `SPEC_CHATBOT.md`, and `SPEC_STUDY_CHAT_UI_SDK_SCOPE.md` in Lot N-1, then delete this file.

## Goal
BR-38b adds image generation as a first-class chat tool after BR-38a lands. A user can ask chat to generate an image, receive a preview inline, download the artifact, attach it to the current document context, and reuse it as a later image attachment through the BR-38a media contract.

Generated image bytes must never be embedded in chat message text. The API stores them through the reviewed document/storage media path and returns stable media references to chat clients.

## Provider Matrix

| Provider | BR-38b status | Default model or runtime | Notes |
| --- | --- | --- | --- |
| OpenAI | MVP supported | `gpt-image-2` | Official GPT Image docs list `gpt-image-2` as the current GPT Image model. Older `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini` stay explicit fallback profiles only. |
| Gemini | MVP supported | `gemini-3.1-flash-image-preview` | This is the official API ID for Nano Banana 2 Preview. `gemini-2.5-flash-image` remains the stable fallback profile; `gemini-3-pro-image-preview` remains the pro profile. |
| Anthropic | Unsupported | none | Claude supports image input and analysis, but no native Anthropic image generation API was found in official docs. |
| Mistral | Planned | Agents/Conversations connector | Official docs expose `image_generation` as a built-in connector for agents, supported by `mistral-medium-latest` and `mistral-large-latest`. The existing runtime uses chat completions, so BR-38b does not mark Mistral supported unless it adds a dedicated Agents/Conversations adapter. |
| Cohere | Unsupported | none | Official docs show chat, embed, rerank, and image embeddings, but no native image output API. |

## Mesh Contract
Add image generation as a separate `LlmMesh.generateImage()` operation instead of overloading `generate()` or `stream()`.

The mesh capability model gains generated image output support:
- `modalities.output` includes `image`.
- Provider/model metadata declares `imageGeneration.status`: `supported`, `unsupported`, or `planned`.
- Provider/model metadata declares `imageGeneration.kind`: `native-image-model`, `gemini-generate-content`, `provider-agent-tool`, or `none`.
- Provider/model metadata declares supported controls: `aspectRatio`, `size`, `quality`, `background`, `count`, `referenceImages`, and provider-specific options.

`ImageGenerationRequest` carries:
- `providerId`, `modelId`, and auth material through the existing provider runtime path.
- `prompt`.
- Optional BR-38a media references for reference images.
- Optional generation controls: `aspectRatio`, `size`, `quality`, `background`, `count`, and `providerOptions`.
- Existing request metadata and cancellation signal patterns where applicable.

`ImageGenerationResponse` carries:
- `providerId`, `modelId`, and provider request metadata.
- `images[]` with `mimeType`, binary payload or provider URL, optional dimensions, and provider metadata.
- `status` and normalized refusal/safety details when generation does not produce an image.

## Runtime Mapping
OpenAI uses a direct image generation runtime for `gpt-image-2`. The runtime normalizes returned image bytes or provider file URLs into mesh `images[]`. The Responses API image generation tool remains a later extension path, not the default MVP path.

Gemini uses the existing Generative Language endpoint shape with `:generateContent` and `generationConfig.responseModalities` containing `IMAGE` or `TEXT, IMAGE`. The runtime parses image parts from `candidates[].content.parts[].inlineData`.

Anthropic and Cohere fail before provider dispatch with deterministic unsupported errors.

Mistral fails before provider dispatch in the current MVP with a deterministic planned-runtime error unless this branch explicitly adds an Agents/Conversations adapter. If implemented later, the mesh capability remains the same and only the provider runtime changes from `planned` to `supported`.

## Chat And Storage Flow
1. The chat tool registry exposes `image_generate`.
2. The tool schema accepts prompt and generation controls, then asks the mesh for `generateImage()`.
3. The API stores each generated image through the same reviewed document/storage media path used for downloadable artifacts.
4. The tool result returns media references, MIME type, filename, provider/model metadata, and download URLs.
5. Chat UI renders generated media through the generic media/tool-result renderer boundary.
6. The host adapter owns app-specific URLs and document-context actions; `@sentropic/chat-ui` stays generic.
7. Follow-up turns can reuse generated media as BR-38a image attachments once BR-38a contracts are present on `main`.

## Error Semantics
Normalize these cases before UI rendering:
- `unsupported_provider`: provider has no native image generation path.
- `planned_provider_runtime`: provider has official support through a runtime not implemented in this branch.
- `missing_credentials`: provider credentials are unavailable.
- `invalid_generation_options`: requested controls are not supported by the selected provider/model.
- `provider_refusal`: provider safety policy refused generation.
- `quota_or_rate_limit`: provider quota or rate limit prevented generation.
- `provider_failure`: provider returned an unexpected or transient failure.

Unsupported-provider errors must include available supported provider/model choices for the user-visible retry path.

## Tests
Minimum focused gates:
- `packages/llm-mesh/tests/**`: capability matrix, request validation, unsupported-provider errors, OpenAI and Gemini adapter normalization with test doubles.
- `api/tests/unit/provider-mesh-contract-proof.test.ts`: mesh contract proof for supported, unsupported, and planned providers.
- `api/tests/api/chat-tools.test.ts`: `image_generate` tool schema, storage references, and normalized errors.
- `api/tests/api/documents.test.ts`: generated media download and document-context access control.
- `ui/tests/components/chat/**`: generated image card rendering, recoverable errors, responsive dimensions, and host-adapter boundaries.
- `e2e/tests/03-chat.spec.ts` or `e2e/tests/04-documents-ui-actions.spec.ts`: one deterministic mocked generated-image flow.

## Sources
- OpenAI image generation docs: `https://developers.openai.com/api/docs/guides/image-generation`
- Gemini image generation docs: `https://ai.google.dev/gemini-api/docs/image-generation`
- Anthropic vision docs: `https://platform.claude.com/docs/en/build-with-claude/vision`
- Mistral image generation connector docs: `https://docs.mistral.ai/docs/agents/connectors/image_generation`
- Cohere full docs index: `https://docs.cohere.com/llms-full.txt`
