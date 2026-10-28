# @sentropic/chat-ui

Svelte chat views, normalized data/command ports and presentation helpers.
Sentropic client execution lives in `@sentropic/chat-runtime`. Views receive state and callbacks;
hosts own authentication, platform capabilities and runtime lifetime.

## 1.0.0 migration

This major release removes runtime implementations and their forwarding exports. Import transport,
replay, session/controller/projection state, checkpoints, local tools, model selection and optional
module state from the corresponding `@sentropic/chat-runtime` subpaths. The visual root barrel no
longer exports them. See `spec/CHAT_MIGRATION_P1.md` in the repository for the release notice.

`ChatConversation` requires `snapshots` and `commands`. Create the runtime above placement/tab/view
mounts and dispose it when the host releases the session, rather than when the view unmounts.

```svelte
<script lang="ts">
  import ChatConversation from '@sentropic/chat-ui/components/ChatConversation.svelte';
  import type { ChatConversationCommands, ChatConversationSnapshots } from '@sentropic/chat-ui/conversation';
  export let snapshots: ChatConversationSnapshots;
  export let commands: ChatConversationCommands;
</script>

<ChatConversation {snapshots} {commands} features={{ attachments: true, documents: true }} />
```

Notes:

- The registry is **module/process scoped** (consistent with `setLocalToolsAdapter`
  and `localToolsStore`). Multiple chat instances on one page share it. Under SSR
  or in tests, call `clearRegisteredLocalTools()` to reset between
  requests/cases.
- Registration affects **recognition and advertised definitions only**, never
  transport — executing a registered tool still requires the host-injected
  executor to handle that name.
- `LocalToolName` is now `(typeof BUILTIN_LOCAL_TOOL_NAMES)[number] | (string & {})`
  (mirrors `StreamHubEventType`): additive at runtime, type-widening at compile
  time.

## Stream Replay Behavior

`createReplayClient(transport)` opens an `EventSource` from the chat-core endpoint at the supplied `{ sessionId, fromSeq }` cursor and yields each raw `MessageEvent.data` payload through an `AsyncIterable`. Consumers parse the JSON envelope and route it to the projection pipeline.

- The replay cursor (`fromSeq`) lets consumers resync after navigation, refresh, or transient SSE drops without re-fetching the full bootstrap.
- The transport returns an async iterable that closes cleanly on `EventSource` error and yields a final `done` sentinel through the underlying stream contract.
- Wire event types (per `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md`): `reasoning_delta`, `content_delta`, `tool_call_start`, `tool_call_delta`, `tool_call_result`, `status`, `error`, `done`.

## Renderer Registry Behavior

`createRendererRegistry()` returns a `Map`-backed registry consumers can configure per surface:

- `registry.register(toolName, renderer)` registers a typed renderer for a tool name.
- `registry.get(toolName)` resolves the renderer; unknown tool names fall through to `registry.default`.
- The default fallback is `JSON.stringify`, suitable for development and unknown tools; product surfaces are expected to register concrete renderers.
- Renderers are pure functions over the tool result payload; they MUST NOT reach into app-specific stores. App-specific renderers (initiatives, folders, comments, document cards, Chrome tab actions, VSCode local tools) are registered by hosts and never imported by the package.

## Dependency Rules

- Consumes only `@sentropic/chat-core` wire contracts via HTTP/SSE.
- No runtime dependency on `@sentropic/llm-mesh`, API source, or app-owned stores.
- Peer dependency: `svelte ^5.0.0`.
- TypeScript exports compile to `dist/` via `tsc -p tsconfig.json`; published tarball includes both `dist/` and `src/` so SvelteKit consumers can resolve `.svelte` source through the workspace `"svelte"` export condition while Node consumers resolve `.js`/`.d.ts` from `dist/`.

## Local Development

This package is consumed as a workspace dependency by `ui/` (per BR-14a Lot 3). Validation targets (run from repository root):

```sh
make typecheck-chat-ui ENV=<branch-env>
make test-chat-ui ENV=<branch-env>
make build-chat-ui ENV=<branch-env>
make pack-chat-ui ENV=<branch-env>
```

Publication is wired to GitHub Actions via the `validate-chat-ui` and main-only `publish-chat-ui` jobs (OIDC trusted publishing with skip-if-version-exists safety).
