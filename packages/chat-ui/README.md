# @sentropic/chat-ui

Svelte reference UI package for `@sentropic/*` chat sessions: stream rendering, optimistic client state, local-tool handoff, renderer registry, and host adapter contracts. It consumes `@sentropic/chat-core` wire contracts through HTTP/SSE only and never reaches into `@sentropic/llm-mesh`, API internals, or persistence adapters.

## Public Surface

Lot 2 ships the contract scaffold only. Full Svelte component prop boundaries and the `ChatTransport` / `ChatStreamClient` shapes from `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md` land in BR-14a Lot 3 once app imports are rewired.

- `@sentropic/chat-ui` — re-exports the TypeScript surface below.
- `@sentropic/chat-ui/client/transport` — `ChatCoreTransport`, `ChatCoreTransportFactory`, `createDefaultTransport`.
- `@sentropic/chat-ui/client/replay` — `ReplayCursor`, `ReplayClient`, `createReplayClient`.
- `@sentropic/chat-ui/renderers/registry` — `ToolRenderer`, `RendererRegistry`, `createRendererRegistry`.
- `@sentropic/chat-ui/hosts/types` — `HostAdapter`, `WebHostAdapter`, `ChromeHostAdapter`, `VsCodeHostAdapter`, `AnyHostAdapter`.
- `@sentropic/chat-ui/components/ChatPanel.svelte` — package-owned copy of the session/timeline shell (broken imports until Lot 3 rewires).
- `@sentropic/chat-ui/components/ChatWidget.svelte` — package-owned copy of the launcher/panel shell (broken imports until Lot 3 rewires).
- `@sentropic/chat-ui/components/StreamMessage.svelte` — package-owned copy of the stream renderer (broken imports until Lot 3 rewires).

## Non-Goals

- No direct import from `@sentropic/llm-mesh`.
- No provider, model, credential, retry, quota, or model catalog abstraction.
- No server persistence, Drizzle schema, or stream storage.
- No chat reasoning loop, tool loop, checkpoint runtime, queue runtime, or workflow orchestration.
- No Hono routes, Chrome service worker, or VSCode extension activation/secret storage.

## Host Adapter Examples

Lot 2 only defines the discriminant + minimal bridge hooks. Future lots will plug `ChatTransport`, `ChatStreamClient`, `LocalToolHostAdapter`, navigation, storage, and context-provider surfaces per `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md`. Example sketch:

```ts
import type { WebHostAdapter } from '@sentropic/chat-ui/hosts/types';
import { createDefaultTransport } from '@sentropic/chat-ui/client/transport';

const transport = createDefaultTransport('https://api.example.com/api/v1');
const host: WebHostAdapter = { kind: 'web' };
```

## Stream Replay Behavior

`createReplayClient(transport)` opens an `EventSource` from the chat-core endpoint at the supplied `{ sessionId, fromSeq }` cursor and yields each raw `MessageEvent.data` payload through an `AsyncIterable`. Sequence ordering, dedupe, gap catch-up, and aggregation of `content_delta` / `tool_call_delta` segments arrive in Lot 3 alongside the projection pipeline.

## Renderer Registry Behavior

`createRendererRegistry()` returns a `Map`-backed registry. Consumers `register(toolName, renderer)` and `get(toolName)` to resolve. Unknown tool names fall through to `registry.default`, a `JSON.stringify` fallback. Lot 3+ replaces `ToolRenderer` with the typed `ToolResultRenderer` interface defined in the SDK scope spec.

## Dependency Rules

- Consumes only `@sentropic/chat-core` wire contracts via HTTP/SSE.
- No runtime dependency on `@sentropic/llm-mesh`, API source, or app-owned stores.
- App-specific renderers (initiatives, folders, comments, document cards, Chrome tab actions, VSCode local tools) are registered by hosts, never imported by the package.
