# P0 — Runtime dependency closure and public symbol ownership

Snapshot: Sentropic `ea20bd9c026e9717d911514e763f8911b6981dde` (2026-10-28). See [contract](CHAT_MIGRATION_P0.md).

V = reusable visual (future DS custody); R = Sentropic `chat-runtime`; H = justified host integration. Mixed rows name a required split, never unassigned ownership.

Every R/mixed module's relative dependency is listed. P1 moves R dependencies together; a V dependency becomes an injected pure contract/helper so runtime never imports DS views. External dependencies and Svelte bindings remain separately qualified.

| Runtime/mixed source | Relative imports/re-exports |
| --- | --- |
| `checkpoints/checkpointState.ts` | No relative imports |
| `checkpoints/classifier.ts` | `../utils/localToolStreamSync.js` |
| `checkpoints/index.ts` | `./checkpointState.js`, `./classifier.js` |
| `client/chat-core-host.ts` | `./streamTypes.js` |
| `client/replay.ts` | `./transport.js` |
| `client/streamHistory.ts` | `./streamTypes.js` |
| `client/streamHub.ts` | `./streamHistory.js`, `./streamTypes.js` |
| `client/streamTypes.ts` | No relative imports |
| `client/transport.ts` | `./chat-core-host.js` |
| `comments/host.ts` | `./types.js` |
| `comments/index.ts` | `./host.js`, `./state.js`, `./types.js`, `./utils.js` |
| `comments/state.ts` | `./host.js`, `./types.js`, `./utils.js` |
| `comments/types.ts` | No relative imports |
| `comments/utils.ts` | `./types.js` |
| `context/context-entry.ts` | `../state/chat-context.js` |
| `context/index.ts` | `../state/chat-context.js`, `./context-entry.js`, `./module.js` |
| `context/module.ts` | `../state/chat-context.js`, `./context-entry.js` |
| `documents/attachmentState.ts` | `../state/chatProjection.js`, `./types.js` |
| `documents/generatedFileCards.ts` | `./types.js` |
| `documents/index.ts` | `./attachmentState.js`, `./generatedFileCards.js`, `./types.js` |
| `documents/types.ts` | No relative imports |
| `hosts/createWebHost.ts` | `../client/streamTypes.js`, `../client/transport.js`, `../renderers/registry.js`, `./types.js` |
| `hosts/types.ts` | `../documents/types.js` |
| `index.ts` | `./client/replay.js`, `./client/streamHistory.js`, `./client/streamHub.js`, `./client/streamTypes.js`, `./client/transport.js`, `./hosts/createWebHost.js`, `./hosts/types.js`, `./renderers/registry.js`, `./state/agentsEntry.js`, `./state/agentsSort.js`, `./state/agentsViewMarkers.js`, `./state/chatDraft.js`, `./state/chatProjection.js`, `./state/chatWidgetShell.js`, `./state/streamMessageProjection.js`, `./state/streamMessageSmoothing.js`, `./stores/chatWidgetLayout.js`, `./stores/localTools.js`, `./utils/chat-run-projection.js`, `./utils/chat-steer.js`, `./utils/chat-tool-scope.js`, `./utils/localToolStreamSync.js` |
| `state/agentsViewMarkers.ts` | `../hosts/createWebHost.js`, `./agentsEntry.js` |
| `state/chat-context.ts` | No relative imports |
| `state/chatAttachments.ts` | `../documents/types.js` |
| `state/chatDraft.ts` | `./chatAttachments.js` |
| `state/chatLoopController.ts` | `../utils/chat-run-projection.js`, `../utils/model-selection.js`, `./chatDraft.js`, `./chatProjection.js` |
| `state/chatProjection.ts` | `../utils/chat-run-projection.js` |
| `state/chatSessionHydration.ts` | `./chatProjection.js` |
| `state/chatSessionRuntime.ts` | `./chatAttachments.js`, `./chatDraft.js`, `./chatLoopController.js`, `./chatProjection.js`, `./chatSessionHydration.js` |
| `state/sessionList.ts` | No relative imports |
| `state/streamMessageProjection.ts` | No relative imports |
| `stores/localTools.ts` | `../hosts/types.js` |
| `utils/chat-run-projection.ts` | No relative imports |
| `utils/chat-steer.ts` | No relative imports |
| `utils/chat-tool-scope.ts` | No relative imports |
| `utils/localToolStreamSync.ts` | No relative imports |
| `utils/model-selection.ts` | No relative imports |

`chatLoopController` currently imports model-selection, draft, projection and run-projection: all relocate together. Runtime consumes normalized renderer data contracts, never `StreamMessage`/`ChatTimeline`/`ChatComposer` implementations. `svelte/store` bindings in optional modules/localTools are retained in Sentropic; do not copy stores into DS to make a view work.

The generated-source map assigns every public `export` symbol by its declaring module, including symbols reachable only through mixed barrels. P1 must split `documents` attachment reducers/generated-event extraction from attachment views, `comments` host/retrieval/state from panel data and callbacks, `checkpoints` classifier/state from normalized cards, and `context` selection/retrieval from chip/picker view contracts.
