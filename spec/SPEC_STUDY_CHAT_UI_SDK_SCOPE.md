# SPEC_STUDY - BR14a Chat UI SDK Scope

Status: Lot N-1 final consolidation after modular refactor and root UAT.

## Goal

Extract the reusable chat UI surface as `@sentropic/chat-ui`, not `@sentropic/chat`.

`@sentropic/chat-ui` is the Svelte reference UI package for chat sessions, stream rendering, optimistic client state, local-tool handoff, and host integration. It consumes the `@sentropic/chat-core` wire contract through HTTP/SSE client boundaries only. It does not reach into `@sentropic/llm-mesh`, API internals, persistence adapters, or workflow orchestration.

## Inventory Summary

| Area | Current files | Package decision |
| --- | --- | --- |
| Svelte chat shell | `ui/src/lib/components/ChatPanel.svelte`, `ChatWidget.svelte`, `StreamMessage.svelte` | Move reusable render/state behavior into package components. Keep app-owned wrappers for route context, workspace stores, comments, document upload, Google Drive picker, navigation, and Sentropic app stores until explicit adapter props replace them. |
| Stream client state | `ui/src/lib/stores/streamHub.ts` | Move as package client store after injecting auth/workspace/base-url/host transport dependencies. Current direct dependencies on app config, session, workspace scope, `window`, EventSource, Chrome runtime, and VSCode shim must become adapter inputs. |
| UI layout state | `ui/src/lib/stores/chatWidgetLayout.ts` | Move to package as a small Svelte store. |
| Local tool client state | `ui/src/lib/stores/localTools.ts`, `ui/src/lib/utils/localToolStreamSync.ts` | Split package-owned tool definitions, execution state, permission prompt shapes, and pending-tool parsing from host-owned execution transport. Chrome and VSCode remain host adapters. |
| Chat run projection | `ui/src/lib/utils/chat-run-projection.ts` | Move to package client utilities. It is pure stream-event projection logic. |
| Steering client | `ui/src/lib/utils/chat-steer.ts` | Move only after replacing `apiPost` with package `ChatTransport`. |
| Tool scope | `ui/src/lib/utils/chat-tool-scope.ts` | Move generic toggle/default logic, but keep app-specific workspace/tool catalog ownership outside the package. |
| Web handoff | `ui/src/lib/core/chatwidget-handoff.ts` | Move shape constants/types or re-export them from package. Storage ownership remains host-owned. |
| Chrome bridge | `ui/src/lib/upstream/injected-script.ts` | Stay app/host-owned. The package only exposes the host adapter interface consumed by the chat UI. DOM injection and extension bridge code are not package core. |
| VSCode bridge/runtime | `ui/vscode-ext/auth-bridge.ts`, `extension.ts`, `host-handler.ts`, `local-tools.ts`, `stream-proxy.ts`, `vscode-bridge.ts`, `webview-entry.ts` | Stay host-owned. Package supplies UI components, client stores, transport/replay primitives, and adapter types. VSCode extension activation, secrets, workspace inspection, local command execution, webview HTML, and message bridge remain outside the package. |
| Chat-core/server wire | `packages/chat-core/src/types.ts`, `stream-port.ts`, `stream-sequencer-port.ts`, `api/src/routes/api/chat.ts`, `api/src/routes/api/streams.ts`, `api/src/services/chat-service.ts` | Package consumes current HTTP/SSE behavior and prepares for the versioned `chat-core` stream protocol. It must not import API source directly. |

## Lot 8 Dependency Map

Current large-file line counts:

| File | Lines | Current role | Refactor target |
| --- | ---: | --- | --- |
| `ui/src/lib/components/ChatPanel.svelte` | 6107 | App chat session, comments, documents, local tools, runtime projection, composer, history, and API orchestration. | App wrapper plus extracted package timeline/composer/state modules. |
| `ui/src/lib/components/ChatWidget.svelte` | 3249 | App launcher, dock/floating shell, sessions header, jobs tab, comments tab, extension settings, Chrome/VSCode auth/config surfaces. | App wrapper around package widget shell; jobs/comments/extension settings stay app-owned. |
| `ui/src/lib/components/StreamMessage.svelte` | 75 | App wrapper that injects the app `streamHub` into the package component and preserves the previous public prop surface. | Keep as compatibility wrapper while package owns stream rendering. |
| `ui/src/lib/stores/streamHub.ts` | 533 | App-wide SSE singleton for chat streams, job updates, entity updates, workspace/comment/lock/presence updates, Chrome proxy, VSCode detection, auth/workspace URL construction. | Package `createStreamHub(options)` plus app singleton wrapper that injects host dependencies. |
| `ui/src/lib/stores/queue.ts` | 203 | App-owned jobs API store and queue actions. | Remains app-owned. Package receives jobs panel/badges as injected UI state. |
| `ui/src/lib/components/QueueMonitor.svelte` | 271 | App-owned jobs panel and job stream-history viewer. | Remains app-owned; may reuse package `StreamMessage` through app wrapper. |
| `packages/chat-ui/src/components/StreamMessage.svelte` | 1134 | Package stream renderer with injected `streamClient`, generated-file types from package contracts, and pure projection/smoothing helpers in `packages/chat-ui/src/state/`. | Active package component consumed by the app wrapper. |
| `packages/chat-ui/src/components/{ChatPanel,ChatWidget}.svelte` | 9356 total | Current package copies still import `$lib/*` and mirror the app files. | Treat as inactive scaffolding until Lots 11-13 remove all app imports. |

Dependency summary:

- `ChatPanel.svelte` depends on app auth/session (`$lib/stores/session`), app navigation/context, comments API, document upload and Google Drive picker, entity stores (`folders`, `organizations`, `initiatives`), workspace scope/RBAC, app REST helpers, app `streamHub`, local-tool store, generated document helpers, markdown helpers, injected Chrome script generation, checkpoint delta helpers, and package pure utilities.
- `ChatWidget.svelte` depends on app API client init, session auth, queue store/actions, `streamHub`, folders route state, handoff state, extension auth/config utilities, code-agent prompt profile logic, `QueueMonitor`, app `ChatPanel`, and `MenuPopover`.
- `StreamMessage.svelte` no longer imports app `$lib/*` modules. The app wrapper owns the concrete `streamHub` singleton injection, while the package component owns stream rendering and helper state.
- `streamHub.ts` has three separable layers: event normalization/history, subscription/replay dispatch, and app transport setup. Only the first two layers belong in `@sentropic/chat-ui`; auth, workspace scoping, base URL, EventSource, Chrome proxy, VSCode runtime detection, and browser globals are host concerns.
- `queue.ts` and `QueueMonitor.svelte` are not chat UI package core. They represent Sentropic job tracking and queue control, even when a job renders chat stream history.

## Lot 8 Modular Contract

Package-owned modules:

- Stream event model, including normalized chat event names, `StreamHubEvent`, subscription keys, replay limits, per-stream history, dedupe, and delta aggregation.
- Stream hub factory, implemented as `createStreamHub(options)` with no global singleton.
- Stream rendering state for reasoning, tool calls, content deltas, terminal status, smoothing, passive history hydration, todo runtime cards, and generated file notifications.
- Chat timeline projection and composer draft state, independent from Sentropic route stores and REST helpers.
- Local-tools state machine, permission prompt shapes, pending-tool parsing, and host adapter contracts.
- Renderer registry and default fallback renderers.
- Host adapter types and small host factory helpers that do not import app stores.

App-owned modules:

- Auth/session stores, workspace scope/RBAC, route context, navigation, toasts, local storage handoff, and API client initialization.
- Chat session REST orchestration until it is expressed through a host-supplied `ChatTransport`.
- Comments, mentions, thread assignment, section labels, and comment-mode UI.
- Session documents, generated document download, upload, Google Drive picker/connectors, and document-source menus.
- Entity stores and labels for folders, organizations, initiatives, opportunities, and dashboards.
- Jobs and queue tracking: `ui/src/lib/stores/queue.ts`, `ui/src/lib/components/QueueMonitor.svelte`, `/queue/*` API calls, active/failed badges, purge/cancel/retry/delete actions.
- Chrome extension runtime messaging, injected script bridge, side-panel configuration, tab permissions, and endpoint/settings UI.
- VSCode extension activation, bridge, auth, workspace mapping, stream proxy, local command/file/git execution, and settings UI.

Injected across the boundary:

- `transport`: chat session/message/checkpoint/feedback/tool-result REST client.
- `streamClient`: stream subscribe/replay client, usually backed by the app `streamHub` wrapper.
- `contextProvider`: active route/workspace/entity context.
- `labels`: i18n strings or label resolver used by package components.
- `rendererRegistry`: app-specific tool result/card renderers.
- `localToolsAdapter`: Chrome or VSCode local-tool transport.
- `jobsPanel`: optional app-owned queue panel renderer.
- `commentsPanel`: optional app-owned comment panel renderer.
- `documentAdapter`: upload, Google Drive import, generated file download, and session document callbacks.
- `callbacks`: session selected/created/deleted, terminal stream status, feedback, retry, rollback, copy, and scroll/focus hooks.

Activation order:

1. Extract `streamHub` internals into package factory files while keeping `ui/src/lib/stores/streamHub.ts` as the app singleton wrapper.
2. Activate package `StreamMessage.svelte`; the app wrapper injects the app stream client, labels, and generated-file handling.
3. Split `ChatPanel.svelte` into package timeline/composer/state modules plus `ui/src/lib/components/chat/AppChatPanel.svelte`.
4. Activate package `ChatWidget.svelte` as a launcher/layout shell; keep jobs, comments, and extension settings app-owned and injected.
5. Add host adapters and rewire app wrappers to consume the package implementations.
6. Add throughput/history regression tests before full UAT.

Graphify note: the manual import and responsibility map is sufficiently concrete for Lot 8. Graphify is reserved for a later audit only if the app/package dependency graph becomes ambiguous during code movement.

## Final Implementation Snapshot

BR-14a now ships `@sentropic/chat-ui` as a package consumed by the web app through app-owned wrappers and host adapters.

Package-owned:

- `StreamMessage.svelte`: active stream renderer with injected `streamClient` and label resolver.
- `ChatTimeline.svelte`: render-only keyed timeline over projected timeline items.
- `ChatComposer.svelte`: render-only composer shell with injected control snippets.
- `ChatWidget.svelte`: active widget shell that can render the app-owned shell/panels through snippets.
- `ChatPanel.svelte`: package shell boundary that accepts host, transport, stream, context, renderer, and snippet inputs; the full Sentropic session orchestration remains app-owned.
- `createStreamHub(options)`, `StreamHubHistory`, stream event contracts, chat projection helpers, draft state, widget shell state, local-tools state, renderer registry, and web-host factory.

App-owned:

- `ui/src/lib/components/ChatPanel.svelte`, `ChatWidget.svelte`, and `StreamMessage.svelte` remain compatibility wrappers that inject Sentropic app services into the package.
- `ui/src/lib/components/chat/AppChatPanel.svelte` owns session orchestration, REST calls, comments, documents, generated files, local tool continuation, runtime details, and history hydration.
- `ui/src/lib/chat/{context-provider,document-adapter,comment-adapter,session-adapter,web-host-adapter}.ts` own Sentropic-specific adapter wiring.
- `ui/src/lib/components/QueueMonitor.svelte` and `ui/src/lib/stores/queue.ts` remain app-owned; jobs are integrated through widget badges and the app queue panel.
- Chrome and VSCode runtime bridges remain host-owned and inject package local-tool adapters where needed.

Root UAT note: the final StreamMessage overflow regression was fixed by including `../packages/chat-ui/src/**/*.{html,js,svelte,ts}` in the UI Tailwind content scan so package-owned `max-h-16` and `max-h-24` utilities are generated again.

BR-07 handoff notes:

- UI package consumers must resolve the raw Svelte/TypeScript source subpaths declared in `packages/chat-ui/package.json`; BR-14a intentionally keeps exports on `src/` for Vite/SvelteKit consumption.
- Package pretest/build steps must keep Svelte peer dependencies (`svelte`, `@lucide/svelte`, `svelte-streamdown`) available to `@sentropic/chat-ui`.
- Any BR-07 packaging or npm-pretest flow that builds the app UI must include `packages/chat-ui/src/**/*.{html,js,svelte,ts}` in the Tailwind scan, either through this branch's UI config or an equivalent package-aware content glob.
- The app still owns Sentropic-specific queue/jobs, comments, documents, Google Drive, Chrome runtime, and VSCode runtime adapters; npm packaging must not infer those as package-owned runtime responsibilities.

## Final Package Shape

Target package: `packages/chat-ui`, package name `@sentropic/chat-ui`.

Public entrypoints currently exported by `packages/chat-ui/package.json`:

```ts
@sentropic/chat-ui
@sentropic/chat-ui/client/transport
@sentropic/chat-ui/client/replay
@sentropic/chat-ui/client/streamTypes
@sentropic/chat-ui/client/streamHistory
@sentropic/chat-ui/client/streamHub
@sentropic/chat-ui/state/chatDraft
@sentropic/chat-ui/state/chatProjection
@sentropic/chat-ui/state/chatWidgetShell
@sentropic/chat-ui/state/streamMessageProjection
@sentropic/chat-ui/state/streamMessageSmoothing
@sentropic/chat-ui/renderers/registry
@sentropic/chat-ui/hosts/types
@sentropic/chat-ui/hosts/createWebHost
@sentropic/chat-ui/stores/chatWidgetLayout
@sentropic/chat-ui/stores/localTools
@sentropic/chat-ui/utils/chat-run-projection
@sentropic/chat-ui/utils/chat-steer
@sentropic/chat-ui/utils/chat-tool-scope
@sentropic/chat-ui/utils/localToolStreamSync
@sentropic/chat-ui/components/ChatPanel.svelte
@sentropic/chat-ui/components/ChatWidget.svelte
@sentropic/chat-ui/components/StreamMessage.svelte
@sentropic/chat-ui/components/ChatTimeline.svelte
@sentropic/chat-ui/components/ChatComposer.svelte
```

`@sentropic/chat-ui` re-exports the stable TypeScript surface. Svelte components are imported through explicit `./components/*` subpaths so bundlers keep `.svelte` handling intact.

## Svelte Exports

Component subpaths export:

- `ChatWidget.svelte`: package widget shell with active tab, job badge counts, labels, purge callback, and snippet-based shell/panel injection.
- `ChatPanel.svelte`: package shell boundary accepting host/transport/stream/context/renderer inputs and header/timeline/composer snippets.
- `StreamMessage.svelte`: active stream replay/render component with injected `streamClient`, injected `labels`, `streamId`, `status`, `initialEvents`, `subscriptionMode`, `runtimeSummary`, `onTerminal`, `onStreamEvent`, `onGeneratedFile`, and `onTodoRuntime`.
- `ChatTimeline.svelte`: keyed render-only timeline over `ChatProjectedTimelineItem[]`.
- `ChatComposer.svelte`: render-only composer surface with injected controls and floating layers.

Package components may depend on Svelte, `svelte/store`, `svelte-i18n` only through injected dictionaries/labels, `svelte-streamdown`, and UI/icon dependencies already required by the extracted components. App-owned components such as document pickers, comments, workspace menus, and entity-specific cards must be passed as renderers or slots instead of imported directly.

## Stores And Client Exports

Client/state/store subpaths export:

- `createStreamHub(options)`: instance-based replacement for the singleton `streamHub`. Options include `baseUrl`, `getAuthState`, `getWorkspaceId`, `eventSourceFactory`, `extensionPortFactory`, `windowTarget`, replay limits, and optional logger.
- `createChatWidgetLayoutStore(initial?)`: package-owned layout store for `floating` / `docked` state.
- `createLocalToolsStore(adapter)`: local-tool availability, definitions, executions, permission prompts, and policy operations through an injected adapter.
- `projectAssistantRunSegments`, `mergeProjectionHistoryEvents`, `appendLiveProjectionEvent`, `countLinkedSteerMessages`, `getLinkedSteerMessageIds`.
- `postChatSteer(transport, input)` and timeline helper `insertSteerMessageInTimeline`.
- `parsePendingLocalToolCallsFromStatusPayload`, `shouldResetLocalToolStateForFreshRound`, `filterPermissionPromptsForPendingStream`.
- `computeToolToggleDefaults`, `computeVisibleToolToggleIds`, `computeEnabledToolIds`, `filterToolTogglesByWorkspaceType`.

The package must avoid global singletons for stream, session, or local-tool state. Consumers can create one client per web app, Chrome side panel, VSCode webview, or embedded widget.

## Transport And Replay Boundary

`@sentropic/chat-ui/client` owns browser-side transport interfaces, not server behavior.

Primary interface:

```ts
export interface ChatTransport {
  createSession(input: CreateChatSessionInput): Promise<CreateChatSessionResult>;
  listSessions(): Promise<ListChatSessionsResult>;
  getBootstrap(sessionId: string): Promise<ChatSessionBootstrap>;
  getHistory(sessionId: string, options?: HistoryOptions): AsyncIterable<ChatHistoryItem>;
  sendMessage(input: SendChatMessageInput): Promise<SendChatMessageResult>;
  stopAssistantMessage(messageId: string): Promise<void>;
  steerAssistantMessage(messageId: string, input: SteerInput): Promise<SteerResult>;
  setFeedback(messageId: string, input: FeedbackInput): Promise<void>;
  editMessage(messageId: string, input: EditMessageInput): Promise<EditMessageResult>;
  retryMessage(messageId: string, input: RetryMessageInput): Promise<RetryMessageResult>;
  submitToolResult(messageId: string, input: ToolResultInput): Promise<ToolResultSubmitResult>;
}
```

Replay interface:

```ts
export interface ChatStreamClient {
  subscribe(input: StreamSubscribeInput, onEvent: (event: ChatUiStreamEvent) => void): Unsubscribe;
  replay(input: StreamReplayInput): Promise<ChatUiStreamEvent[]>;
}
```

Current app wire behavior:

- Chat REST endpoints live under `/api/v1/chat/*`.
- `POST /chat/messages` returns `sessionId`, `userMessageId`, `assistantMessageId`, `streamId`, and `jobId`.
- `GET /chat/sessions/:id/bootstrap` returns messages, todo runtime, checkpoints, documents, and assistant runtime details.
- `GET /chat/sessions/:id/history` streams NDJSON history for large sessions.
- `POST /chat/messages/:id/tool-results` accepts local-tool output and resumes generation when all pending local tools are satisfied.
- `GET /streams/sse` emits `job_update`, entity/comment/lock/presence/workspace events, and chat stream event types `reasoning_delta`, `content_delta`, `tool_call_start`, `tool_call_delta`, `tool_call_result`, `status`, `error`, `done`.
- Current replay is cursor/sequence based through `/streams/sse?streamIds=...&cursor=...` plus `streamHub` in-memory history. The package must expose replay behind `ChatStreamClient` so BR14b's future `GET /sessions/:id/events?fromSeq=N` contract can replace the current endpoint without component rewrites.

The transport must preserve sequence ordering, dedupe by sequence, aggregate text/tool-argument deltas for late subscribers, handle gap catch-up, and keep stop/steer/retry/tool-result continuation as explicit client methods.

## Renderer Registry Boundary

`@sentropic/chat-ui/renderers` exports a renderer registry:

```ts
export interface ToolResultRenderer<Props = unknown> {
  id: string;
  canRender(input: ToolResultRenderInput): boolean;
  component: SvelteComponentLike<Props>;
  mapProps(input: ToolResultRenderInput): Props;
}

export interface RendererRegistry {
  register(renderer: ToolResultRenderer): void;
  resolve(input: ToolResultRenderInput): ToolResultRenderer | null;
}
```

Default package renderers:

- Markdown/text fallback for unknown tool results.
- JSON fallback with bounded depth.
- Generated file cards when the stream exposes file metadata.
- Todo/plan runtime cards for `plan` tool results.
- Permission/local-tool prompt renderer shell.

App-registered renderers:

- Sentropic business objects such as initiatives, folders, organizations, opportunities, proposals, products, gates, comments, and document-source cards.
- Chrome tab action/read cards.
- VSCode local tool cards.

The registry boundary prevents `StreamMessage.svelte` and `ChatPanel.svelte` from importing application-specific render code while preserving current tool-call rendering.

## Host Adapter Boundary

`@sentropic/chat-ui/hosts` exports host adapter types and minimal factories.

Common adapter:

```ts
export interface ChatUiHostAdapter {
  kind: 'web' | 'chrome' | 'vscode' | string;
  transport: ChatTransport;
  streamClient: ChatStreamClient;
  localTools?: LocalToolHostAdapter;
  auth?: ChatAuthAdapter;
  navigation?: ChatNavigationAdapter;
  storage?: ChatStorageAdapter;
  contextProvider?: ChatContextProvider;
  renderers?: RendererRegistry;
}
```

Web adapter:

- Owns app auth/session wiring, workspace scope, REST fetch, native EventSource, navigation, local storage handoff, and app toasts.
- Keeps Sentropic route context, comments, document upload, Google Drive picker, entity stores, and workspace RBAC outside the package unless passed through typed callbacks/renderers.

Chrome adapter:

- Owns extension runtime messaging, side panel/floating shell host, stream proxy port, tab permission policy, `tab_read` / `tab_action` execution, origin-scoped consent, settings endpoint, and injected-script bridge.
- Package local-tool UI calls the adapter; it never imports `chrome.runtime` directly.

VSCode adapter:

- Owns `acquireVsCodeApi`, webview host bridge, extension activation, session token persistence, secrets, workspace mapping, code-agent prompt profile, stream proxy, local command/file/git tools, permission policy, and host messaging.
- Package components mount inside the webview through the adapter; they never import VSCode APIs or Node modules.

## Image Attachment Presentation (BR-38a)

- The composer renders a single attachment band at the top of the edit surface for both session documents and pending image attachments; the generic `ChatComposer` tray slot is left unused by the web host to avoid a second, divergent attachment surface.
- Attachment items share one box style: a 40x40 visual (image preview for images, file-type icon for documents), filename, status, and a remove control. Display is deduplicated by `documentId` so an image never appears twice.
- Removing an item from the band removes both the pending composer attachment and its session context document when present.
- Image preview/enlarge (lightbox) is an app-level chat presentation concern in `AppChatPanel`, co-located with the inline message thumbnail rendering; `@sentropic/chat-ui` stays presentation-agnostic about app document/download URLs.
- Download/preview URLs are resolved by the web host adapter from `documentId`; the package never builds Sentropic document URLs.
- Image MIME support for attachments: `image/png`, `image/jpeg`, `image/webp`, `image/gif` (see `chatAttachments` state).

## Non-Goals

- No direct import from `@sentropic/llm-mesh`.
- No provider, model, credential, retry, fallback, quota, cost, or model catalog abstraction.
- No server persistence, database schema, Drizzle, Postgres, or stream storage implementation.
- No chat reasoning loop, tool loop, continuation, checkpoint runtime, queue runtime, or workflow orchestration.
- No Hono route implementation inside `@sentropic/chat-ui`.
- No Chrome extension service-worker implementation.
- No VSCode extension activation, Node tool execution, secret storage, or file-system access.
- No repository/package metadata, Makefile, workflow, or npm publication wiring in Lot 1.
- No behavior change or code movement before this package boundary is accepted.

## Lot 2 Implementation Notes

- Start with package-owned copies and app wrappers before rewiring imports.
- Replace hardcoded `$lib/*` imports inside moved Svelte components with explicit props, adapters, renderers, or package utilities.
- Convert `streamHub` from singleton to `createStreamHub`; keep an app singleton wrapper in `ui/src/lib/stores/streamHub.ts` during adoption.
- Keep current API endpoints stable in Lot 2/3; introduce compatibility shims only if the package boundary cannot consume current wire behavior.
- Use current tests as contract anchors: `ui/tests/stores/streamHub.test.ts`, stream projection tests, tool-scope tests, local-tool sync tests, upstream bridge tests, and VSCode extension tests.
