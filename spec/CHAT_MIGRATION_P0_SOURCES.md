# P0 — Complete source relocation map

Snapshot: Sentropic `ea20bd9c026e9717d911514e763f8911b6981dde` (2026-10-28). See [contract](CHAT_MIGRATION_P0.md).

V = reusable visual (future DS custody); R = Sentropic `chat-runtime`; H = justified host integration. Mixed rows name a required split, never unassigned ownership.

Every tracked source/declaration is listed. R moves in P1 to the same suffix under `packages/chat-runtime/src/`; V stays in chat-ui until U0 authorizes transfer. R+V splits at that named boundary in P1.

| Source relative to `packages/chat-ui/` | Disposition |
| --- | --- |
| `src/checkpoints/checkpointState.ts` | R: runtime state/transport/policy helpers |
| `src/checkpoints/classifier.ts` | R: runtime state/transport/policy helpers |
| `src/checkpoints/index.ts` | R+V: split barrel; remove runtime re-exports |
| `src/client/chat-core-host.ts` | R: runtime state/transport/policy helpers |
| `src/client/replay.ts` | R: runtime state/transport/policy helpers |
| `src/client/streamHistory.ts` | R: runtime state/transport/policy helpers |
| `src/client/streamHub.ts` | R: runtime state/transport/policy helpers |
| `src/client/streamTypes.ts` | R: runtime state/transport/policy helpers |
| `src/client/transport.ts` | R: runtime state/transport/policy helpers |
| `src/comments/CommentsPanel.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/comments/CommentsPanel.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/comments/host.ts` | R: runtime state/transport/policy helpers |
| `src/comments/index.ts` | R+V: split barrel; remove runtime re-exports |
| `src/comments/state.ts` | R: runtime state/transport/policy helpers |
| `src/comments/types.ts` | R+V: split neutral view types from runtime contracts |
| `src/comments/utils.ts` | R: runtime state/transport/policy helpers |
| `src/components/AgentsList.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/AgentsList.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatComposer.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatComposer.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatContextPicker.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatContextPicker.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatConversation.svelte` | V: compose DS primitives; inject runtime ports |
| `src/components/ChatConversation.svelte.d.ts` | V: compose DS primitives; inject runtime ports |
| `src/components/ChatDock.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatDock.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatPanel.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatPanel.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatPanelShell.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatPanelShell.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatPlacementDropZones.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatPlacementDropZones.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatPlacementMenuButton.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatPlacementMenuButton.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatSessionsBar.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatSessionsBar.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatTimeline.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatTimeline.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatWidget.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatWidget.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatWidgetPager.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatWidgetPager.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatWidgetTabBar.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ChatWidgetTabBar.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ContextChips.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ContextChips.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/MessageActions.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/MessageActions.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ModelSelector.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/ModelSelector.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/SessionList.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/SessionList.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/components/StreamMessage.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/components/StreamMessage.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/context/context-entry.ts` | R: runtime state/transport/policy helpers |
| `src/context/index.ts` | R+V: split barrel; remove runtime re-exports |
| `src/context/module.ts` | R: runtime state/transport/policy helpers |
| `src/documents/AttachmentBand.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/documents/AttachmentBand.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/documents/GeneratedFileCardTray.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/documents/GeneratedFileCardTray.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/documents/ImageLightbox.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/documents/ImageLightbox.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/documents/MessageAttachments.svelte` | V: reusable views/declarations/layout/theme/registry |
| `src/documents/MessageAttachments.svelte.d.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/documents/attachmentState.ts` | R: runtime state/transport/policy helpers |
| `src/documents/generatedFileCards.ts` | R: runtime state/transport/policy helpers |
| `src/documents/index.ts` | R+V: split barrel; remove runtime re-exports |
| `src/documents/types.ts` | R+V: split neutral view types from runtime contracts |
| `src/hosts/createWebHost.ts` | R: runtime state/transport/policy helpers |
| `src/hosts/types.ts` | R+V: split neutral view types from runtime contracts |
| `src/index.ts` | R+V: split barrel; remove runtime re-exports |
| `src/renderers/registry.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/state/agentsEntry.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/state/agentsSort.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/state/agentsViewMarkers.ts` | R: principal-scoped persistence; host supplies storage |
| `src/state/chat-context.ts` | R: runtime state/transport/policy helpers |
| `src/state/chatAttachments.ts` | R: runtime state/transport/policy helpers |
| `src/state/chatDraft.ts` | R: runtime state/transport/policy helpers |
| `src/state/chatLoopController.ts` | R: runtime state/transport/policy helpers |
| `src/state/chatPlacement.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/state/chatPlacementClasses.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/state/chatPlacementDnd.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/state/chatPlacementMenu.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/state/chatPlacementMigration.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/state/chatProjection.ts` | R: runtime state/transport/policy helpers |
| `src/state/chatSessionHydration.ts` | R: runtime state/transport/policy helpers |
| `src/state/chatSessionRuntime.ts` | R: runtime state/transport/policy helpers |
| `src/state/chatWidgetShell.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/state/sessionList.ts` | R+V: runtime history assembly; visual list-entry contract |
| `src/state/streamMessageProjection.ts` | R+V: runtime-result normalization; pure text formatting in V |
| `src/state/streamMessageSmoothing.ts` | V: normalized rendering helpers |
| `src/stores/chatWidgetLayout.ts` | V: reusable views/declarations/layout/theme/registry |
| `src/stores/localTools.ts` | R: runtime state/transport/policy helpers |
| `src/theme/chat-ui.css` | V: reusable views/declarations/layout/theme/registry |
| `src/utils/chat-run-projection.ts` | R: runtime state/transport/policy helpers |
| `src/utils/chat-steer.ts` | R: runtime state/transport/policy helpers |
| `src/utils/chat-tool-scope.ts` | R: runtime state/transport/policy helpers |
| `src/utils/composer-autosize.ts` | V: normalized rendering helpers |
| `src/utils/localToolStreamSync.ts` | R: runtime state/transport/policy helpers |
| `src/utils/markdown-refs.ts` | V: normalized rendering helpers |
| `src/utils/message-actions.ts` | V: normalized rendering helpers |
| `src/utils/model-selection.ts` | R: runtime state/transport/policy helpers |
