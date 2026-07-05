# @sentropic/chat-ui

Svelte reference UI package for `@sentropic/*` chat sessions: stream rendering, optimistic client state, local-tool handoff, renderer registry, and host adapter contracts. It consumes `@sentropic/chat-core` wire contracts through HTTP/SSE only and never reaches into `@sentropic/llm-mesh`, API internals, or persistence adapters.

## Public Surface

Re-exports the TypeScript surface; Svelte components are package-exported separately under `./components/*` so bundlers keep the `.svelte` handling.

- `@sentropic/chat-ui` — TS surface barrel: transport, replay, renderer registry, host adapter types, layout/local-tools stores, and chat utilities.
- `@sentropic/chat-ui/client/transport` — `ChatCoreTransport`, `ChatCoreTransportFactory`, `createDefaultTransport`.
- `@sentropic/chat-ui/client/replay` — `ReplayCursor`, `ReplayClient`, `createReplayClient`.
- `@sentropic/chat-ui/renderers/registry` — `ToolRenderer`, `RendererRegistry`, `createRendererRegistry`.
- `@sentropic/chat-ui/hosts/types` — `HostAdapter`, `WebHostAdapter`, `ChromeHostAdapter`, `VsCodeHostAdapter`, `LocalToolsAdapter`, `AnyHostAdapter`.
- `@sentropic/chat-ui/stores/chatWidgetLayout` — readable/writable layout stores for floating, docked, side-panel surfaces.
- `@sentropic/chat-ui/stores/localTools` — local tool registry + permission state stores wired to a `LocalToolsAdapter`.
- `@sentropic/chat-ui/utils/chat-run-projection` — pure stream-projection helpers (deltas to message segments).
- `@sentropic/chat-ui/utils/chat-steer` — pure steering primitives (interrupt, retry, rollback intents).
- `@sentropic/chat-ui/utils/chat-tool-scope` — pure tool-scope guards.
- `@sentropic/chat-ui/utils/localToolStreamSync` — pure local-tool stream synchronization helpers.
- `@sentropic/chat-ui/components/ChatPanel.svelte` — package-owned session/timeline shell.
- `@sentropic/chat-ui/components/ChatWidget.svelte` — package-owned launcher/panel shell.
- `@sentropic/chat-ui/components/StreamMessage.svelte` — package-owned stream renderer.

## Non-Goals

- No direct import from `@sentropic/llm-mesh`.
- No provider, model, credential, retry, quota, or model catalog abstraction.
- No server persistence, Drizzle schema, or stream storage.
- No chat reasoning loop, tool loop, checkpoint runtime, queue runtime, or workflow orchestration.
- No Hono routes, Chrome service worker, or VSCode extension activation/secret storage.

## Host Adapter Contract

Hosts supply runtime capabilities (HTTP base URL, local tool execution, navigation, storage). The package consumes them through narrow interfaces and never reaches the runtime directly.

Web host (browser app):

```ts
import type { WebHostAdapter } from '@sentropic/chat-ui/hosts/types';
import { createDefaultTransport } from '@sentropic/chat-ui/client/transport';

const transport = createDefaultTransport('https://api.example.com/api/v1');
const host: WebHostAdapter = { kind: 'web' };
```

Chrome host adapter (extension content/service worker context). The host owns the runtime-specific factory; the package only defines the `LocalToolsAdapter` contract.

```ts
// Host-owned factory (e.g. ui/src/lib/upstream/chrome-host-adapter.ts):
import type { LocalToolsAdapter } from '@sentropic/chat-ui/hosts/types';

export const createChromeLocalToolsAdapter = (
  runtime: typeof chrome.runtime,
): LocalToolsAdapter => ({ /* runtime-specific implementation */ });

// Host bootstrap:
import { setLocalToolsAdapter } from '@sentropic/chat-ui/stores/localTools';
setLocalToolsAdapter(createChromeLocalToolsAdapter(chrome.runtime));
```

VSCode host adapter (webview). Same pattern: the host owns the factory, the package owns the contract.

```ts
// Host-owned factory (e.g. ui/vscode-ext/local-tools-adapter.ts):
import type { LocalToolsAdapter } from '@sentropic/chat-ui/hosts/types';

export const createVsCodeLocalToolsAdapter = (
  deps: { bridge: VsCodeBridge },
): LocalToolsAdapter => ({ /* bridge-routed implementation */ });

// Webview bootstrap:
import { setLocalToolsAdapter } from '@sentropic/chat-ui/stores/localTools';
setLocalToolsAdapter(createVsCodeLocalToolsAdapter({ bridge }));
```

### Registering a host-owned local tool

External hosts (Diag, OpenERP, a mermaid editor, …) can register their OWN
local tool — a name + definition — without editing the package's built-in tool
set. The 16 sentropic built-ins (`tab_*`, `bash`, `ls`, `rg`, `file_*`, `git*`)
keep working identically; host registration is purely additive.

```ts
import {
  registerLocalTool,
  setLocalToolsAdapter,
} from '@sentropic/chat-ui/stores/localTools';

// 1. Register the tool name + JSON-schema definition advertised to the model.
registerLocalTool({
  name: 'render_mermaid',
  description: 'Render a Mermaid diagram in the host app.',
  parameters: {
    type: 'object',
    properties: { source: { type: 'string' } },
    required: ['source'],
  },
});

// 2. Wire the host executor (the transport that actually runs the tool).
setLocalToolsAdapter(createMyHostLocalToolsAdapter({ /* ... */ }));
```

Once registered:

- `isLocalToolName('render_mermaid')` returns `true`, so the controller (via the
  `attachLocalToolMachine` `isLocalToolName` hook) recognizes the model's
  `tool_call` as local and routes it through permission → host executor →
  tool-result, exactly like the built-ins.
- `getLocalToolDefinitions()` advertises the registered definition alongside the
  active runtime built-ins (deduplicated by name; a registered definition for a
  built-in name overrides that built-in's advertised entry).

API: `registerLocalTool(def)`, `registerLocalTools(defs)`,
`unregisterLocalTool(name)`, `clearRegisteredLocalTools()`,
`listRegisteredLocalTools()`, plus the `BUILTIN_LOCAL_TOOL_NAMES` const.

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
