# Branch Plan Stub: BR-14b Chat Service Core

This file supersedes the older BR-14 LLM runtime-refactor pointer. Runtime model access now belongs to BR-14c.

Current coordination source:

- `spec/SPEC_EVOL_SENTROPIC_BR14_ORCHESTRATION.md`

Branch:

- BR-14b `refacto/chat-service-core`

Ordering rule:

- BR-14b comes after BR-14c strict runtime cutover and BR-14g model catalog pivot.
- BR-14b must not define provider/model access or migrate runtime dispatch; all model access must already go through `@sentropic/llm-mesh`.
- BR-14b comes before BR-14a chat SDK implementation.

Scope summary:

- Modularize chat-service behavior above the LLM runtime.
- Extract reasoning-loop, tool-loop, continuation, cancellation, retry, checkpoint, and trace/audit boundaries where reusable.
- Preserve current chat streaming, local-tool handoff, tool-result continuation, cancellation, retry, checkpoint, and API behavior.
- Keep provider/model access delegated to `@sentropic/llm-mesh`.

Lot outline for future full `BRANCH.md`:

- Lot 0 — Inventory and branch scope:
  - Inventory `api/src/services/chat-service.ts`, `api/src/services/tools.ts`, `api/src/services/stream-service.ts`, chat API endpoints, and chat/live-AI tests.
  - Confirm that runtime/model dispatch already goes through `@sentropic/llm-mesh`.
  - Define exact allowed paths and test files before implementation.
- Lot 1 — Chat-service boundary extraction:
  - Separate request orchestration from model runtime access.
  - Keep external API and stream payload behavior stable.
  - Add focused unit tests for the extracted orchestration boundary.
- Lot 2 — Reasoning and continuation loop:
  - Extract reasoning-step, continuation, retry, cancellation, and checkpoint flow where reusable.
  - Preserve existing tool-result continuation semantics.
- Lot 3 — Tool loop and local-tool handoff:
  - Extract tool-call planning/result handling above the mesh runtime.
  - Keep MCP-style content/result shapes compatible with `@sentropic/llm-mesh`.
- Lot 4 — Trace/audit and error boundaries:
  - Keep trace/audit metadata intact across extracted modules.
  - Preserve user-visible chat errors and provider/runtime error mapping from BR-14c.
- Lot 5 — Validation and UAT:
  - Run chat-service unit tests, API chat endpoints, live-AI chat sync/tools tests, and root UAT for chat streaming.
  - Confirm no provider/model abstraction is reintroduced outside `@sentropic/llm-mesh`.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Inventory `api/src/services/chat-service.ts`, `api/src/services/tools.ts`, `api/src/services/stream-service.ts`, and chat-related tests.
- Define file-level unit/API/live-AI/E2E checks before extracting modules.
