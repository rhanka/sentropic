# P0 — Complete package entrypoint inventory

Snapshot: Sentropic `ea20bd9c026e9717d911514e763f8911b6981dde` (2026-10-28). See [contract](CHAT_MIGRATION_P0.md).

V = reusable visual (future DS custody); R = Sentropic `chat-runtime`; H = justified host integration. Mixed rows name a required split, never unassigned ownership.

Current package version: `0.34.1`. Root `.` also exports the symbols in `src/index.ts`; every declaration in the source map follows its module's classification. Public subpaths, including optional modules, are exhaustive below.

| Existing `@sentropic/chat-ui` entrypoint | P1 disposition |
| --- | --- |
| `.` | R+V: split barrel; remove runtime re-exports |
| `./checkpoints` | R+V: split barrel; remove runtime re-exports |
| `./client/chat-core-host` | R: runtime state/transport/policy helpers |
| `./client/replay` | R: runtime state/transport/policy helpers |
| `./client/streamHistory` | R: runtime state/transport/policy helpers |
| `./client/streamHub` | R: runtime state/transport/policy helpers |
| `./client/streamTypes` | R: runtime state/transport/policy helpers |
| `./client/transport` | R: runtime state/transport/policy helpers |
| `./comments` | R+V: split barrel; remove runtime re-exports |
| `./comments/CommentsPanel.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/AgentsList.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatComposer.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatContextPicker.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatConversation.svelte` | V: compose DS primitives; inject runtime ports |
| `./components/ChatDock.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatPanel.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatPanelShell.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatPlacementDropZones.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatPlacementMenuButton.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatSessionsBar.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatTimeline.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatWidget.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatWidgetPager.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ChatWidgetTabBar.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ContextChips.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/MessageActions.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/ModelSelector.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/SessionList.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./components/StreamMessage.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./context` | R+V: split barrel; remove runtime re-exports |
| `./documents` | R+V: split barrel; remove runtime re-exports |
| `./documents/AttachmentBand.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./documents/GeneratedFileCardTray.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./documents/ImageLightbox.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./documents/MessageAttachments.svelte` | V: reusable views/declarations/layout/theme/registry |
| `./hosts/createWebHost` | R: runtime state/transport/policy helpers |
| `./hosts/types` | R+V: split neutral view types from runtime contracts |
| `./renderers/registry` | V: reusable views/declarations/layout/theme/registry |
| `./state/agentsEntry` | V: reusable views/declarations/layout/theme/registry |
| `./state/agentsSort` | V: reusable views/declarations/layout/theme/registry |
| `./state/agentsViewMarkers` | R: principal-scoped persistence; host supplies storage |
| `./state/chat-context` | R: runtime state/transport/policy helpers |
| `./state/chatAttachments` | R: runtime state/transport/policy helpers |
| `./state/chatDraft` | R: runtime state/transport/policy helpers |
| `./state/chatLoopController` | R: runtime state/transport/policy helpers |
| `./state/chatPlacement` | V: reusable views/declarations/layout/theme/registry |
| `./state/chatPlacementClasses` | V: reusable views/declarations/layout/theme/registry |
| `./state/chatPlacementDnd` | V: reusable views/declarations/layout/theme/registry |
| `./state/chatPlacementMenu` | V: reusable views/declarations/layout/theme/registry |
| `./state/chatPlacementMigration` | V: reusable views/declarations/layout/theme/registry |
| `./state/chatProjection` | R: runtime state/transport/policy helpers |
| `./state/chatSessionHydration` | R: runtime state/transport/policy helpers |
| `./state/chatSessionRuntime` | R: runtime state/transport/policy helpers |
| `./state/chatWidgetShell` | V: reusable views/declarations/layout/theme/registry |
| `./state/sessionList` | R+V: runtime history assembly; visual list-entry contract |
| `./state/streamMessageProjection` | R+V: runtime-result normalization; pure text formatting in V |
| `./state/streamMessageSmoothing` | V: normalized rendering helpers |
| `./stores/chatWidgetLayout` | V: reusable views/declarations/layout/theme/registry |
| `./stores/localTools` | R: runtime state/transport/policy helpers |
| `./theme.css` | V: reusable views/declarations/layout/theme/registry |
| `./utils/chat-run-projection` | R: runtime state/transport/policy helpers |
| `./utils/chat-steer` | R: runtime state/transport/policy helpers |
| `./utils/chat-tool-scope` | R: runtime state/transport/policy helpers |
| `./utils/composer-autosize` | V: normalized rendering helpers |
| `./utils/localToolStreamSync` | R: runtime state/transport/policy helpers |
| `./utils/markdown-refs` | V: normalized rendering helpers |
| `./utils/message-actions` | V: normalized rendering helpers |
| `./utils/model-selection` | R: runtime state/transport/policy helpers |

R subpaths change package name to `@sentropic/chat-runtime` without compatibility forwarding. Pure view contracts remain available to DS without importing an implementation. `.` is rebuilt as a visual-only barrel. The P1 release is breaking; do not mix in the separately authorized tab rename.
