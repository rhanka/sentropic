# P0 — Public symbol inventory by declaring module

Snapshot: Sentropic `ea20bd9c026e9717d911514e763f8911b6981dde` (2026-10-28). See [contract](CHAT_MIGRATION_P0.md).

V = reusable visual (future DS custody); R = Sentropic `chat-runtime`; H = justified host integration. Mixed rows name a required split, never unassigned ownership.

Every TypeScript declaration module is inventoried, including component declarations. Component default exports use their public package subpath; named symbols inherit the source relocation map. Re-export blocks are shown verbatim as names and keep the originating declaration's owner.

| Source relative to package | Named declarations / re-exports |
| --- | --- |
| `src/checkpoints/checkpointState.ts` | CheckpointItem, PendingCheckpointPrompt, applySessionCheckpoints, getCheckpointForUserMessage, openCheckpointPrompt |
| `src/checkpoints/classifier.ts` | CheckpointMessageLike, CheckpointStreamEventLike, CheckpointSummaryLike, getCheckpointMutationPreviewItems, hasCheckpointMutationDelta |
| `src/checkpoints/index.ts` | Checkpoint, CheckpointHost, CheckpointItem, CheckpointMessageLike, CheckpointStreamEventLike, CheckpointSummaryLike, PendingCheckpointPrompt, applySessionCheckpoints, getCheckpointForUserMessage, getCheckpointMutationPreviewItems, hasCheckpointMutationDelta, openCheckpointPrompt |
| `src/client/chat-core-host.ts` | ChatCoreHost, ModelCatalog, RunHandle, SendMessagePayload, SessionSummary |
| `src/client/replay.ts` | ReplayClient, ReplayCursor, createReplayClient |
| `src/client/streamHistory.ts` | StreamHistory, StreamHistoryOptions |
| `src/client/streamHub.ts` | createStreamHub |
| `src/client/streamTypes.ts` | GeneratedFileCard, GeneratedFileFormat, RuntimePortLike, STREAM_HUB_EVENT_TYPES, StreamHubClient, StreamHubEvent, StreamHubEventHandler, StreamHubEventType, StreamHubOptions, StreamHubSubscription |
| `src/client/transport.ts` | ChatCoreTransport, ChatCoreTransportFactory, createDefaultTransport |
| `src/comments/CommentsPanel.svelte.d.ts` | CommentsPanelProps |
| `src/comments/host.ts` | CommentCurrentUser, CommentHost, CommentItem, MentionMember |
| `src/comments/index.ts` | CommentCurrentUser, CommentHost, CommentItem, CommentState, CommentStateActions, CommentStateSnapshot, CommentThreadSummary, MentionMember, buildCommentThreads, createCommentState, findAssignedMentionFromText, formatCommentTimestamp, getCommentAuthorLabel, getInitials, getMentionCandidate, getMentionLabel, getMentionMatches, isAiComment, isCommentByUser, isSameDay |
| `src/comments/state.ts` | CommentState, CommentStateActions, CommentStateSnapshot, createCommentState |
| `src/comments/types.ts` | CommentCurrentUser, CommentItem, CommentThreadSummary, MentionMember |
| `src/comments/utils.ts` | buildCommentThreads, findAssignedMentionFromText, formatCommentTimestamp, getCommentAuthorLabel, getInitials, getMentionCandidate, getMentionLabel, getMentionMatches, isAiComment, isCommentByUser, isSameDay |
| `src/components/AgentsList.svelte.d.ts` | AgentsListProps |
| `src/components/ChatComposer.svelte.d.ts` | ChatComposerProps |
| `src/components/ChatContextPicker.svelte.d.ts` | ChatContextPickerProps |
| `src/components/ChatConversation.svelte.d.ts` | ChatConversationFeatures, ChatConversationProps |
| `src/components/ChatDock.svelte.d.ts` | ChatDockInstance, ChatDockProps |
| `src/components/ChatPanel.svelte.d.ts` | ChatPanelProps |
| `src/components/ChatPanelShell.svelte.d.ts` | ChatPanelShellProps, ChatPanelShellTimelineItem, LocalToolPermissionPromptLike, TodoRuntimePanelLike, TodoRuntimeTaskLike |
| `src/components/ChatPlacementDropZones.svelte.d.ts` | ChatPlacementDropZonesProps |
| `src/components/ChatPlacementMenuButton.svelte.d.ts` | ChatPlacementMenuButtonProps |
| `src/components/ChatSessionsBar.svelte.d.ts` | ChatSessionsBarProps |
| `src/components/ChatTimeline.svelte.d.ts` | ChatTimelineItem, ChatTimelineProps |
| `src/components/ChatWidget.svelte.d.ts` | ChatWidgetProps, ChatWidgetTab |
| `src/components/ChatWidgetPager.svelte.d.ts` | ChatWidgetPagerProps |
| `src/components/ChatWidgetTabBar.svelte.d.ts` | ChatWidgetTab, ChatWidgetTabBarProps |
| `src/components/ContextChips.svelte.d.ts` | ContextChipsProps |
| `src/components/MessageActions.svelte.d.ts` | MessageActionsProps |
| `src/components/ModelSelector.svelte.d.ts` | ModelSelectorProps |
| `src/components/SessionList.svelte.d.ts` | SessionListProps |
| `src/components/StreamMessage.svelte.d.ts` | StreamMessageEvent, StreamMessageLabelResolver, StreamMessageProps, StreamMessageRuntimeSummary, StreamMessageTodoRuntimeUpdate |
| `src/context/context-entry.ts` | selectActiveChatContexts, toChatRouteContextKey, upsertRouteContextEntry |
| `src/context/index.ts` | ChatContextEntry, ChatContextProvider, ContextHost, ContextModule, ReadableStore, createContextModule, createNoopChatContextProvider, selectActiveChatContexts, toChatRouteContextKey, upsertRouteContextEntry |
| `src/context/module.ts` | ContextHost, ContextModule, createContextModule |
| `src/documents/AttachmentBand.svelte.d.ts` | AttachmentBandProps |
| `src/documents/GeneratedFileCardTray.svelte.d.ts` | GeneratedFileCardTrayProps |
| `src/documents/ImageLightbox.svelte.d.ts` | ImageLightboxProps |
| `src/documents/MessageAttachments.svelte.d.ts` | MessageAttachmentsProps |
| `src/documents/attachmentState.ts` | ComposerAttachmentAction, ComposerAttachmentLike, buildAttachmentBandItems, buildSentAttachments, composerAttachmentListReducer, createComposerAttachmentId, handleComposerPasteImages |
| `src/documents/generatedFileCards.ts` | extractGeneratedFileCardsFromEvents, extractGeneratedFileCardsFromRuntimeSummary, getGeneratedFileFormatLabel, normalizeGeneratedFileCard |
| `src/documents/index.ts` | ChatAttachmentKind, ChatAttachmentSource, ChatAttachmentState, ChatComposerAttachmentDraft, ChatGeneratedFileCard, ChatRuntimeSummaryWithGeneratedFiles, ComposerAttachmentAction, ComposerAttachmentLike, DocumentHost, UnifiedAttachmentItem, UnifiedAttachmentKind, buildAttachmentBandItems, buildSentAttachments, composerAttachmentListReducer, createComposerAttachmentId, extractGeneratedFileCardsFromEvents, extractGeneratedFileCardsFromRuntimeSummary, getGeneratedFileFormatLabel, handleComposerPasteImages, normalizeGeneratedFileCard |
| `src/documents/types.ts` | ChatAttachmentKind, ChatAttachmentSource, ChatAttachmentState, ChatComposerAttachmentDraft, ChatGeneratedFileCard, ChatRuntimeSummaryWithGeneratedFiles, DocumentHost, UnifiedAttachmentItem, UnifiedAttachmentKind |
| `src/hosts/createWebHost.ts` | ChatUiAuthAdapter, ChatUiCommentsHostAdapter, ChatUiDocumentHostAdapter, ChatUiJobsHostAdapter, ChatUiLabelResolver, ChatUiLabelValue, ChatUiNavigationAdapter, ChatUiPanelRenderer, ChatUiStorageAdapter, ChatUiWebHost, CreateWebHostInput, createWebHost |
| `src/hosts/types.ts` | AnyHostAdapter, ChatAttachmentHostAdapter, ChatComposerAttachmentDraft, ChromeHostAdapter, HostAdapter, LocalToolsAdapter, VsCodeHostAdapter, WebHostAdapter |
| `src/index.ts` | * from ./client/replay.js, * from ./client/streamHistory.js, * from ./client/streamHub.js, * from ./client/streamTypes.js, * from ./client/transport.js, * from ./hosts/createWebHost.js, * from ./hosts/types.js, * from ./renderers/registry.js, * from ./state/agentsEntry.js, * from ./state/agentsSort.js, * from ./state/agentsViewMarkers.js, * from ./state/chatDraft.js, * from ./state/chatProjection.js, * from ./state/chatWidgetShell.js, * from ./state/streamMessageProjection.js, * from ./state/streamMessageSmoothing.js, * from ./stores/chatWidgetLayout.js, * from ./stores/localTools.js, * from ./utils/chat-run-projection.js, * from ./utils/chat-steer.js, * from ./utils/chat-tool-scope.js, * from ./utils/localToolStreamSync.js |
| `src/renderers/registry.ts` | RendererRegistry, ToolRenderer, createRendererRegistry |
| `src/state/agentsEntry.ts` | AgentsEntry, AgentsEntryConnection, AgentsEntryKind, AgentsEntryStatus, AgentsFeedPort, AgentsFeedScope, agentsEntryStatusUrgency, aggregateAgentsEntryStatus |
| `src/state/agentsSort.ts` | AgentsListRow, AgentsSortOptions, buildAgentsListRows |
| `src/state/agentsViewMarkers.ts` | AgentsViewMarkers, AgentsViewMarkersConfig, buildAgentsViewMarkersKey, createAgentsViewMarkers |
| `src/state/chat-context.ts` | ChatContextEntry, ChatContextProvider, ReadableStore, createNoopChatContextProvider |
| `src/state/chatAttachments.ts` | ChatAttachmentKind, ChatAttachmentSource, ChatAttachmentState, ChatComposerAttachmentDraft, ComposerAttachmentSummary, createImageAttachmentDraft, isSupportedImageAttachmentMimeType, summarizeComposerAttachments |
| `src/state/chatDraft.ts` | ChatDraftMode, ChatDraftState, ComposerHeightInput, ComposerHeightState, ComposerPrimaryAction, ComposerPrimaryActionState, ComposerSteerAck, ComposerSteerState, CreateOptimisticSteerMessageInput, OptimisticSteerMessage, ResolveComposerPrimaryActionInput, SteerableMessage, SyncDraftInput, createComposerSteerAck, createOptimisticSteerMessage, isAssistantMessageInProgress, resolveComposerHeightState, resolveComposerPrimaryAction, resolveComposerSteerState, shouldClearComposerSteerAck, shouldShowSteerAction, syncDraftFromInput |
| `src/state/chatLoopController.ts` | AttachHostOptions, AttachLocalToolMachineOptions, AttachStreamOptions, BootstrapRunInput, BootstrapRunResult, ChatLoopController, ChatLoopProjectionState, ComposerSteerAck, ControllerHostTransport, ControllerLocalToolExecutorFn, ControllerLocalToolPermissionDeciderFn, ControllerLocalToolPermissionPrompt, ControllerLocalToolResultPosterFn, ControllerLocalToolStreamState, ControllerModelCatalogFetchFn, ControllerOptimisticSteerMessage, ControllerPollJob, ControllerRunHandle, ControllerSendPayload, ControllerStreamClient, ControllerStreamEvent, ModelCatalogGroup, ModelCatalogModel, ModelCatalogProvider, ModelProviderId, SendSteerOptions, createChatLoopController |
| `src/state/chatPlacement.ts` | ChatPlacement, ChatPlacementId, CommitFn, DrawerSide, FloatingAnchor, HostSurfaces, PlacementController, PlacementControllerConfig, PlacementPersistence, PlacementReason, PlacementResolutionStatus, PlacementResult, PlacementSnapshot, ReparentKind, Stickiness, createPlacementController, parsePlacementId, placementId, placementsEqual |
| `src/state/chatPlacementClasses.ts` | ChatPlacementContainerContext, placementContainerClasses |
| `src/state/chatPlacementDnd.ts` | CreateViewportDropZonesOptions, DragSession, DragSessionConfig, DropZone, Rect, Viewport, createDragSession, createViewportDropZones |
| `src/state/chatPlacementMenu.ts` | ChatPlacementMenu, ChatPlacementMenuGroup, ChatPlacementMenuItem, ChatPlacementMenuLabels, ChatPlacementSideMemory, CreateChatPlacementMenuOptions, buildChatPlacementPersistenceKey, createChatPlacementMenu, createDefaultChatPlacementMenuLabels, createFrenchChatPlacementMenuLabels |
| `src/state/chatPlacementMigration.ts` | displayModeToPlacement, placementToDisplayMode, placementToLegacyDisplayMode |
| `src/state/chatProjection.ts` | BuildProjectedTimelineInput, ChatMessageAttachment, ChatProjectedTimelineItem, ChatProjectionComputation, ChatProjectionMessage, ChatProjectionSegment, ChatProjectionSteerAck, buildFallbackProjectedSegments, buildProjectedTimeline |
| `src/state/chatSessionHydration.ts` | HistoryScrollRestore, SessionHistoryLine, SessionHistoryMetaLine, SessionHistoryTimelineLine, compareTimelineItems, createHydrationGenerations, createNdjsonSplitter, getTimelineItemSortSequence, getTimelineItemSortSubsequence, mergeTimelineBlockIntoHistory, normalizeHydratedMessage, parseSessionHistoryLine, resolveHistoryScrollRestore, shouldFlushHistoryStage, upsertSequencedMessage |
| `src/state/chatSessionRuntime.ts` | ChatSessionAttachment, ChatSessionCheckpoint, ChatSessionJsonObject, ChatSessionJsonPrimitive, ChatSessionJsonValue, ChatSessionPendingTool, ChatSessionRuntime, ChatSessionRuntimeConfig, ChatSessionRuntimeHost, ChatSessionRuntimeMessage, ChatSessionSnapshot, ChatSessionSnapshotSerializable, ChatSessionTodo, createChatSessionRuntime |
| `src/state/chatWidgetShell.ts` | ChatWidgetHostMode, ChatWidgetJobBadge, ChatWidgetPanelVisibility, ChatWidgetSession, ChatWidgetTab, SessionsBarLabels, SessionsBarState, canChatPlacementMenuOwnPlacement, coerceChatWidgetTab, computeChatWidgetDockWidthCss, findActiveChatSession, formatChatSessionLabel, reduceSessionDeleteConfirm, resolveChatWidgetJobBadge, resolveChatWidgetPanelVisibility, resolveEffectiveChatWidgetMode, resolveSessionsBar, shouldAutoCloseChatWidget |
| `src/state/sessionList.ts` | HistoryEventRaw, HistoryMessage, HistoryPayload, RestoredTimelineItem, SessionListEntry, SessionRow, projectRestoredTimeline, projectSessionList |
| `src/state/streamMessageProjection.ts` | TodoToolTask, asRecord, asTaskList, buildTodoRuntimeChecklist, escapeMarkdownText, needsReasoningSectionBreak, normalizeTaskStatus, summarizePreviewText |
| `src/state/streamMessageSmoothing.ts` | getSmoothStepSize, shouldAnimateSmoothDelta, takeSmoothChunk |
| `src/stores/chatWidgetLayout.ts` | ChatWidgetDisplayMode, ChatWidgetDrawerSide, ChatWidgetLayoutState, chatWidgetLayout |
| `src/stores/localTools.ts` | BUILTIN_LOCAL_TOOL_NAMES, LocalToolDefinition, LocalToolExecution, LocalToolExecutionStatus, LocalToolName, LocalToolPermissionDecision, LocalToolPermissionPolicy, LocalToolPermissionPolicyEntry, LocalToolPermissionRequest, LocalToolPermissionRequiredError, clearRegisteredLocalTools, decideLocalToolPermission, deleteLocalToolPermissionPolicy, executeLocalTool, getLocalToolDefinitions, isLocalToolName, isLocalToolRuntimeAvailable, listLocalToolPermissionPolicies, listRegisteredLocalTools, localToolsStore, registerLocalTool, registerLocalTools, setLocalToolsAdapter, unregisterLocalTool, upsertLocalToolPermissionPolicy |
| `src/utils/chat-run-projection.ts` | ProjectedRunSegment, ProjectionStreamEvent, appendLiveProjectionEvent, countLinkedSteerMessages, getLinkedSteerMessageIds, getProjectedRunTerminalOutcome, mergeProjectionHistoryEvents, projectAssistantRunSegments |
| `src/utils/chat-steer.ts` | ChatSteerFeedback, insertSteerMessageInTimeline, postChatSteer |
| `src/utils/chat-tool-scope.ts` | ChatToolScopeToggle, computeEnabledToolIds, computeToolToggleDefaults, computeVisibleToolToggleIds, isExtensionRestrictedToolsetMode |
| `src/utils/composer-autosize.ts` | AutosizeInput, AutosizeResult, computeAutosizeResult |
| `src/utils/localToolStreamSync.ts` | NormalizedPendingLocalToolCall, PermissionPromptShape, filterPermissionPromptsForPendingStream, parsePendingLocalToolCallsFromStatusPayload, shouldResetLocalToolStateForFreshRound |
| `src/utils/markdown-refs.ts` | MarkdownToHtmlFn, RefLinkRenderer, Reference, RenderMarkdownOptions, createDefaultRefLink, normalizeMarkdownLineEndings, normalizeUseCaseMarkdown, renderMarkdownWithRefs, stripTrailingEmptyParagraph |
| `src/utils/message-actions.ts` | FeedbackDirection, FeedbackDisplayState, FeedbackNextAction, MessageActionAvailability, MessageActionRole, MessageActionStreamStatus, MessageFeedbackVote, ResolveAvailableActionsInput, applyFeedbackAction, buildFeedbackNextVote, formatCopyPayload, resolveAvailableActions, resolveFeedbackDisplayState |
| `src/utils/model-selection.ts` | ModelCatalogGroup, ModelCatalogModel, ModelCatalogProvider, ModelProviderId, ParsedModelKey, coerceSelectionToValidEntry, computeModelSelectorWidthCh, formatModelSelectionKey, getSelectedModelLabel, groupModelsByProvider, parseModelSelectionKey, providerGroupLabel, resolveFallbackModelOption, resolveHydratedModelSelection |
