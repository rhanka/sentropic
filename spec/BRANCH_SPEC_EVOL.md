# BR14b Branch Spec Evol - Chat Service Core Modularization

## Status

Study and implementation guidance for BR14b before code extraction. This is not a public product spec yet; durable conclusions must be consolidated into existing specs before branch completion.

## Current constraint

BR14b runs after the LLM runtime cutover and model catalog pivot. The current package reality is `@sentropic/llm-mesh`; BR14b must not recreate provider/model access or edit `packages/llm-mesh/**`.

Initial inventory shows the chat core is concentrated in a few large files:

- `api/src/services/chat-service.ts`: 5671 lines, owns session/message persistence, assistant generation, streaming, tool execution, local-tool pause/resume, retry, checkpoints, finalization, trace/audit, and error handling.
- `api/src/services/tools.ts`: 1428 lines, owns tool definitions plus a separate streaming tool orchestrator used by non-chat workflows.
- `api/src/services/stream-service.ts`: 295 lines, owns durable stream event persistence, sequence allocation, NOTIFY, active stream listing, and reads.

## Non-goals

- No provider/model catalog change.
- No new model runtime abstraction.
- No changes to `packages/llm-mesh/**`.
- No UI or E2E implementation in BR14b.
- No additive timeout patches for AI nondeterminism.
- No merge without UAT passed, UAT waived, or UAT not applicable recorded.

## Proposed module boundary

Create `api/src/services/chat/` as the internal chat-core namespace above the mesh runtime.

Recommended modules:

- `types.ts`: shared chat loop types, stream event payload helpers, tool-call shapes, local-tool pause state, generation phase names, and trace metadata types.
- `stream-writer.ts`: small wrapper around `writeStreamEvent` that owns per-message stream sequence increments, error/done emission, and consistent event payload emission. It must not replace `stream-service.ts` storage behavior.
- `tool-call-collector.ts`: collects streamed model tool-call start/delta events into normalized pending tool calls.
- `tool-result-normalizer.ts`: normalizes server tool execution results and error results into stream events plus model continuation payloads.
- `local-tool-state.ts`: builds and validates `awaiting_local_tool_results` state for local extension tools, including pending calls and base tool outputs.
- `continuation-input.ts`: builds provider-compatible continuation input after server tool execution or local tool result acceptance, without owning provider dispatch.
- `generation-loop.ts`: later extraction target for the pass1 tools-enabled loop and pass2 no-tools fallback. This should be extracted only after smaller pure helpers are covered.

Keep in `chat-service.ts` initially:

- Public `chatService` facade.
- Session/message/checkpoint persistence methods.
- Route-facing orchestration entry points.
- Calls into queue manager and database queries that are not yet isolated.
- The high-level `runAssistantGeneration` transaction/order until helper extraction is verified.

Keep in existing services:

- `stream-service.ts`: durable stream storage and sequencing.
- `tools.ts`: tool definitions and non-chat streaming tool orchestration unless a later lot proves a safe shared helper.
- `tool-service.ts`: domain tool execution.
- `llm-runtime/**`: mesh-backed model access.

## Extraction order

1. Add pure types and helpers under `api/src/services/chat/**` with focused unit tests.
2. Extract stream writer helper and adapt `chat-service.ts` to use it without changing event order.
3. Extract tool-call collector from streamed model events.
4. Extract tool-result normalizer for server tools, preserving existing stream payloads.
5. Extract local-tool state builder/validator.
6. Extract continuation-input builder after server/local tool results.
7. Only then consider moving the larger generation loop.

This order keeps behavior stable and avoids a high-risk one-shot split of `runAssistantGeneration`.

## Test map

Existing tests that should remain green after each extraction lot:

- `api/tests/ai/chat-sync.test.ts`: live chat generation, tool calls, history-aware behavior.
- `api/tests/ai/comment-assistant.test.ts`: tool exposure and comment assistant behavior through chat service.
- `api/tests/api/chat-message-actions.test.ts`: edit/retry behavior and legacy model id migration on retry.
- `api/tests/api/chat-history-analyze-tool.test.ts`: `history_analyze` enqueue/tool contract.
- `api/tests/api/chat-checkpoint-contract.test.ts`: checkpoint create/list/restore behavior.
- `api/tests/api/queue-stream-bootstrap-contract.test.ts`: stream bootstrap contract for queued work.
- `api/tests/unit/history-analyze-tool.test.ts`: history tool support behavior.

New focused tests should be added only for extracted pure helpers. They should avoid live provider calls.

## UAT map

BR14b affects behavior that users can see even when API contracts remain stable. UAT must cover:

- Streaming response starts, deltas render, and final message persists.
- Server tool call emits visible executing/completed/error states.
- Local tool handoff pauses generation and resumes after submitted tool results.
- Stop/cancel finalizes partial assistant content.
- Retry regenerates from the intended user message and preserves model/default migration behavior.
- Checkpoint creation/list/restore remains usable.
- Error display remains understandable when a tool or model call fails.

## Workflow impact

BR14b should not add npm publication jobs. It prepares chat-service boundaries for BR14a.

BR14a is the branch expected to create and publish `@sentropic/chat`. That branch must add package Make targets and GitHub Actions jobs analogous to `@sentropic/llm-mesh`:

- `typecheck-chat`, `test-chat`, `build-chat`, `pack-chat`, `publish-chat`.
- `changes.outputs.chat` path filter for `packages/chat/**`.
- `validate-chat` on PRs when chat package changes.
- `publish-chat` on `main` with `id-token: write` and npm trusted publishing.
- Publish target must skip when `@sentropic/chat@<version>` already exists.

## Open decisions before implementation

- Decide whether `generation-loop.ts` should be extracted in BR14b or left as a second branch after pure helper extraction.
- Decide whether shared tool-loop helpers should live in `api/src/services/chat/**` or later in a package consumed by BR14a.
- Confirm whether `@sentropic/chat` should be a single package with Svelte exports or a core package plus Svelte reference layer.
