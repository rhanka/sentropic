<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Readable } from 'svelte/store';
  import type { AppContext } from '@sentropic/cowork-bridge/core';
  import { getNavigation } from '@sentropic/cowork-bridge/core';
  import { _, locale } from 'svelte-i18n';
  import {
    apiFetch,
    apiGet,
    apiPost,
    apiPatch,
    apiDelete,
    ApiError,
  } from '$lib/utils/api';
  import { createSentropicChatCoreHost } from '$lib/chat/chat-core-host-adapter';
  import {
    createChatLoopController,
    type ControllerLocalToolPermissionPrompt,
  } from '@sentropic/chat-ui/state/chatLoopController';

  // ChatCoreHost instance — wraps the existing API utils (auth-aware) with the
  // ChatCoreHost contract. Zero behavior change: same requests, same error shapes.
  const chatCoreHost = createSentropicChatCoreHost();
  // Sentropic CheckpointHost: API fetch/create/restore + domain hooks (isMutatingTool,
  // isLocalToolName, humanizeMutation) wired to the generic module classifier.
  const checkpointHost = createCheckpointHost();
  import { session } from '$lib/stores/session';
  import type { CommentContextType } from '$lib/utils/comments';
  import CommentsPanel from '@sentropic/chat-ui/comments/CommentsPanel.svelte';
  import type { CommentThreadSummary } from '@sentropic/chat-ui/comments';
  import { createSentropicCommentHost } from '$lib/chat/comment-host-adapter';
  import ChatPanelShell from '@sentropic/chat-ui/components/ChatPanelShell.svelte';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import DocumentSourceMenu from '$lib/components/DocumentSourceMenu.svelte';
  import MenuPopover from '$lib/components/MenuPopover.svelte';
  import {
    GOOGLE_DRIVE_CONNECTION_UPDATED_EVENT,
    GOOGLE_DRIVE_CONNECTORS_ROUTE,
  } from '$lib/utils/google-drive-connectors';
  import { currentFolderId, foldersStore } from '$lib/stores/folders';
  import { organizationsStore } from '$lib/stores/organizations';
  import { initiativesStore } from '$lib/stores/initiatives';
  import { getScopedWorkspaceIdForUser, workspaceCanComment, selectedWorkspace, selectedWorkspaceRole, workspaceScopeHydrated } from '$lib/stores/workspaceScope';
  import {
    getDownloadUrl,
    listDocuments,
    uploadDocument,
    type ContextDocumentItem,
  } from '$lib/utils/documents';
  import {
    createComposerAttachmentId,
    buildAttachmentBandItems,
    buildSentAttachments,
    handleComposerPasteImages,
    composerAttachmentListReducer,
  } from '@sentropic/chat-ui/documents';
  import type { UnifiedAttachmentItem, ChatGeneratedFileCard } from '@sentropic/chat-ui/documents';
  import { createDocumentHostAdapter } from '$lib/chat/documentHostAdapter';
  import {
    attachGoogleDriveDocuments,
    fetchGoogleDrivePickerConfig,
    fetchGoogleDriveConnection,
    resolveGoogleDrivePickerSelection,
    type GoogleDriveConnection,
  } from '$lib/utils/google-drive';
  import { openGoogleDrivePicker as openGoogleDrivePickerDialog } from '$lib/utils/google-drive-picker';
  import { streamHub, type StreamHubEvent } from '$lib/stores/streamHub';
  import {
    createContextModule,
    type ContextModule,
  } from '@sentropic/chat-ui/context';
  import type { ChatContextEntry } from '@sentropic/chat-ui/state/chat-context';
  import {
    createContextHost,
    buildStoreLookup,
    contextTypeIconKey,
    type ChatContextType,
  } from '$lib/chat/context-adapter';
  // comment-adapter helpers removed — comment logic moved to CommentsPanel/createCommentState
  import {
    createChatSessionCreatePayload,
    createChatSessionDocumentContext,
    createGoogleDriveChatAttachInput,
    extractGeneratedFileCardsFromEvents,
    extractGeneratedFileCardsFromRuntimeSummary as collectGeneratedFileCardsFromRuntimeSummary,
    normalizeGeneratedFileCard,
  } from '$lib/chat/document-adapter';
  import {
    chatSessionsUrl,
    formatChatApiError,
  } from '$lib/chat/session-adapter';
  import {
    decideLocalToolPermission,
    executeLocalTool,
    getLocalToolDefinitions,
    isLocalToolName,
    isLocalToolRuntimeAvailable,
    LocalToolPermissionRequiredError,
    type LocalToolPermissionDecision,
    type LocalToolName,
  } from '@sentropic/chat-ui/stores/localTools';
  import ChatContextPicker from '@sentropic/chat-ui/components/ChatContextPicker.svelte';
  // ChatContextEntry from @sentropic/chat-ui/state/chat-context imported above via context-adapter chain.
  import {
    computeModelSelectorWidthCh,
    type ModelProviderId,
    type ModelCatalogModel,
    type ModelCatalogGroup,
  } from '@sentropic/chat-ui/utils/model-selection';

  import {
    Send,
    UndoDot,
    Check,
    Copy,
    Pencil,
    Plus,
    FileText,
    Globe,
    Link2,
    Building2,
    Folder,
    Lightbulb,
    Table,
    ScrollText,
    Brain,
    MessageCircle,
    Square,
    ShipWheel,
    Clapperboard,
    ChevronsLeftRightEllipsis,
    List,
    Eye,
    EyeOff,
    FolderOpen,
    Trash2,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    Terminal,
    Search,
    GitBranch,
  } from '@lucide/svelte';
  import { downloadGeneratedFile, type GeneratedFileCard } from '$lib/utils/docx';
  import { renderMarkdownWithRefs } from '$lib/utils/markdown';
  import { generateInjectedScript } from '$lib/upstream/injected-script';
  // filterPermissionPromptsForPendingStream / parsePendingLocalToolCallsFromStatusPayload /
  // shouldResetLocalToolStateForFreshRound removed in slice 1E — logic inlined in the controller.
  import {
    computeEnabledToolIds,
    computeToolToggleDefaults,
    computeVisibleToolToggleIds,
    isExtensionRestrictedToolsetMode as computeIsExtensionRestrictedToolsetMode,
  } from '@sentropic/chat-ui/utils/chat-tool-scope';
  import {
    EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS,
    VSCODE_NEW_SESSION_ALLOWED_TOOL_IDS,
  } from '$lib/chat/tool-scope-adapter';
  import {
    USER_AI_SETTINGS_UPDATED_EVENT,
    type UserAISettingsUpdatedPayload,
  } from '$lib/utils/user-ai-settings-events';
  import {
    hasCheckpointMutationDelta,
    getCheckpointMutationPreviewItems,
    applySessionCheckpoints as applySessionCheckpointsFromModule,
    getCheckpointForUserMessage as getCheckpointForUserMessageFromModule,
  } from '@sentropic/chat-ui/checkpoints';
  import { createCheckpointHost } from '$lib/adapters/checkpointHostAdapter';
  import {
    mergeProjectionHistoryEvents,
    type ProjectedRunSegment,
  } from '@sentropic/chat-ui/utils/chat-run-projection';
  import type {
    ChatMessageAttachment,
    ChatProjectedTimelineItem,
  } from '@sentropic/chat-ui/state/chatProjection';
  import {
    createImageAttachmentDraft,
    isSupportedImageAttachmentMimeType,
    summarizeComposerAttachments,
    type ChatComposerAttachmentDraft,
  } from '@sentropic/chat-ui/state/chatAttachments';
  import {
    resolveComposerHeightState,
    resolveComposerPrimaryAction,
    shouldShowSteerAction,
    syncDraftFromInput as syncChatDraftFromInput,
    type ComposerPrimaryActionState,
  } from '@sentropic/chat-ui/state/chatDraft';

  type ChatSession = {
    id: string;
    title?: string | null;
    primaryContextType?: string | null;
    primaryContextId?: string | null;
    createdAt?: string;
    updatedAt?: string | null;
  };

  type ChatCheckpoint = {
    id: string;
    title: string;
    anchorMessageId: string;
    anchorSequence: number;
    messageCount: number;
    createdAt: string;
  };
  type PendingCheckpointPrompt = {
    kind: 'restore' | 'retry';
    checkpoint: ChatCheckpoint;
    userMessageId: string;
    assistantMessageId?: string;
  };

  type ChatMessage = {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content?: string | null;
    reasoning?: string | null;
    model?: string | null;
    sequence?: number;
    createdAt?: string;
    feedbackVote?: number | null;
    attachments?: readonly ChatMessageAttachment[];
  };

  type LocalMessage = ChatMessage & {
    _localStatus?: 'processing' | 'completed' | 'failed';
    _streamId?: string;
    _optimisticSteerTargetAssistantId?: string;
    _optimisticSteerSubmittedAtMs?: number;
  };

  type StreamEvent = {
    eventType: string;
    data: any;
    sequence: number;
    createdAt?: string;
  };
  type RuntimeSegmentSummary = {
    hasReasoning: boolean;
    hasTools: boolean;
    toolCount: number;
    contextBudgetPct: number | null;
    durationMs: number | null;
    reasoningEffortLabel: string | null;
    generatedFileCards?: GeneratedFileCard[];
    docxCards?: Array<{ jobId: string; fileName: string }>;
  };
  type ProjectedTimelineItem = ChatProjectedTimelineItem<
    LocalMessage,
    RuntimeSegmentSummary
  >;
  type SessionHistoryMetaLine = {
    type: 'session_meta';
    sessionId: string;
    title?: string | null;
    todoRuntime?: Record<string, unknown> | null;
    checkpoints?: ChatCheckpoint[];
    documents?: ContextDocumentItem[];
  };
  type SessionHistoryTimelineLine = {
    type: 'timeline_item';
    item: ProjectedTimelineItem;
  };
  const getTimelineItemSortSequence = (item: ProjectedTimelineItem): number => {
    const messageSequence = Number(item.message.sequence ?? 0);
    return Number.isFinite(messageSequence) ? messageSequence : 0;
  };

  const getTimelineItemSortSubsequence = (item: ProjectedTimelineItem): number => {
    if (item.kind === 'message') return 0;
    const raw = Number(String(item.segment.id ?? '').split(':').pop() ?? 0);
    if (Number.isFinite(raw)) return raw;
    return item.kind === 'runtime-segment' ? 0 : 1;
  };

  const compareTimelineItems = (
    left: ProjectedTimelineItem,
    right: ProjectedTimelineItem,
  ): number =>
    getTimelineItemSortSequence(left) - getTimelineItemSortSequence(right) ||
    getTimelineItemSortSubsequence(left) - getTimelineItemSortSubsequence(right);

  type TodoRuntimeTask = {
    id?: string;
    title: string;
    status?: string;
  };
  type TodoRuntimePanelState = {
    todoId: string;
    planId: string | null;
    title: string;
    status: string;
    runId: string | null;
    runStatus: string | null;
    runTaskId: string | null;
    tasks: TodoRuntimeTask[];
    conflictMessage: string | null;
    sourceTool: 'plan';
    updatedAtMs: number;
  };
  type TodoRuntimeToolResultEvent = {
    toolCallId: string;
    toolName: 'plan';
    result: Record<string, unknown>;
  };
  type ComposerSteerAck = {
    streamId: string;
    message: string;
    createdAtMs: number;
  };
  // ProjectedAssistantComputation (with signature cache) was removed in slice 1B.
  // The controller owns the cache internally via ChatProjectionComputation.
  // LocalToolStreamState and LocalToolPermissionPrompt removed in slice 1E —
  // replaced by ControllerLocalToolStreamState / ControllerLocalToolPermissionPrompt
  // from the controller (imported above). AppChatPanel uses the controller's types
  // so the template remains compatible with $ctrl.pendingLocalToolPermissionPrompts.
  // LocalToolPermissionPrompt alias kept for template compatibility:
  type LocalToolPermissionPrompt = ControllerLocalToolPermissionPrompt;
  type IconComponent = typeof FileText;

  type ToolToggle = {
    id: string;
    label: string;
    description?: string;
    toolIds: string[];
    icon: IconComponent;
  };

  // ModelCatalogPayload type removed in slice 1F — controller owns catalog fetch.

  // ---------------------------------------------------------------------------
  // Headless projection controller (slice 1B).
  // Owns: messages, initialEventsByMessageId, projectedStreamEventsById,
  //       projection signature cache, projectedTimelineItems.
  // Implements the Svelte store protocol (subscribe) so $ctrl auto-subscribes.
  // AppChatPanel reads state from $ctrl and routes all mutations through ctrl.*
  // methods — the template renders identically from controller-backed fields.
  // ---------------------------------------------------------------------------
  const ctrl = createChatLoopController<LocalMessage, RuntimeSegmentSummary>();
  // Slice 1D: inject the host transport so the controller can call sendMessage,
  // retryMessage, stopMessage, editMessage, setFeedback without knowing the host.
  ctrl.attachHost({ transport: chatCoreHost });

  const getContextIcon = (type: string) => {
    const key = contextTypeIconKey(type);
    if (key === 'organization') return Building2;
    if (key === 'folder') return Folder;
    if (key === 'initiative') return Lightbulb;
    if (key === 'executive_summary') return ScrollText;
    return FileText;
  };

  // Context module (D3) — replaces contextEntries / lastRouteContextKey / contextNameByKey.
  // Instantiated with the sentropic ContextHost (context-adapter.ts).
  // The host callbacks read reactive Svelte store values via closures.
  // Wrap $_ to satisfy context-adapter's translate signature (svelte-i18n
  // MessageFormatter uses InterpolationValues; adapter expects Record<string,unknown>).
  const i18nTranslate = (key: string, opts?: { values?: Record<string, unknown> }) =>
    $_(key, opts as Parameters<typeof $_>[1]);

  const contextHost = createContextHost(
    () => ({
      routeId: $contextStore.route.id,
      params: $contextStore.params,
      currentFolderId: $currentFolderId,
    }),
    (type: string, id: string) =>
      buildStoreLookup(
        $organizationsStore,
        $foldersStore,
        $initiativesStore,
        i18nTranslate,
      )(type, id),
    i18nTranslate,
  );
  const contextModule: ContextModule = createContextModule(contextHost);
  // Subscribe to the module entries store; keeps contextEntries reactive.
  let contextEntries: ChatContextEntry[] = [];
  contextModule.entries.subscribe((v) => { contextEntries = v; });

  export let sessions: ChatSession[] = [];
  export let contextStore: Readable<AppContext>;
  export let sessionId: string | null = null;
  export let draft = '';
  export let loadingSessions = false;
  export let mode: 'ai' | 'comments' = 'ai';
  let suppressSessionAutoSelect = false;
  let sessionHydrationGeneration = 0;
  export let commentContextType: CommentContextType | null = null;
  export let commentContextId: string | null = null;
  export let commentSectionKey: string | null = null;
  export let commentSectionLabel: string | null = null;
  export let commentThreadId: string | null = null;

  // Comment helpers removed — moved to CommentsPanel / createCommentState / comment-host-adapter.

  // Comment state/functions removed — now managed by CommentsPanel + createCommentState.

  // messages is now controller-backed (slice 1B). Mutations go through ctrl.*
  // The $ctrl auto-subscription fires on every controller notify().
  $: messages = $ctrl.messages as LocalMessage[];
  // pendingLocalToolPermissionPrompts is now controller-backed (slice 1E).
  $: pendingLocalToolPermissionPrompts = $ctrl.pendingLocalToolPermissionPrompts as LocalToolPermissionPrompt[];
  let loadingMessages = false;
  let sending = false;
  let stoppingMessageId: string | null = null;
  let errorMsg: string | null = null;
  let lastShownErrorMsg: string | null = null;
  // modelCatalogProviders/modelCatalogModels/modelCatalogGroups/selectedProviderId/selectedModelId
  // defaultProviderIdForNewSession/defaultModelIdForNewSession moved to controller (slice 1F).
  // Access via $ctrl.modelCatalog*, $ctrl.selectedProviderId, $ctrl.selectedModelId etc.
  let selectedModelSelectionKey = 'openai::gpt-4.1-nano';
  let pendingTodoRuntimeDeleteConfirm = false;
  let input = draft;
  let composerAttachments: ChatComposerAttachmentDraft[] = [];
  let composerAttachmentSummary = summarizeComposerAttachments(composerAttachments);
  let lightboxImage: { src: string; alt: string } | null = null;
  export let commentLoading = false;
  let listEl: HTMLDivElement | null = null;
  let historyStageMeasureEl: HTMLDivElement | null = null;
  let composerEl: HTMLDivElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let followBottom = true;
  let scrollScheduled = false;
  // Comment-specific state removed — now owned by CommentsPanel / createCommentState.
  // projectedTimelineItems is now controller-owned (slice 1B).
  $: projectedTimelineItems = $ctrl.projectedTimelineItems as ProjectedTimelineItem[];
  let historyTimelineItems: ProjectedTimelineItem[] = [];
  let stagedHistoryTimelineItems: ProjectedTimelineItem[] = [];
  let historyHydrationInFlight = false;
  let historyHydrationSwapPending = false;
  let historyHydrationStickBottom = false;
  // optimisticSteerMessages moved to controller (slice 1F); access via $ctrl.optimisticSteerMessages.
  let generatedFileCardsByMessageId = new Map<string, GeneratedFileCard[]>();
  let previousAiWorkspaceId: string | null | undefined = undefined;
  let workspaceSessionRescopeInFlight = false;

  const getMessageStatus = (m: LocalMessage) =>
    m._localStatus ?? (m.content ? 'completed' : 'processing');
  let activeAssistantMessage: LocalMessage | null = null;
  let composerSteerStreamId: string | null = null;
  let composerSteerReady = false;
  let composerRunInFlight = false;
  let composerPrimaryActionState: ComposerPrimaryActionState = {
    action: 'disabled',
    disabled: true,
    displayMode: 'send',
  };
  let composerPrimaryButtonShowsSteer = false;
  const isAssistantMessageInProgress = (message: LocalMessage): boolean => {
    if (message.role !== 'assistant') return false;
    if (message._localStatus === 'processing') return true;
    if (!message._localStatus && !message.content) return true;
    return false;
  };
  $: activeAssistantMessage =
    [...messages].reverse().find((m) => isAssistantMessageInProgress(m)) ?? null;
  // projectedTimelineItems is driven by the controller's subscribe() callback
  // (via $ctrl auto-subscription). Steer-ack + optimistic-steer now controller-owned (slice 1F).
  // Rebuild the timeline when controller steer state or runtime summaries change.
  $: {
    $ctrl.composerSteerAck;
    $ctrl.optimisticSteerMessages;
    runtimeSummaryByMessageId;
    projectedTimelineItems = ctrl.buildTimeline({
      optimisticSteerMessages: $ctrl.optimisticSteerMessages as LocalMessage[],
      runtimeSummariesByMessageId: runtimeSummaryByMessageId,
      composerSteerAck: $ctrl.composerSteerAck,
    }) as ProjectedTimelineItem[];
  }
  $: composerSteerStreamId = activeAssistantMessage
    ? (activeAssistantMessage._streamId ?? activeAssistantMessage.id ?? null)
    : null;
  $: composerSteerReady =
    typeof composerSteerStreamId === 'string' &&
    composerSteerStreamId.trim().length > 0;
  $: composerRunInFlight = sending || composerSteerReady;
  $: composerAttachmentSummary = summarizeComposerAttachments(composerAttachments);
  $: attachmentBand = buildAttachmentBandItems(composerAttachments);
  // resolveComposerPrimaryAction: mode==='comments' path removed (now CommentsPanel).
  // AI-only invocation:
  $: composerPrimaryActionState = resolveComposerPrimaryAction({
    mode: 'ai',
    input,
    commentInput: '',
    commentContextType: null,
    commentContextId: null,
    workspaceCanComment: true,
    commentThreadResolved: false,
    sending,
    composerRunInFlight,
    composerSteerReady,
    composerSteerInFlight,
    attachments: composerAttachmentSummary,
  });
  $: composerPrimaryButtonShowsSteer = shouldShowSteerAction({
    composerRunInFlight,
  });

  // hasAssistantContent, getLocalToolEligibleStreamIds and isKnownAssistantStream removed in slice 1E —
  // all three are now owned by the controller's local-tool machine (reads from controller messages).

  // ---------------------------------------------------------------------------
  // Local-tool machine helpers — kept app-side (slice 1E)
  // These functions bridge the app-specific ApiError retry and i18n label
  // resolution with the controller's generic local-tool machine.
  // ---------------------------------------------------------------------------

  /**
   * App-side result poster: wraps chatCoreHost.postLocalToolResult with
   * the 12-attempt retry on retryable race conditions (ApiError 400 "not pending").
   * Injected into the controller via attachLocalToolMachine so the controller
   * stays transport-agnostic (no ApiError import in the package).
   */
  const postLocalToolResultWithRetry = async (
    streamId: string,
    toolCallId: string,
    result: unknown,
  ) => {
    const maxAttempts = 12;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await chatCoreHost.postLocalToolResult(streamId, toolCallId, result);
        return;
      } catch (error) {
        lastError = error;
        const isRetryableRace =
          error instanceof ApiError &&
          error.status === 400 &&
          /No pending local tool call found|not pending/i.test(error.message);
        if (!isRetryableRace || attempt === maxAttempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Unknown local tool result forwarding error');
  };

  /**
   * Thin wrapper so the template can still call handleLocalToolPermissionDecision(prompt, decision).
   * Delegates to ctrl.decideLocalToolPermission (slice 1E).
   * Kept app-side because the template imports are Svelte-specific.
   */
  const handleLocalToolPermissionDecision = async (
    prompt: LocalToolPermissionPrompt,
    decision: LocalToolPermissionDecision,
  ) => {
    void ctrl.decideLocalToolPermission(prompt, decision);
  };

  /**
   * Resolve i18n details for a permission prompt (app-side — uses $_ which is Svelte-only).
   */
  const resolvePermissionPromptDetails = (
    prompt: LocalToolPermissionPrompt,
  ): Array<{ label: string; value: string }> => {
    const details =
      prompt.request.details && typeof prompt.request.details === 'object'
        ? (prompt.request.details as Record<string, unknown>)
        : null;
    if (!details) return [];

    const rows: Array<{ label: string; value: string }> = [];
    const operation = String(details.operation ?? '').trim();
    const command = String(details.command ?? '').trim();
    const pathValue = String(details.path ?? '').trim();
    const scope = String(details.scope ?? '').trim().toLowerCase();

    if (operation) {
      rows.push({ label: $_('chat.tools.permissions.actionLabel'), value: operation });
    }
    if (command) {
      rows.push({ label: $_('chat.tools.permissions.commandLabel'), value: command });
    }
    if (pathValue) {
      rows.push({ label: $_('chat.tools.permissions.pathLabel'), value: pathValue });
    }
    if (scope) {
      rows.push({
        label: $_('chat.tools.permissions.scopeLabel'),
        value:
          scope === 'outside_workspace'
            ? $_('chat.tools.permissions.scopeOutsideWorkspace')
            : $_('chat.tools.permissions.scopeWorkspace'),
      });
    }
    return rows;
  };

  // handleProjectionStreamEvent removed in slice 1C — logic moved to
  // ctrl.attachStream({ onProjectionEvent, onTerminal }). The controller now
  // owns the event routing and message terminal-patching; AppChatPanel only
  // provides the scroll callbacks via the optional hooks.
  // handleLocalToolStreamEvent / clearLocalToolStateForStream / resetLocalToolInterceptionState
  // / parseBufferedToolArgs / hasPendingPermissionPromptForStream / hasInFlightToolForStream
  // / getNextPendingToolCallIdForStream / scheduleNextToolForStream / tryExecuteBufferedLocalTool
  // / scheduleBufferedLocalToolExecution / handleLocalToolCallStart / handleLocalToolCallDelta
  // / handleLocalToolStatusEvent removed in slice 1E — logic moved to the controller.
  // AppChatPanel now calls ctrl.handleLocalToolStreamEvent(event) from the streamHub handler.

  let scrollForcePending = false;
  const BOTTOM_THRESHOLD_PX = 96;
  let editingMessageId: string | null = null;
  let editingContent = '';
  const copiedMessageIds = new Set<string>();
  const COMPOSER_BASE_HEIGHT = 40;
  let composerIsMultiline = false;
  let composerMaxHeight = COMPOSER_BASE_HEIGHT;
  let sessionDocs: ContextDocumentItem[] = [];
  let sessionDocsUploading = false;
  let sessionDocsError: string | null = null;
  let googleDriveConnection: GoogleDriveConnection | null = null;
  let googleDriveConnectionLoaded = false;
  let googleDriveConnectionLoading = false;
  let googleDriveActionInFlight = false;
  let googleDriveConnectionError: string | null = null;
  let sessionCheckpoints: ChatCheckpoint[] = [];
  let checkpointsByAnchorMessageId = new Map<string, ChatCheckpoint>();
  let checkpointActionInFlight = false;
  let pendingCheckpointPrompt: PendingCheckpointPrompt | null = null;
  let sessionDocsKey = '';
  let sessionDocsSseKey = '';
  let sessionTitlesSseKey = '';
  let sessionDocsReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let showComposerMenu = false;
  let previousComposerMenuOpen = false;
  let composerMenuButtonRef: HTMLButtonElement | null = null;
  let composerMenuContextsMaxH = '';
  let composerMenuToolsMaxH = '';
  let composerMenuFixedStyle = '';
  // eslint-disable-next-line no-unused-vars
  let handleDocumentClick: ((_: MouseEvent) => void) | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleUserAISettingsUpdated: ((_: Event) => void) | null = null;
  let handleGoogleDriveConnectionUpdated: ((_: Event) => void) | null = null;
  // contextEntries declared above via contextModule subscription.
  let sortedContexts: ChatContextEntry[] = [];
  let toolEnabledById: Record<string, boolean> = {};
  let extensionRestrictedToolset = false;
  // prefsKey / lastRouteContextKey now managed by contextModule.

  // Projection/history state (slice 1B) is owned by the controller.
  // Aliases below make existing references compile without edits to every site.
  // These getters read from the controller snapshot; mutations use ctrl.* methods.
  $: initialEventsByMessageId = $ctrl.initialEventsByMessageId as Map<string, StreamEvent[]>;
  let runtimeSummaryByMessageId = new Map<string, RuntimeSegmentSummary>();
  $: projectedStreamEventsById = $ctrl.projectedStreamEventsById as Map<string, StreamEvent[]>;
  const loadedRuntimeDetailsMessageIds = new Set<string>();
  const loadingRuntimeDetailsMessageIds = new Set<string>();
  let historyTimelineSessionId: string | null = null;
  let todoRuntimePanel: TodoRuntimePanelState | null = null;
  let todoRuntimeCollapsed = false;
  let todoRuntimeDeleteInFlight = false;
  let composerSteerInFlight = false;
  // composerSteerAck moved to controller (slice 1F); access via $ctrl.composerSteerAck.
  // jobPollInFlight removed in slice 1C — tracking moved to the controller.
  let localToolsHubKey = '';
  // localToolStatesById, localToolInFlight, localToolExecutionTimersById,
  // pendingLocalToolPermissionPrompts, localToolPermissionRetriesInFlight
  // removed in slice 1E — local-tool machine moved to the controller.
  // Access via $ctrl.localToolStatesById / $ctrl.pendingLocalToolPermissionPrompts.
  let extensionActiveTabContext: {
    tabId: number;
    url: string;
    origin: string;
    title: string | null;
  } | null = null;
  // projectionHubKey removed in slice 1C — ctrl.attachStream/detachStream
  // manages the subscription key internally.

  // ---------------------------------------------------------------------------
  // Projection functions (slice 1B) — delegate to the controller.
  // These thin wrappers keep all call-sites unchanged while routing through ctrl.
  // ---------------------------------------------------------------------------

  const isTrackedAssistantStreamId = (streamId: string): boolean =>
    ctrl.isTrackedAssistantStreamId(streamId);

  const mergeProjectedHistoryForStream = (
    streamId: string,
    events: readonly StreamEvent[],
  ) => ctrl.mergeProjectedHistoryForStream(streamId, events as StreamEvent[]);

  const appendProjectedLiveEvent = (streamId: string, event: StreamEvent) =>
    ctrl.appendProjectedLiveEvent(streamId, event);

  const getProjectionEventsForMessage = (message: LocalMessage): StreamEvent[] =>
    ctrl.getProjectionEventsForMessage(message) as StreamEvent[];

  // getProjectedAssistantComputation is used only by buildTimeline, which is
  // now routed through ctrl.buildTimeline() (slice 1B). No local wrapper needed.

  const loadRuntimeDetailsForMessage = async (
    targetSessionId: string,
    messageId: string,
  ): Promise<void> => {
    if (loadedRuntimeDetailsMessageIds.has(messageId)) return;
    if (loadingRuntimeDetailsMessageIds.has(messageId)) return;
    loadingRuntimeDetailsMessageIds.add(messageId);
    try {
      const response = await chatCoreHost.fetchSessionHistory(targetSessionId, 'full');
      if (!response.body) return;
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';
      const collectedEvents: StreamEvent[] = [];
      const processLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line) return;
        const payload = JSON.parse(line) as
          | SessionHistoryMetaLine
          | SessionHistoryTimelineLine;
        if (payload.type !== 'timeline_item') return;
        const item = payload.item;
        if (String(item.message.id ?? '').trim() !== messageId) return;
        if (item.kind !== 'runtime-segment' && item.kind !== 'assistant-segment') return;
        if (item.segment.events && item.segment.events.length > 0) {
          collectedEvents.push(
            ...item.segment.events.map((e: StreamEvent) => ({
              eventType: e.eventType,
              data: e.data,
              sequence: e.sequence,
              createdAt: e.createdAt,
            })),
          );
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n');
        while (boundary >= 0) {
          processLine(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 1);
          boundary = buffer.indexOf('\n');
        }
      }
      buffer += decoder.decode();
      if (buffer.trim().length > 0) processLine(buffer);
      if (collectedEvents.length > 0) {
        // Route through controller (slice 1B): mergeHistoryEvents invalidates cache + notifies.
        ctrl.mergeHistoryEvents(messageId, collectedEvents);
        scanEventsForGeneratedFileCards(messageId, collectedEvents);
      }
      loadedRuntimeDetailsMessageIds.add(messageId);
    } finally {
      loadingRuntimeDetailsMessageIds.delete(messageId);
    }
  };

  let lastDraftApplied = draft;
  $: {
    const nextDraftState = syncChatDraftFromInput({
      mode,
      draft,
      input,
      lastDraftApplied,
      direction: 'external',
    });
    if (nextDraftState.draft !== draft) draft = nextDraftState.draft;
    if (nextDraftState.input !== input) input = nextDraftState.input;
    if (nextDraftState.lastDraftApplied !== lastDraftApplied) {
      lastDraftApplied = nextDraftState.lastDraftApplied;
    }
  }
  const syncDraftFromInput = () => {
    const nextDraftState = syncChatDraftFromInput({
      mode,
      draft,
      input,
      lastDraftApplied,
      direction: 'input',
    });
    if (nextDraftState.draft !== draft) draft = nextDraftState.draft;
    if (nextDraftState.input !== input) input = nextDraftState.input;
    if (nextDraftState.lastDraftApplied !== lastDraftApplied) {
      lastDraftApplied = nextDraftState.lastDraftApplied;
    }
  };
  $: if (mode === 'ai') {
    syncDraftFromInput();
  }

  // detectContextFromRoute — delegates to contextHost.detectContext (context-adapter).
  const detectContextFromRoute = () =>
    contextHost.detectContext({
      routeId: $contextStore.route.id,
      params: $contextStore.params,
      folderId: $currentFolderId,
    });

  const TOOL_TOGGLES: ToolToggle[] = [
    {
      id: 'documents',
      label: $_('chat.tools.documents.label'),
      description: $_('chat.tools.documents.description'),
      toolIds: ['documents'],
      icon: FileText,
    },
    {
      id: 'comment_assistant',
      label: $_('chat.tools.commentAssistant.label'),
      description: $_('chat.tools.commentAssistant.description'),
      toolIds: ['comment_assistant'],
      icon: MessageCircle,
    },
    {
      id: 'plan',
      label: $_('chat.tools.todoCreate.label'),
      description: $_('chat.tools.todoCreate.description'),
      toolIds: ['plan'],
      icon: List,
    },
    {
      id: 'web_search',
      label: $_('chat.tools.webSearch.label'),
      description: $_('chat.tools.webSearch.description'),
      toolIds: ['web_search'],
      icon: Globe,
    },
    {
      id: 'web_extract',
      label: $_('chat.tools.webExtract.label'),
      description: $_('chat.tools.webExtract.description'),
      toolIds: ['web_extract'],
      icon: Link2,
    },
    {
      id: 'organization_read',
      label: $_('chat.tools.organizationRead.label'),
      toolIds: ['organizations_list', 'organization_get'],
      icon: Building2,
    },
    {
      id: 'organization_update',
      label: $_('chat.tools.organizationUpdate.label'),
      toolIds: ['organization_update'],
      icon: Building2,
    },
    {
      id: 'folder_read',
      label: $_('chat.tools.folderRead.label'),
      toolIds: ['folders_list', 'folder_get'],
      icon: Folder,
    },
    {
      id: 'folder_update',
      label: $_('chat.tools.folderUpdate.label'),
      toolIds: ['folder_update'],
      icon: Folder,
    },
    {
      id: 'usecase_read',
      label: $_('chat.tools.usecaseRead.label'),
      toolIds: ['initiatives_list', 'read_initiative', 'usecases_list', 'usecase_get', 'read_usecase'],
      icon: Lightbulb,
    },
    {
      id: 'usecase_update',
      label: $_('chat.tools.usecaseUpdate.label'),
      toolIds: ['update_initiative', 'usecase_update', 'update_usecase_field'],
      icon: Lightbulb,
    },
    {
      id: 'matrix',
      label: $_('chat.tools.matrix.label'),
      toolIds: ['matrix_get', 'matrix_update'],
      icon: Table,
    },
    {
      id: 'executive_summary',
      label: $_('chat.tools.executiveSummary.label'),
      toolIds: ['executive_summary_get', 'executive_summary_update'],
      icon: ScrollText,
    },
    {
      id: 'tab_read',
      label: $_('chat.tools.localTabRead.label'),
      description: $_('chat.tools.localTabRead.description'),
      toolIds: ['tab_read'],
      icon: ChevronsLeftRightEllipsis,
    },
    {
      id: 'tab_action',
      label: $_('chat.tools.localTabAction.label'),
      description: $_('chat.tools.localTabAction.description'),
      toolIds: ['tab_action'],
      icon: Clapperboard,
    },
    {
      id: 'bash',
      label: $_('chat.tools.localCodeBash.label'),
      description: $_('chat.tools.localCodeBash.description'),
      toolIds: ['bash'],
      icon: Terminal,
    },
    {
      id: 'ls',
      label: $_('chat.tools.localCodeLs.label'),
      description: $_('chat.tools.localCodeLs.description'),
      toolIds: ['ls'],
      icon: FolderOpen,
    },
    {
      id: 'rg',
      label: $_('chat.tools.localCodeRg.label'),
      description: $_('chat.tools.localCodeRg.description'),
      toolIds: ['rg'],
      icon: Search,
    },
    {
      id: 'file_read',
      label: $_('chat.tools.localCodeFileRead.label'),
      description: $_('chat.tools.localCodeFileRead.description'),
      toolIds: ['file_read'],
      icon: FileText,
    },
    {
      id: 'file_edit',
      label: $_('chat.tools.localCodeFileEdit.label'),
      description: $_('chat.tools.localCodeFileEdit.description'),
      toolIds: ['file_edit'],
      icon: Pencil,
    },
    {
      id: 'git',
      label: $_('chat.tools.localCodeGit.label'),
      description: $_('chat.tools.localCodeGit.description'),
      toolIds: ['git'],
      icon: GitBranch,
    },
  ];

  const CHROME_LOCAL_TOOL_TOGGLE_IDS = new Set(['tab_read', 'tab_action']);
  const VSCODE_LOCAL_TOOL_TOGGLE_IDS = new Set([
    'bash',
    'ls',
    'rg',
    'file_read',
    'file_edit',
    'git',
  ]);
  const LOCAL_TOOL_TOGGLE_IDS = new Set([
    ...CHROME_LOCAL_TOOL_TOGGLE_IDS,
    ...VSCODE_LOCAL_TOOL_TOGGLE_IDS,
  ]);

  const getExtensionRuntimeHostKind = (): 'none' | 'chrome' | 'vscode' => {
    const runtime = (globalThis as typeof globalThis & {
      chrome?: { runtime?: { id?: string } };
    }).chrome?.runtime;
    const runtimeId = String(runtime?.id ?? '').trim().toLowerCase();
    if (!runtimeId) return 'none';
    if (runtimeId === 'sentropic.vscode.runtime') return 'vscode';
    return 'chrome';
  };

  const isVsCodeRuntimeHost = (): boolean => {
    return getExtensionRuntimeHostKind() === 'vscode';
  };

  const isCodeWorkspaceConversation = (): boolean =>
    Boolean($selectedWorkspace?.isCodeWorkspace);

  const useUnifiedActiveRunPresentation = (message: LocalMessage): boolean =>
    getMessageStatus(message) === 'processing';

  const getRestrictedAllowedToolIds = (): ReadonlySet<string> => {
    if (!isCodeWorkspaceConversation()) {
      return EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS;
    }
    return isVsCodeRuntimeHost()
      ? VSCODE_NEW_SESSION_ALLOWED_TOOL_IDS
      : EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS;
  };

  const loadPrefs = (id: string | null) => {
    const hasExtensionRuntime = isLocalToolRuntimeAvailable();
    extensionRestrictedToolset = mode === 'ai' && hasExtensionRuntime;
    // Delegate context prefs loading to the context module (handles legacy migration).
    const raw = contextModule.loadPrefs(id) as Record<string, unknown> | null;
    if (raw) {
      if (raw['toolEnabledById'] && typeof raw['toolEnabledById'] === 'object') {
        toolEnabledById = raw['toolEnabledById'] as Record<string, boolean>;
      }
      if (typeof raw['extensionRestrictedToolset'] === 'boolean') {
        extensionRestrictedToolset = hasExtensionRuntime
          ? true
          : (raw['extensionRestrictedToolset'] as boolean);
      }
    }
  };

  const savePrefs = (sessionId: string | null = null) => {
    contextModule.savePrefs(sessionId, {
      toolEnabledById,
      extensionRestrictedToolset,
    });
  };

  const isExtensionNewSessionMode = () =>
    mode === 'ai' &&
    isLocalToolRuntimeAvailable() &&
    isCodeWorkspaceConversation() &&
    !sessionId;

  const isExtensionRestrictedToolsetMode = () =>
    computeIsExtensionRestrictedToolsetMode({
      mode,
      hasExtensionRuntime: isLocalToolRuntimeAvailable(),
      sessionId,
      extensionRestrictedToolset:
        extensionRestrictedToolset && isCodeWorkspaceConversation(),
    });

  const getToolScopeToggles = () => {
    const runtimeKind = getExtensionRuntimeHostKind();
    const hasExtensionRuntime = runtimeKind !== 'none';
    return TOOL_TOGGLES.filter(
      (toggle) => {
        if (!LOCAL_TOOL_TOGGLE_IDS.has(toggle.id)) return true;
        if (!hasExtensionRuntime) return false;
        if (runtimeKind === 'vscode') {
          return VSCODE_LOCAL_TOOL_TOGGLE_IDS.has(toggle.id);
        }
        return CHROME_LOCAL_TOOL_TOGGLE_IDS.has(toggle.id);
      },
    ).map((toggle) => ({
      id: toggle.id,
      toolIds: toggle.toolIds,
    }));
  };

  const getToolToggleDefaults = () => {
    return computeToolToggleDefaults({
      toolToggles: getToolScopeToggles(),
      restrictedMode: isExtensionRestrictedToolsetMode(),
      allowedToolIds: getRestrictedAllowedToolIds(),
    });
  };

  const getVisibleToolToggles = () => {
    const visibleIds = new Set(
      computeVisibleToolToggleIds({
        toolToggles: getToolScopeToggles(),
        restrictedMode: isExtensionRestrictedToolsetMode(),
        allowedToolIds: getRestrictedAllowedToolIds(),
      }),
    );
    return TOOL_TOGGLES.filter(
      (toggle) =>
        visibleIds.has(toggle.id) && !LOCAL_TOOL_TOGGLE_IDS.has(toggle.id),
    );
  };

  const getVisibleLocalToolToggles = () => {
    if (!isExtensionRestrictedToolsetMode()) return [];
    const visibleIds = new Set(
      computeVisibleToolToggleIds({
        toolToggles: getToolScopeToggles(),
        restrictedMode: isExtensionRestrictedToolsetMode(),
        allowedToolIds: getRestrictedAllowedToolIds(),
      }),
    );
    return TOOL_TOGGLES.filter(
      (toggle) =>
        LOCAL_TOOL_TOGGLE_IDS.has(toggle.id) && visibleIds.has(toggle.id),
    );
  };

  const loadExtensionActiveTabContext = async () => {
    if (
      !isLocalToolRuntimeAvailable() ||
      getExtensionRuntimeHostKind() !== 'chrome'
    ) {
      extensionActiveTabContext = null;
      return;
    }
    const runtime = (globalThis as typeof globalThis & {
      chrome?: { runtime?: { id?: string; sendMessage?: Function } };
    }).chrome?.runtime;
    if (!runtime?.id || !runtime?.sendMessage) {
      extensionActiveTabContext = null;
      return;
    }
    try {
      const response = (await runtime.sendMessage({
        type: 'extension_active_tab_context_get',
      })) as
        | {
            ok?: boolean;
            tab?: {
              tabId?: number;
              url?: string;
              origin?: string;
              title?: string | null;
            };
          }
        | undefined;
      if (!response?.ok || !response.tab) {
        extensionActiveTabContext = null;
        return;
      }
      const tabId = Number(response.tab.tabId);
      const url = String(response.tab.url ?? '').trim();
      const origin = String(response.tab.origin ?? '').trim();
      if (!Number.isFinite(tabId) || !url || !origin) {
        extensionActiveTabContext = null;
        return;
      }
      extensionActiveTabContext = {
        tabId,
        url,
        origin,
        title:
          typeof response.tab.title === 'string' ? response.tab.title : null,
      };
    } catch {
      extensionActiveTabContext = null;
    }
  };

  const ensureDefaultToolToggles = () => {
    if (!isLocalToolRuntimeAvailable() || !isCodeWorkspaceConversation()) {
      extensionRestrictedToolset = false;
    } else {
      extensionRestrictedToolset = true;
    }

    const defaults = getToolToggleDefaults();
    if (Object.keys(toolEnabledById).length === 0) {
      toolEnabledById = defaults;
      savePrefs(sessionId);
      return;
    }
    const next = { ...toolEnabledById };
    let changed = false;
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in next)) {
        next[key] = value;
        changed = true;
      }
    }
    if (isExtensionNewSessionMode()) {
      for (const [key, value] of Object.entries(defaults)) {
        if (next[key] !== value) {
          next[key] = value;
          changed = true;
        }
      }
    }
    if (changed) {
      toolEnabledById = next;
      savePrefs(sessionId);
    }
  };

  // updateContextFromRoute / markCurrentContextUsed / toggleContextActive
  // now delegate to the context module (D3). No more local contextEntries mutation.

  const updateContextFromRoute = () => {
    contextModule.updateFromRoute({
      routeId: $contextStore.route.id,
      params: $contextStore.params,
      folderId: $currentFolderId,
    });
    savePrefs(sessionId);
  };

  const markCurrentContextUsed = () => {
    contextModule.markUsed({
      routeId: $contextStore.route.id,
      params: $contextStore.params,
      folderId: $currentFolderId,
    });
    savePrefs(sessionId);
  };

  $: sortedContexts = [...contextEntries];

  const getActiveContexts = () => contextModule.getActiveContexts();

  const getEnabledToolIds = () => {
    return computeEnabledToolIds({
      toolToggles: getToolScopeToggles(),
      toolEnabledById,
      restrictedMode: isExtensionRestrictedToolsetMode(),
      allowedToolIds: getRestrictedAllowedToolIds(),
    });
  };

  const toggleContextActive = (entry: ChatContextEntry) => {
    contextModule.toggleActive(entry.type, entry.id);
    savePrefs(sessionId);
  };

  const toggleTool = (id: string) => {
    const isEnabled = toolEnabledById[id] !== false;
    toolEnabledById = { ...toolEnabledById, [id]: !isEnabled };
    savePrefs(sessionId);
  };

  const isNearBottom = (): boolean => {
    if (!listEl) return true;
    const remaining =
      listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
    return remaining < BOTTOM_THRESHOLD_PX;
  };

  const scheduleScrollToBottom = (opts?: { force?: boolean }) => {
    if (opts?.force) scrollForcePending = true;
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      const force = scrollForcePending;
      scrollForcePending = false;
      if (!force && !followBottom) return;
      void scrollChatToBottomStable();
    });
  };

  const onListScroll = () => {
    followBottom = isNearBottom();
  };

  $: if (mode === 'ai' && errorMsg && errorMsg !== lastShownErrorMsg) {
    lastShownErrorMsg = errorMsg;
    followBottom = true;
    scheduleScrollToBottom({ force: true });
  }

  $: if (!errorMsg) {
    lastShownErrorMsg = null;
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    // mode==='comments' KeyDown is now handled inside CommentsPanel.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (composerSteerReady) {
        void sendComposerSteer();
      } else {
        void sendMessage();
      }
    }
  };

  const handleComposerChange = async () => {
    await tick();
    updateComposerHeight();
  };

  const updateComposerHeight = () => {
    if (!composerEl) return;
    const nextHeightState = resolveComposerHeightState({
      baseHeight: COMPOSER_BASE_HEIGHT,
      containerHeight: panelEl?.clientHeight ?? 0,
      contentHeight: composerEl.scrollHeight || COMPOSER_BASE_HEIGHT,
      wasMultiline: composerIsMultiline,
    });
    composerMaxHeight = nextHeightState.maxHeight;
    composerIsMultiline = nextHeightState.isMultiline;
    if (nextHeightState.shouldRemeasure) {
      requestAnimationFrame(updateComposerHeight);
    }
  };

  // All comment functions + reactive statements removed — now owned by CommentsPanel.

  // commentHost: sentropic-wired CommentHost, instantiated once at mount.
  const commentHost = createSentropicCommentHost((key: string) => $_(key));

  const loadSessionDocs = async () => {
    if (!sessionId) return;
    sessionDocsError = null;
    try {
      const scopedWs = getScopedWorkspaceIdForUser();
      const res = await listDocuments(
        createChatSessionDocumentContext(sessionId, scopedWs),
      );
      sessionDocs = res.items ?? [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sessionDocsError = msg;
    }
  };

  const loadGoogleDriveConnection = async (opts?: { silent?: boolean }) => {
    if (googleDriveConnectionLoading) return;
    googleDriveConnectionLoading = true;
    if (!opts?.silent) googleDriveConnectionError = null;
    try {
      googleDriveConnection = await fetchGoogleDriveConnection();
      googleDriveConnectionLoaded = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      googleDriveConnectionError = msg || $_('chat.documents.googleDrive.loadError');
      googleDriveConnectionLoaded = false;
    } finally {
      googleDriveConnectionLoading = false;
    }
  };

  const refreshGoogleDriveConnection = async (opts?: { silent?: boolean }) => {
    if (googleDriveConnectionLoading) return;
    googleDriveConnectionLoaded = false;
    await loadGoogleDriveConnection(opts);
  };

  const openGoogleDriveSettings = () => {
    showComposerMenu = false;
    getNavigation().goto(GOOGLE_DRIVE_CONNECTORS_ROUTE);
  };

  const ensureSessionDocumentTarget = async (): Promise<string> => {
    if (sessionId) return sessionId;

    const context = detectContextFromRoute();
    const res = await apiPost<{ sessionId: string }>(
      chatSessionsUrl(),
      createChatSessionCreatePayload(context),
    );
    suppressSessionAutoSelect = false;
    sessionId = res.sessionId;
    await loadSessions();
    await loadMessages(res.sessionId, { scrollToBottom: true });
    return res.sessionId;
  };

  // Document host adapter — wraps REST upload/delete and docx download.
  // Drive picking stays in AppChatPanel (heavier orchestration).
  const documentHost = createDocumentHostAdapter({
    getSessionId: () => sessionId,
    ensureSessionTarget: ensureSessionDocumentTarget,
  });

  const createComposerAttachmentPreviewUrl = (file: File): string | undefined => {
    try {
      return URL.createObjectURL(file);
    } catch {
      return undefined;
    }
  };

  const revokeComposerAttachmentPreview = (
    attachment: Pick<ChatComposerAttachmentDraft, 'previewUrl'>,
  ) => {
    if (!attachment.previewUrl?.startsWith('blob:')) return;
    try {
      URL.revokeObjectURL(attachment.previewUrl);
    } catch {
      // ignore browser cleanup failures
    }
  };

  // Attachment list mutations — all routed through composerAttachmentListReducer
  // from @sentropic/chat-ui/documents. Preview URL lifecycle (blob: revocation)
  // stays app-side because it touches browser APIs outside the reducer's scope.

  const clearComposerAttachments = () => {
    for (const attachment of composerAttachments) {
      revokeComposerAttachmentPreview(attachment);
    }
    const [next] = composerAttachmentListReducer(composerAttachments, { type: 'clear' });
    composerAttachments = next as ChatComposerAttachmentDraft[];
  };

  const removeComposerAttachment = (attachmentId: string) => {
    const [next, removed] = composerAttachmentListReducer(composerAttachments, {
      type: 'remove',
      id: attachmentId,
    });
    if (removed) revokeComposerAttachmentPreview(removed);
    composerAttachments = next as ChatComposerAttachmentDraft[];
  };

  const updateComposerAttachment = (
    attachmentId: string,
    patch: Partial<ChatComposerAttachmentDraft>,
  ) => {
    const [next] = composerAttachmentListReducer(composerAttachments, {
      type: 'update',
      id: attachmentId,
      patch,
    });
    composerAttachments = next as ChatComposerAttachmentDraft[];
  };

  const getAttachmentImageSrc = (attachment: ChatMessageAttachment): string => {
    if (attachment.previewUrl) return attachment.previewUrl;
    if (attachment.url) return attachment.url;
    if (attachment.documentId) {
      return getDownloadUrl({
        documentId: attachment.documentId,
        workspaceId: getScopedWorkspaceIdForUser(),
      });
    }
    return '';
  };

  // Resolve image URL for band item — delegates to documentHost adapter.
  const getBandItemImageSrc = (item: UnifiedAttachmentItem): string =>
    documentHost.resolveAttachmentSrc(item) as string;

  // Removing a pending attachment also deletes its just-uploaded context
  // document so no orphaned (model-visible) session document is left behind.
  const removeBandItem = async (item: UnifiedAttachmentItem) => {
    removeComposerAttachment(item.composerAttachmentId);
    const documentId = item.documentId;
    if (!documentId) return;
    try {
      await documentHost.deleteUploadedFile(documentId);
      sessionDocs = sessionDocs.filter((d) => d.id !== documentId);
    } catch (err) {
      sessionDocsError = err instanceof Error ? err.message : String(err);
    }
  };

  const openLightbox = (src: string, alt: string) => {
    if (!src) return;
    lightboxImage = { src, alt };
  };

  const closeLightbox = () => {
    lightboxImage = null;
  };

  const attachImageFileToComposer = async (
    file: File,
    source: 'paste' | 'upload',
  ) => {
    if (!isSupportedImageAttachmentMimeType(file.type)) return false;
    showComposerMenu = false;
    const attachmentId = createComposerAttachmentId();
    const previewUrl = createComposerAttachmentPreviewUrl(file);
    composerAttachments = [
      ...composerAttachments,
      createImageAttachmentDraft({
        id: attachmentId,
        source,
        fileName: file.name || 'image',
        mimeType: file.type,
        sizeBytes: file.size,
        state: 'uploading',
        previewUrl,
      }),
    ];

    sessionDocsUploading = true;
    sessionDocsError = null;
    try {
      const targetSessionId = await ensureSessionDocumentTarget();
      const scopedWs = getScopedWorkspaceIdForUser();
      const uploaded = await uploadDocument({
        ...createChatSessionDocumentContext(targetSessionId, scopedWs),
        file,
      });
      updateComposerAttachment(attachmentId, {
        state: 'ready',
        documentId: uploaded.id,
      });
      await loadSessionDocs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sessionDocsError = msg;
      updateComposerAttachment(attachmentId, {
        state: 'failed',
        error: msg,
      });
    } finally {
      sessionDocsUploading = false;
    }
    return true;
  };

  const addGoogleDriveComposerAttachments = (items: Array<Record<string, unknown>>) => {
    const nextAttachments = items
      .map((item): ChatComposerAttachmentDraft | null => {
        const mimeType = typeof item.mime_type === 'string' ? item.mime_type : '';
        const documentId = typeof item.id === 'string' ? item.id.trim() : '';
        if (documentId.length === 0) return null;
        const fileName =
          typeof item.filename === 'string' && item.filename.trim().length > 0
            ? item.filename
            : 'document';
        const sizeBytes =
          typeof item.size_bytes === 'number' && Number.isFinite(item.size_bytes)
            ? Math.max(0, Math.floor(item.size_bytes))
            : 0;
        if (isSupportedImageAttachmentMimeType(mimeType)) {
          return createImageAttachmentDraft({
            id: createComposerAttachmentId(),
            source: 'drive',
            fileName,
            mimeType: mimeType || 'image/png',
            sizeBytes,
            state: 'ready',
            documentId,
          });
        }
        return {
          id: createComposerAttachmentId(),
          kind: 'file',
          source: 'drive',
          fileName,
          mimeType: mimeType.trim().toLowerCase() || 'application/octet-stream',
          sizeBytes,
          state: 'ready',
          documentId,
        };
      })
      .filter((item): item is ChatComposerAttachmentDraft => item !== null);
    if (nextAttachments.length > 0) {
      composerAttachments = [...composerAttachments, ...nextAttachments];
    }
  };

  const handleComposerPaste = (event: ClipboardEvent) => {
    if (mode !== 'ai') return;
    const { handled, files } = handleComposerPasteImages(event);
    if (!handled) return;
    event.preventDefault();
    for (const file of files) {
      void attachImageFileToComposer(file, 'paste');
    }
  };

  const importSessionDocsFromGoogleDrive = async () => {
    if (googleDriveActionInFlight) return;
    googleDriveActionInFlight = true;
    googleDriveConnectionError = null;
    showComposerMenu = false;

    try {
      const targetSessionId = await ensureSessionDocumentTarget();
      const picker = await fetchGoogleDrivePickerConfig();
      const fileIds = await openGoogleDrivePickerDialog({
        ...picker,
        locale: $locale,
      });
      if (fileIds.length === 0) return;

      await resolveGoogleDrivePickerSelection({ fileIds });
      const attachedItems = await attachGoogleDriveDocuments(
        createGoogleDriveChatAttachInput(targetSessionId, fileIds),
      );
      addGoogleDriveComposerAttachments(attachedItems);
      await loadSessionDocs();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      googleDriveConnectionError = msg || $_('chat.documents.googleDrive.importError');
    } finally {
      googleDriveActionInFlight = false;
    }
  };

  // Non-image documents follow the same per-message attachment model as
  // images: attached as a pending composer chip (kind 'file'), uploaded as a
  // chat-session context document, and sent with the next message.
  const attachFileToComposer = async (file: File, source: 'upload' | 'drive') => {
    showComposerMenu = false;
    const attachmentId = createComposerAttachmentId();
    const draft: ChatComposerAttachmentDraft = {
      id: attachmentId,
      kind: 'file',
      source,
      fileName: file.name || 'document',
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      state: 'uploading',
    };
    composerAttachments = [...composerAttachments, draft];

    sessionDocsUploading = true;
    sessionDocsError = null;
    try {
      const targetSessionId = await ensureSessionDocumentTarget();
      const scopedWs = getScopedWorkspaceIdForUser();
      const uploaded = await uploadDocument({
        ...createChatSessionDocumentContext(targetSessionId, scopedWs),
        file,
      });
      updateComposerAttachment(attachmentId, {
        state: 'ready',
        documentId: uploaded.id,
      });
      await loadSessionDocs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sessionDocsError = msg;
      updateComposerAttachment(attachmentId, { state: 'failed', error: msg });
    } finally {
      sessionDocsUploading = false;
    }
  };

  const onPickSessionDoc = async (event: CustomEvent<{ file: File }>) => {
    const file = event.detail.file;
    if (isSupportedImageAttachmentMimeType(file.type)) {
      await attachImageFileToComposer(file, 'upload');
      return;
    }
    await attachFileToComposer(file, 'upload');
  };


  const startEditMessage = (m: ChatMessage) => {
    if (!m.id || m.role !== 'user') return;
    editingMessageId = m.id;
    editingContent = m.content ?? '';
  };

  const cancelEditMessage = () => {
    editingMessageId = null;
    editingContent = '';
  };

  const saveEditMessage = async (messageId: string) => {
    const next = editingContent.trim();
    if (!next) return;
    errorMsg = null;
    try {
      // Delegate host call + content patch to the controller (slice 1D).
      await ctrl.edit(messageId, next);
      cancelEditMessage();
      await retryMessage(messageId);
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.editMessage'));
    }
  };

  /**
   * Build the standard LocalMessage factory for the assistant slot.
   * Passed as buildAssistantMessage to ctrl.bootstrapRun / ctrl.send / ctrl.retry.
   * Stamps model from the closed-over scope; sessionId comes from the base
   * (the controller passes input.sessionId as base.sessionId in slice 1D).
   */
  const makeAssistantMsgFactory =
    (model: string) =>
    (base: {
      id: string;
      sessionId: string;
      _streamId: string;
      _localStatus: 'processing';
      role: 'assistant';
      content: null;
      createdAt: string;
    }): LocalMessage => ({
      ...base,
      model,
    });

  const retryMessage = async (messageId: string) => {
    if (!sessionId) return;
    errorMsg = null;
    try {
      // App-side: truncate historyTimelineItems before the controller truncates
      // the message list (bootstrapRun inside ctrl.retry does that).
      const truncatedHistory: ProjectedTimelineItem[] = [];
      for (const item of historyTimelineItems) {
        truncatedHistory.push(item);
        if (
          item.kind === 'message' &&
          String(item.message.id ?? '').trim() === messageId
        ) {
          break;
        }
      }
      historyTimelineItems = truncatedHistory;

      // Delegate host call + message list mutation + job-poll to the controller.
      await ctrl.retry(messageId, {
        providerId: $ctrl.selectedProviderId,
        model: $ctrl.selectedModelId,
        buildAssistantMessage: makeAssistantMsgFactory($ctrl.selectedModelId),
        pollTimeoutMs: 90_000,
      });

      // App-side scroll side-effect.
      followBottom = true;
      scheduleScrollToBottom({ force: true });
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.retry'));
    }
  };

  const getCheckpointForUserMessage = (
    userMessageId: string,
  ): ChatCheckpoint | null =>
    getCheckpointForUserMessageFromModule(checkpointsByAnchorMessageId, userMessageId);

  const hasCheckpointRollbackDelta = (
    checkpoint: ChatCheckpoint | null | undefined,
  ): boolean =>
    hasCheckpointMutationDelta(checkpoint, messages, initialEventsByMessageId, {
      isMutatingTool: checkpointHost.isMutatingTool,
      isLocalToolName: checkpointHost.isLocalToolName,
    });

  const getCheckpointPreviewTitle = (userMessageId: string): string => {
    const checkpoint = getCheckpointForUserMessage(userMessageId);
    const baseTitle = $_('chat.checkpoints.restoreFromMessage');
    if (!checkpoint) return baseTitle;
    const previewItems = getCheckpointMutationPreviewItems(
      checkpoint,
      messages,
      initialEventsByMessageId,
      {
        isMutatingTool: checkpointHost.isMutatingTool,
        isLocalToolName: checkpointHost.isLocalToolName,
        humanizeMutation: checkpointHost.humanizeMutation,
      },
    );
    if (previewItems.length === 0) return baseTitle;
    return `${baseTitle}\n${previewItems.join('\n')}`;
  };

  const applyCheckpointRestore = async (
    checkpoint: ChatCheckpoint,
  ): Promise<boolean> => {
    if (!sessionId || checkpointActionInFlight) return false;
    checkpointActionInFlight = true;
    errorMsg = null;
    try {
      await checkpointHost.restoreCheckpoint(sessionId, checkpoint.id);
      await loadMessages(sessionId, { scrollToBottom: true, silent: true });
      return true;
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.checkpointRestore'));
      return false;
    } finally {
      checkpointActionInFlight = false;
    }
  };

  const openCheckpointPromptForMessage = (userMessageId: string) => {
    const checkpoint = getCheckpointForUserMessage(userMessageId);
    if (!checkpoint || !hasCheckpointRollbackDelta(checkpoint)) return;
    pendingCheckpointPrompt = {
      kind: 'restore',
      checkpoint,
      userMessageId,
    };
  };

  const confirmCheckpointPrompt = async () => {
    const prompt = pendingCheckpointPrompt;
    if (!prompt) return;
    const restored = await applyCheckpointRestore(prompt.checkpoint);
    pendingCheckpointPrompt = null;
    if (!restored) return;
    if (prompt.kind === 'retry') {
      await retryMessage(prompt.userMessageId);
    }
  };

  const cancelCheckpointPrompt = async () => {
    const prompt = pendingCheckpointPrompt;
    pendingCheckpointPrompt = null;
    if (!prompt) return;
    if (prompt.kind === 'retry') {
      await retryMessage(prompt.userMessageId);
    }
  };

  const retryFromAssistant = async (assistantMessageId: string) => {
    const idx = messages.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) return;
    const previousUser = [...messages.slice(0, idx)]
      .reverse()
      .find((m) => m.role === 'user');
    if (!previousUser) return;
    const checkpoint = getCheckpointForUserMessage(previousUser.id);
    if (checkpoint && hasCheckpointRollbackDelta(checkpoint)) {
      pendingCheckpointPrompt = {
        kind: 'retry',
        checkpoint,
        userMessageId: previousUser.id,
        assistantMessageId,
      };
      return;
    }
    await retryMessage(previousUser.id);
  };

  const markCopied = (messageId: string) => {
    copiedMessageIds.add(messageId);
    setTimeout(() => {
      copiedMessageIds.delete(messageId);
    }, 2000);
  };

  const isCopied = (messageId: string) => copiedMessageIds.has(messageId);

  const copyToClipboard = async (text: string, html?: string) => {
    if (!text) return;
    try {
      if (
        navigator?.clipboard?.write &&
        html &&
        typeof ClipboardItem !== 'undefined'
      ) {
        const item = new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        });
        await navigator.clipboard.write([item]);
        return true;
      }
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      return true;
    } catch {
      errorMsg = $_('chat.errors.copy');
    }
    return false;
  };

  export const focusComposer = async () => {
    await tick();
    const target = composerEl?.querySelector(
      '.ProseMirror',
    ) as HTMLElement | null;
    target?.focus();
  };

  const focusComposerEnd = async () => {
    await tick();
    const target = composerEl?.querySelector(
      '.ProseMirror',
    ) as HTMLElement | null;
    if (!target) return;
    target.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const scrollChatToBottomStable = async () => {
    await tick();
    if (!listEl) return;
    // Attendre quelques frames pour les variations de layout (StreamMessage, fonts, etc.)
    let lastHeight = -1;
    for (let i = 0; i < 4; i++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const h = listEl.scrollHeight;
      if (h === lastHeight) break;
      lastHeight = h;
      try {
        listEl.scrollTop = listEl.scrollHeight;
      } catch {
        // ignore
      }
    }
  };

  const formatApiError = (e: unknown, fallback: string) =>
    formatChatApiError(e, fallback);

  const asRuntimeRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  };

  const normalizeRuntimeStatus = (
    value: unknown,
    fallback = 'todo',
  ): string => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : fallback;
  };

  const toTodoRuntimeTask = (value: unknown): TodoRuntimeTask | null => {
    const task = asRuntimeRecord(value);
    if (!task) return null;
    const title = String(task.title ?? '').trim();
    if (!title) return null;
    const id = String(task.id ?? '').trim();
    const status = normalizeRuntimeStatus(
      task.status ?? task.derivedStatus,
      'todo',
    );
    return id
      ? { id, title, status }
      : { title, status };
  };

  const mergeTodoRuntimeTask = (
    tasks: TodoRuntimeTask[],
    incoming: TodoRuntimeTask,
  ): TodoRuntimeTask[] => {
    const idKey = incoming.id ? incoming.id : null;
    const titleKey = incoming.title.trim().toLowerCase();
    const index = tasks.findIndex((task) => {
      if (idKey && task.id === idKey) return true;
      if (!idKey) return task.title.trim().toLowerCase() === titleKey;
      return false;
    });
    if (index === -1) {
      return [...tasks, incoming];
    }
    const next = [...tasks];
    next[index] = {
      ...next[index],
      ...incoming,
    };
    return next;
  };

  const isRuntimeTaskDone = (status: string | undefined): boolean =>
    normalizeRuntimeStatus(status, 'todo') === 'done';

  const resetTodoRuntimePanel = () => {
    todoRuntimePanel = null;
    todoRuntimeCollapsed = false;
    // composerSteerAck moved to controller (slice 1F); cleared by ack timer or sendSteer rollback.
    pendingTodoRuntimeDeleteConfirm = false;
  };

  const getActiveAssistantStreamId = (): string | null => {
    return composerSteerStreamId;
  };

  const handleComposerPrimaryAction = () => {
    // comment_send is now handled inside CommentsPanel
    if (composerPrimaryActionState.action === 'steer_send') {
      void sendComposerSteer();
      return;
    }
    if (composerPrimaryActionState.action === 'chat_send') {
      void sendMessage();
    }
  };

  const handleDeleteTodoRuntime = async () => {
    if (!todoRuntimePanel?.todoId || todoRuntimeDeleteInFlight) return;
    todoRuntimeDeleteInFlight = true;
    try {
      await apiPatch(`/todos/${encodeURIComponent(todoRuntimePanel.todoId)}`, {
        closed: true,
      });
      resetTodoRuntimePanel();
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.todoRuntimePanel.deleteError'));
    } finally {
      todoRuntimeDeleteInFlight = false;
    }
  };

  const sendComposerSteer = async () => {
    const steerText = input.trim();
    if (!steerText) return;
    if (composerSteerInFlight) return;

    const targetStreamId = getActiveAssistantStreamId();
    if (!targetStreamId) {
      errorMsg = $_('chat.steer.unavailable');
      return;
    }

    composerSteerInFlight = true;
    errorMsg = null;

    // App-side: clear input + scroll before the async call (DOM concerns)
    followBottom = true;
    scheduleScrollToBottom({ force: true });
    input = '';
    composerIsMultiline = false;
    updateComposerHeight();

    try {
      // Controller owns: optimistic steer message, composerSteerAck, host.postSteer, rollback
      await ctrl.sendSteer(steerText, targetStreamId, {
        sessionId: sessionId ?? '',
        targetAssistantMessageId: activeAssistantMessage?.id,
        ackMessage: $_('chat.steer.acknowledgement'),
        ackTimeoutMs: 5000,
      });
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.steer.error'));
    } finally {
      composerSteerInFlight = false;
    }
  };

  const handleGeneratedFileCard = (messageId: string, card: GeneratedFileCard) => {
    const existing = generatedFileCardsByMessageId.get(messageId) ?? [];
    if (existing.some(c => c.jobId === card.jobId)) return;
    generatedFileCardsByMessageId = new Map(generatedFileCardsByMessageId);
    generatedFileCardsByMessageId.set(messageId, [...existing, normalizeGeneratedFileCard(card)]);
  };

  const extractGeneratedFileCardsFromRuntimeSummary = (
    messageId: string,
    summary: RuntimeSegmentSummary | undefined,
  ) => {
    for (const card of collectGeneratedFileCardsFromRuntimeSummary(summary)) {
      handleGeneratedFileCard(messageId, card);
    }
  };

  const scanEventsForGeneratedFileCards = (messageId: string, events: readonly { eventType: string; data: any }[]) => {
    for (const card of extractGeneratedFileCardsFromEvents(events)) {
      handleGeneratedFileCard(messageId, card);
    }
  };

  const handleTodoRuntimeToolResult = (update: TodoRuntimeToolResultEvent) => {
    const result = asRuntimeRecord(update.result) ?? {};
    const runtime = asRuntimeRecord(result.todoRuntime) ?? result;
    const activeTodo = asRuntimeRecord(runtime.activeTodo);
    const todo = asRuntimeRecord(runtime.todo);
    const task = asRuntimeRecord(runtime.task);

    const todoIdCandidate =
      String(
        runtime.todoId ??
          todo?.id ??
          activeTodo?.id ??
          todoRuntimePanel?.todoId ??
          '',
      ).trim();
    if (!todoIdCandidate) return;

    const reusingCurrent = todoRuntimePanel?.todoId === todoIdCandidate;
    const next: TodoRuntimePanelState = reusingCurrent && todoRuntimePanel
      ? { ...todoRuntimePanel }
      : {
          todoId: todoIdCandidate,
          planId: null,
          title: '',
          status: 'todo',
          runId: null,
          runStatus: null,
          runTaskId: null,
          tasks: [],
          conflictMessage: null,
          sourceTool: update.toolName,
          updatedAtMs: Date.now(),
        };
    next.todoId = todoIdCandidate;
    next.sourceTool = update.toolName;
    next.updatedAtMs = Date.now();

    const planIdValue = runtime.planId ?? todo?.planId ?? activeTodo?.planId;
    if (typeof planIdValue === 'string') {
      next.planId = planIdValue;
    } else if (planIdValue === null) {
      next.planId = null;
    }

    const titleValue = todo?.title ?? activeTodo?.title;
    if (typeof titleValue === 'string' && titleValue.trim().length > 0) {
      next.title = titleValue.trim();
    }

    const statusValue =
      runtime.todoStatus ??
      todo?.derivedStatus ??
      activeTodo?.derivedStatus ??
      runtime.status ??
      result.status;
    next.status = normalizeRuntimeStatus(statusValue, next.status || 'todo');

    const runtimeTasks = Array.isArray(runtime.tasks) ? runtime.tasks : null;
    const directTasks = Array.isArray(result.tasks) ? result.tasks : null;
    const incomingTaskList = runtimeTasks ?? directTasks;
    if (incomingTaskList) {
      next.tasks = incomingTaskList
        .map((entry) => toTodoRuntimeTask(entry))
        .filter((entry): entry is TodoRuntimeTask => entry !== null);
    }

    const normalizedTask = toTodoRuntimeTask(task);
    if (normalizedTask) {
      next.tasks = mergeTodoRuntimeTask(next.tasks, normalizedTask);
    }

    const conflictCode =
      typeof runtime.code === 'string'
        ? runtime.code.trim().toLowerCase()
        : typeof result.code === 'string'
          ? result.code.trim().toLowerCase()
          : '';
    const conflictMessage =
      typeof runtime.message === 'string'
        ? runtime.message
        : typeof result.message === 'string'
          ? result.message
          : null;
    next.conflictMessage =
      normalizeRuntimeStatus(runtime.status ?? result.status, '') === 'conflict' &&
      conflictCode !== 'active_todo_exists'
        ? conflictMessage
        : null;
    todoRuntimePanel = next;
  };

  const applySessionCheckpoints = (items: ChatCheckpoint[]) => {
    sessionCheckpoints = items;
    // Delegate indexing to the module — returns Map<anchorMessageId, checkpoint>.
    checkpointsByAnchorMessageId = applySessionCheckpointsFromModule(items);
  };

  const mergeInitialEventsForMessage = (
    messageId: string,
    events: readonly StreamEvent[],
  ) => {
    const normalizedId = String(messageId ?? '').trim();
    if (!normalizedId || events.length === 0) return;
    // Route through controller (slice 1B): mergeHistoryEvents handles dedup + notify.
    ctrl.mergeHistoryEvents(normalizedId, events as StreamEvent[]);
    scanEventsForGeneratedFileCards(normalizedId, events);
  };

  const ingestSessionHistoryMeta = (line: SessionHistoryMetaLine) => {
    historyTimelineSessionId = line.sessionId;
    if (typeof line.title === 'string' && line.title.trim().length > 0) {
      sessions = sessions.map((entry) =>
        entry.id === line.sessionId ? { ...entry, title: line.title } : entry,
      );
    }
    applySessionCheckpoints(
      Array.isArray(line.checkpoints) ? line.checkpoints : [],
    );
    sessionDocs = Array.isArray(line.documents) ? line.documents : [];
    sessionDocsError = null;

    const runtimeSnapshot = asRuntimeRecord(line.todoRuntime);
    if (runtimeSnapshot) {
      handleTodoRuntimeToolResult({
        toolCallId: `session-runtime:${line.sessionId}`,
        toolName: 'plan',
        result: { todoRuntime: runtimeSnapshot },
      });
    } else {
      resetTodoRuntimePanel();
    }
  };

  const yieldHistoryRenderFrame = async () => {
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  };

  const stageHistoryTimelineItem = async (item: ProjectedTimelineItem) => {
    stagedHistoryTimelineItems = [...stagedHistoryTimelineItems, item];
    await yieldHistoryRenderFrame();
  };

  const shouldFlushHistoryStage = () => {
    if (stagedHistoryTimelineItems.length === 0) return false;
    const viewportHeight =
      listEl?.clientHeight ?? panelEl?.clientHeight ?? window.innerHeight ?? 0;
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return false;
    const stagedHeight = historyStageMeasureEl?.offsetHeight ?? 0;
    return stagedHeight > viewportHeight;
  };

  const applyHistoryTimelineBlock = async (
    stagedBlock: readonly ProjectedTimelineItem[],
    opts?: { revealAtBottom?: boolean },
  ) => {
    if (stagedBlock.length === 0) return;

    const chronologicalBlock = [...stagedBlock].reverse();
    const previousScrollHeight = listEl?.scrollHeight ?? 0;
    const previousScrollTop = listEl?.scrollTop ?? 0;
    const shouldRevealAtBottom =
      opts?.revealAtBottom === true && previousScrollHeight <= 0;

    // Build next messages + history lists locally, then commit to controller atomically.
    const nextMessages = [...messages];
    const nextHistory = [...historyTimelineItems];
    // Accumulate history events per message id to batch-merge into the controller.
    const accumulatedHistoryEvents = new Map<string, StreamEvent[]>();

    for (const item of chronologicalBlock) {
      const normalizedMessage: LocalMessage = {
        ...item.message,
        _streamId: item.message._streamId ?? item.message.id,
        _localStatus:
          item.message._localStatus ??
          (item.message.content ? 'completed' : undefined),
      };

      const existingMessageIndex = nextMessages.findIndex(
        (entry) => entry.id === normalizedMessage.id,
      );
      if (existingMessageIndex >= 0) {
        nextMessages[existingMessageIndex] = {
          ...nextMessages[existingMessageIndex],
          ...normalizedMessage,
        };
      } else {
        const sequence = Number(normalizedMessage.sequence ?? 0);
        let messageInsertAt = nextMessages.length;
        while (
          messageInsertAt > 0 &&
          Number(nextMessages[messageInsertAt - 1]?.sequence ?? 0) > sequence
        ) {
          messageInsertAt -= 1;
        }
        nextMessages.splice(messageInsertAt, 0, normalizedMessage);
      }

      if (item.kind === 'assistant-segment' || item.kind === 'runtime-segment') {
        const msgId = item.message.id;
        const existing = accumulatedHistoryEvents.get(msgId) ?? [];
        // Merge segment events into accumulator (deduplicate by sequence)
        const merged = mergeProjectionHistoryEvents(existing, item.segment.events);
        accumulatedHistoryEvents.set(msgId, merged);
      }
      if (
        item.kind === 'runtime-segment' &&
        item.segment.runtimeSummary &&
        (item.segment.runtimeSummary.hasReasoning || item.segment.runtimeSummary.hasTools)
      ) {
        runtimeSummaryByMessageId = new Map(runtimeSummaryByMessageId);
        runtimeSummaryByMessageId.set(item.message.id, item.segment.runtimeSummary);
      }
      if (item.kind === 'runtime-segment' && item.segment.runtimeSummary) {
        extractGeneratedFileCardsFromRuntimeSummary(item.message.id, item.segment.runtimeSummary);
      }

      const existingTimelineIndex = nextHistory.findIndex(
        (entry) => entry.key === item.key,
      );
      if (existingTimelineIndex >= 0) {
        nextHistory[existingTimelineIndex] = item;
      } else {
        nextHistory.push(item);
      }
    }
    nextHistory.sort(compareTimelineItems);

    historyHydrationSwapPending = shouldRevealAtBottom;

    // Commit messages to controller (single notify per block).
    ctrl.setMessages(nextMessages);
    // Merge all accumulated history events into the controller.
    for (const [msgId, events] of accumulatedHistoryEvents) {
      ctrl.mergeHistoryEvents(msgId, events);
      scanEventsForGeneratedFileCards(msgId, events);
    }
    historyTimelineItems = nextHistory;
    stagedHistoryTimelineItems = [];

    await yieldHistoryRenderFrame();

    if (listEl) {
      if (shouldRevealAtBottom || historyHydrationStickBottom) {
        listEl.scrollTop = listEl.scrollHeight;
        await yieldHistoryRenderFrame();
      } else if (previousScrollHeight > 0) {
        listEl.scrollTop =
          listEl.scrollHeight - previousScrollHeight + previousScrollTop;
      } else {
        scheduleScrollToBottom({ force: true });
      }
    }

    if (shouldRevealAtBottom) {
      historyHydrationSwapPending = false;
    }
  };

  const loadCheckpoints = async (id: string) => {
    if (!id) {
      applySessionCheckpoints([]);
      return;
    }
    try {
      const items = await checkpointHost.fetchCheckpoints(id);
      applySessionCheckpoints(items as ChatCheckpoint[]);
    } catch {
      applySessionCheckpoints([]);
    }
  };

  const createTurnCheckpoint = async (
    targetSessionId: string,
    anchorMessageId: string,
  ) => {
    if (!targetSessionId || !anchorMessageId) return;
    try {
      await checkpointHost.createCheckpoint(targetSessionId, anchorMessageId);
      await loadCheckpoints(targetSessionId);
    } catch {
      // checkpoint creation is best-effort and must not block chat flow
    }
  };

  const loadSessions = async () => {
    loadingSessions = true;
    errorMsg = null;
    try {
      const res = await chatCoreHost.fetchSessions();
      sessions = (res.sessions ?? []) as ChatSession[];
      // If the current sessionId is stale (e.g. from a different workspace), clear it
      if (sessionId && !sessions.some((s) => s.id === sessionId) && messages.length === 0) {
        sessionId = null;
        ctrl.setMessages([]);
      }
      if (!suppressSessionAutoSelect && !sessionId && sessions.length > 0) {
        void selectSession(sessions[0].id);
      }
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.loadSessions'));
    } finally {
      loadingSessions = false;
    }
  };

  const loadMessages = async (
    id: string,
    opts?: { scrollToBottom?: boolean; silent?: boolean },
  ) => {
    const hydrationGeneration = sessionHydrationGeneration;
    const isCurrentHydration = () =>
      hydrationGeneration === sessionHydrationGeneration;
    const shouldShowLoader = !opts?.silent;
    const serverMessageIds = new Set<string>();
    const serverTimelineKeys = new Set<string>();
    const serverEventMessageIds = new Set<string>();
    if (shouldShowLoader) loadingMessages = true;
    errorMsg = null;
    try {
      if (!opts?.silent || sessionId !== id) {
        historyHydrationInFlight = true;
        historyHydrationSwapPending = false;
        historyHydrationStickBottom = true;
        ctrl.clearOptimisticSteerMessages(); // slice 1F: clear steer messages on session load
        historyTimelineItems = [];
        stagedHistoryTimelineItems = [];
        historyTimelineSessionId = null;
        runtimeSummaryByMessageId = new Map();
        loadedRuntimeDetailsMessageIds.clear();
        loadingRuntimeDetailsMessageIds.clear();
        // Reset controller state: clears messages + projection events (slice 1B).
        ctrl.setMessages([]);
        ctrl.resetProjectionState();
        applySessionCheckpoints([]);
        sessionDocs = [];
        sessionDocsError = null;
        resetTodoRuntimePanel();
      }
      const response = await chatCoreHost.fetchSessionHistory(id, 'summary');
      if (!response.body) {
        throw new Error('Session history stream returned an empty body');
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';

      const processLine = async (rawLine: string) => {
        const line = rawLine.trim();
        if (!line) return;
        if (!isCurrentHydration()) return;
        const payload = JSON.parse(line) as
          | SessionHistoryMetaLine
          | SessionHistoryTimelineLine;
        if (payload.type === 'session_meta') {
          ingestSessionHistoryMeta(payload);
          return;
        }
        if (payload.type === 'timeline_item') {
          serverTimelineKeys.add(payload.item.key);
          serverMessageIds.add(String(payload.item.message.id ?? '').trim());
          if (
            payload.item.kind === 'assistant-segment' ||
            payload.item.kind === 'runtime-segment'
          ) {
            serverEventMessageIds.add(String(payload.item.message.id ?? '').trim());
          }
          await stageHistoryTimelineItem(payload.item);
          if (shouldFlushHistoryStage()) {
            await applyHistoryTimelineBlock(stagedHistoryTimelineItems, {
              revealAtBottom: historyTimelineItems.length === 0,
            });
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n');
        while (boundary >= 0) {
          const line = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 1);
          await processLine(line);
          boundary = buffer.indexOf('\n');
        }
      }
      buffer += decoder.decode();
      if (buffer.trim().length > 0) {
        await processLine(buffer);
      }
      if (!isCurrentHydration()) return;
      if (stagedHistoryTimelineItems.length > 0) {
        await applyHistoryTimelineBlock(stagedHistoryTimelineItems);
      }
      ctrl.filterMessages(serverMessageIds);
      historyTimelineItems = historyTimelineItems.filter((item) =>
        serverTimelineKeys.has(item.key),
      );
      // Stale entries in initialEventsByMessageId are harmless (unreachable by
      // getProjectionEventsForMessage since those message ids are no longer in
      // the message list). They will be cleared on next resetProjectionState.
      historyHydrationStickBottom = false;
      historyHydrationInFlight = false;

      const lastAssistantModel = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && Boolean(m.model))?.model;
      if (lastAssistantModel) {
        const fromCatalog = $ctrl.modelCatalogModels.find(
          (entry) => entry.model_id === lastAssistantModel,
        );
        if (fromCatalog) {
          ctrl.setModelSelection(fromCatalog.provider_id, fromCatalog.model_id);
        }
      }
      if (opts?.scrollToBottom !== false) {
        scheduleScrollToBottom({ force: true });
      }
      // Le scroll est exécuté via afterUpdate (une fois le DOM réellement rendu).
    } catch (e) {
      if (isCurrentHydration()) {
        historyHydrationInFlight = false;
        historyHydrationSwapPending = false;
        historyHydrationStickBottom = false;
        errorMsg = formatApiError(e, $_('chat.errors.loadMessages'));
      }
    } finally {
      if (isCurrentHydration()) {
        if (!historyHydrationInFlight) historyHydrationStickBottom = false;
        if (shouldShowLoader) loadingMessages = false;
      }
    }
  };

  export const selectSession = async (id: string) => {
    const hydrationGeneration = ++sessionHydrationGeneration;
    const isCurrentHydration = () =>
      hydrationGeneration === sessionHydrationGeneration;
    // Keep current session visible until the first staged batch is ready.
    // Anti-flash (BUG-L6-44) preserved via deferred clear + revealAtBottom on first batch.
    // Progressive lazy-load (NDJSON line-by-line, end-of-conversation first) restored.
    historyHydrationInFlight = true;
    historyHydrationStickBottom = true;
    loadingMessages = true;
    errorMsg = null;

    const serverMessageIds = new Set<string>();
    const serverTimelineKeys = new Set<string>();
    const serverEventMessageIds = new Set<string>();
    let pendingDeferredClear = true;

    const performDeferredClear = () => {
      if (!isCurrentHydration()) return false;
      ctrl.clearOptimisticSteerMessages(); // slice 1F: clear steer messages on deferred session swap
      loadedRuntimeDetailsMessageIds.clear();
      loadingRuntimeDetailsMessageIds.clear();
      ctrl.resetLocalToolMachineState(); // slice 1E: clear local-tool state (keeps executor attached)
      historyTimelineItems = [];
      runtimeSummaryByMessageId = new Map();
      sessionDocs = [];
      sessionDocsError = null;
      suppressSessionAutoSelect = false;
      clearComposerAttachments();
      sessionId = id;
      // Reset controller state: clears messages + projection events (slice 1B).
      ctrl.setMessages([]);
      ctrl.resetProjectionState();
      historyHydrationSwapPending = true;
      return true;
    };

    try {
      const response = await chatCoreHost.fetchSessionHistory(id, 'summary');
      if (!response.body) {
        throw new Error('Session history stream returned an empty body');
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';

      const processLine = async (rawLine: string) => {
        const line = rawLine.trim();
        if (!line) return;
        if (!isCurrentHydration()) return;
        const payload = JSON.parse(line) as
          | SessionHistoryMetaLine
          | SessionHistoryTimelineLine;
        if (payload.type === 'session_meta') {
          // Side-panel state (title, checkpoints, documents, todoRuntime) can update
          // immediately — it is not gated by the timeline visibility swap.
          ingestSessionHistoryMeta(payload);
          return;
        }
        if (payload.type === 'timeline_item') {
          serverTimelineKeys.add(payload.item.key);
          serverMessageIds.add(String(payload.item.message.id ?? '').trim());
          if (
            payload.item.kind === 'assistant-segment' ||
            payload.item.kind === 'runtime-segment'
          ) {
            serverEventMessageIds.add(String(payload.item.message.id ?? '').trim());
          }
          await stageHistoryTimelineItem(payload.item);
          if (!isCurrentHydration()) return;
          if (shouldFlushHistoryStage()) {
            if (pendingDeferredClear) {
              // First viewport-sized batch ready: atomically clear previous
              // session state and reveal the new one at the bottom.
              if (!performDeferredClear()) return;
              pendingDeferredClear = false;
              await applyHistoryTimelineBlock(stagedHistoryTimelineItems, {
                revealAtBottom: true,
              });
            } else {
              await applyHistoryTimelineBlock(stagedHistoryTimelineItems);
            }
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n');
        while (boundary >= 0) {
          const line = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 1);
          await processLine(line);
          boundary = buffer.indexOf('\n');
        }
      }
      buffer += decoder.decode();
      if (buffer.trim().length > 0) {
        await processLine(buffer);
      }
      if (!isCurrentHydration()) return;

      // Final flush: empty session, or last partial batch under viewport size.
      if (pendingDeferredClear) {
        if (!performDeferredClear()) return;
        pendingDeferredClear = false;
      }
      if (stagedHistoryTimelineItems.length > 0) {
        await applyHistoryTimelineBlock(stagedHistoryTimelineItems, {
          revealAtBottom: historyTimelineItems.length === 0,
        });
      }

      ctrl.filterMessages(serverMessageIds);
      historyTimelineItems = historyTimelineItems.filter((item) =>
        serverTimelineKeys.has(item.key),
      );
      // Stale entries in initialEventsByMessageId are harmless — see loadMessages comment.

      const lastAssistantModel = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && Boolean(m.model))?.model;
      if (lastAssistantModel) {
        const fromCatalog = $ctrl.modelCatalogModels.find(
          (entry) => entry.model_id === lastAssistantModel,
        );
        if (fromCatalog) {
          ctrl.setModelSelection(fromCatalog.provider_id, fromCatalog.model_id);
        }
      }
    } catch (e) {
      // On failure, ensure the previous session stays visible (no half-applied swap)
      // and surface the error to the user. If the deferred clear already happened,
      // we leave the partial state in place — same behavior as the old code path.
      if (isCurrentHydration()) {
        historyHydrationSwapPending = false;
        errorMsg = formatApiError(e, $_('chat.errors.loadMessages'));
      }
    } finally {
      if (isCurrentHydration()) {
        historyHydrationStickBottom = false;
        historyHydrationInFlight = false;
        historyHydrationSwapPending = false;
        loadingMessages = false;
      }
    }
  };

  // refreshCommentThreads removed — CommentsPanel owns thread state via createCommentState.

  export const newSession = () => {
    sessionHydrationGeneration += 1;
    suppressSessionAutoSelect = true;
    sessionId = null;
    historyTimelineItems = [];
    stagedHistoryTimelineItems = [];
    historyTimelineSessionId = null;
    sessionCheckpoints = [];
    sessionDocs = [];
    sessionDocsError = null;
    runtimeSummaryByMessageId = new Map();
    loadedRuntimeDetailsMessageIds.clear();
    loadingRuntimeDetailsMessageIds.clear();
    historyHydrationInFlight = false;
    historyHydrationStickBottom = false;
    historyHydrationSwapPending = false;
    loadingMessages = false;
    ctrl.clearOptimisticSteerMessages(); // slice 1F: clear steer messages on new session
    resetTodoRuntimePanel();
    ctrl.resetLocalToolMachineState(); // slice 1E: clear local-tool state (keeps executor attached)
    // Reset controller state: clears messages + projection events (slice 1B).
    ctrl.setMessages([]);
    ctrl.resetProjectionState();
    ctrl.resetModelSelectionToDefaults(); // slice 1F: restore default provider/model
    errorMsg = null;
    scheduleScrollToBottom({ force: true });
  };

  const rescopeSessionsForWorkspaceChange = async () => {
    if (workspaceSessionRescopeInFlight) return;
    workspaceSessionRescopeInFlight = true;
    try {
      newSession();
      await loadSessions();
      updateContextFromRoute();
    } finally {
      workspaceSessionRescopeInFlight = false;
    }
  };

  export const deleteCurrentSession = async () => {
    if (!sessionId) return;
    errorMsg = null;
    try {
      await chatCoreHost.deleteSession(sessionId);
      sessionHydrationGeneration += 1;
      suppressSessionAutoSelect = false;
      sessionId = null;
      historyTimelineItems = [];
      stagedHistoryTimelineItems = [];
      historyTimelineSessionId = null;
      sessionDocs = [];
      sessionDocsError = null;
      ctrl.clearOptimisticSteerMessages(); // slice 1F: clear steer messages on session delete
      resetTodoRuntimePanel();
      ctrl.resetLocalToolMachineState(); // slice 1E: clear local-tool state (keeps executor attached)
      // Reset controller state: clears messages + projection events (slice 1B).
      ctrl.setMessages([]);
      ctrl.resetProjectionState();
      await loadSessions();
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.deleteSession'));
    }
  };

  // handleAssistantTerminal removed in slice 1C — moved to the controller.
  // ctrl.attachStream injects onTerminal: (streamId, outcome) =>
  //   scheduleScrollToBottom({ force: true }) so the DOM scroll still fires.

  // pollJobUntilTerminal removed in slice 1C — moved to the controller.
  // Call ctrl.startJobPoll(jobId, streamId, opts) at each run bootstrap.
  // jobPollInFlight tracking is now owned by the controller.

  const loadModelCatalog = async () => {
    try {
      // Controller owns: catalog fetch, providers/models/groups, selection, defaults (slice 1F).
      await ctrl.loadModelCatalog(() => chatCoreHost.fetchModelCatalog());
      selectedModelSelectionKey = `${$ctrl.selectedProviderId}::${$ctrl.selectedModelId}`;
    } catch (error) {
      console.error('Failed to load model catalog for chat:', error);
    }
  };

  const applyUserDefaultsForNewSessions = (
    providerId: ModelProviderId,
    modelId: string,
  ) => {
    // Controller owns: catalog resolution + default/current selection update (slice 1F).
    ctrl.applyUserDefaults(providerId, modelId, { sessionId: sessionId ?? null });
  };

  const isGeminiModel = (modelId: string | null | undefined): boolean =>
    typeof modelId === 'string' &&
    modelId.trim().toLowerCase().startsWith('gemini');

  // modelCatalogGroups, coerceSelectionToValidEntry reactive, selectedProviderId/selectedModelId
  // are now owned by the controller (slice 1F). Derive locals from $ctrl for template use.
  $: selectedModelSelectionKey = `${$ctrl.selectedProviderId}::${$ctrl.selectedModelId}`;
  $: selectedModelWidthCh = computeModelSelectorWidthCh(
    $ctrl.modelCatalogGroups as ModelCatalogGroup[],
    $ctrl.modelCatalogModels as ModelCatalogModel[],
    $ctrl.selectedProviderId,
    $ctrl.selectedModelId,
  );

  const sendMessage = async () => {
    const text = input.trim();
    const sentAttachments = buildSentAttachments(composerAttachments);
    if ((!text && sentAttachments.length === 0) || (sending && !composerSteerReady)) return;

    sending = true;
    errorMsg = null;
    try {
      // Détecter le contexte depuis la route
      updateContextFromRoute();
      markCurrentContextUsed();
      const activeContexts = getActiveContexts();
      const focusContext = activeContexts[0];

      // Construire le payload avec le contexte si disponible
      const payload: {
        sessionId?: string;
        content: string;
        providerId?: ModelProviderId;
        model?: string;
        primaryContextType?: string;
        primaryContextId?: string;
        contexts?: Array<{ contextType: string; contextId: string }>;
        tools?: string[];
        localToolDefinitions?: Array<{
          name: string;
          description: string;
          parameters: Record<string, unknown>;
        }>;
        workspace_id?: string;
        attachments?: Array<{
          kind: 'image' | 'file';
          source: 'context_document';
          documentId: string;
          fileName?: string;
          mimeType?: string;
          sizeBytes?: number;
        }>;
      } = {
        content: text,
      };

      if ($ctrl.selectedProviderId) payload.providerId = $ctrl.selectedProviderId;
      if ($ctrl.selectedModelId) payload.model = $ctrl.selectedModelId;

      if (sessionId) {
        payload.sessionId = sessionId;
      }

      if (focusContext?.type && focusContext.id) {
        payload.primaryContextType = focusContext.type;
        payload.primaryContextId = focusContext.id;
      }

      if (activeContexts.length > 0) {
        payload.contexts = activeContexts
          .filter((c) => c.type && c.id)
          .map((c) => ({
            contextType: c.type,
            contextId: c.id ?? '',
          }));
      }

      const enabledTools = getEnabledToolIds();
      if (enabledTools.length > 0) payload.tools = enabledTools;
      if (sentAttachments.length > 0) {
        payload.attachments = sentAttachments.map((attachment) => ({
          kind: attachment.kind,
          source: 'context_document',
          documentId: attachment.documentId ?? '',
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        }));
      }

      if (isLocalToolRuntimeAvailable()) {
        const enabledLocalToolIds = new Set(
          enabledTools.filter((id) => LOCAL_TOOL_TOGGLE_IDS.has(id)),
        );
        const enabledLocalTools = getLocalToolDefinitions().filter((tool) =>
          enabledLocalToolIds.has(tool.name),
        );
        if (enabledLocalTools.length > 0) {
          payload.localToolDefinitions = enabledLocalTools;
        }
      }

      // Delegate host call + optimistic message insertion + job-poll to the controller.
      // App-side: captures text + sentAttachments + model in factories for the controller.
      const capturedText = text;
      const capturedAttachments = sentAttachments;
      const capturedModel = $ctrl.selectedModelId;

      const { handle } = await ctrl.send(payload, {
        buildUserMessage: (runHandle) => {
          const nowIso = new Date().toISOString();
          return {
            id: runHandle.userMessageId,
            sessionId: runHandle.sessionId,
            role: 'user',
            content: capturedText,
            attachments: capturedAttachments,
            createdAt: nowIso,
            _localStatus: 'completed',
          } as LocalMessage;
        },
        // base.sessionId = handle.sessionId (post-host-call, guaranteed real sessionId).
        buildAssistantMessage: makeAssistantMsgFactory(capturedModel),
        pollTimeoutMs: 90_000,
      });

      // App-side scroll + checkpoint (bootstrapRun inside ctrl.send already did message mutations)
      followBottom = true;
      scheduleScrollToBottom({ force: true });
      if (handle.userMessageId) {
        void createTurnCheckpoint(handle.sessionId, handle.userMessageId);
      }

      // App-side: clear composer + update session state.
      input = '';
      clearComposerAttachments();
      composerIsMultiline = false;
      updateComposerHeight();
      if (handle.sessionId && handle.sessionId !== sessionId) {
        suppressSessionAutoSelect = false;
        sessionId = handle.sessionId;
        if (!sessions.some((s) => s.id === handle.sessionId)) {
          sessions = [{ id: handle.sessionId, title: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as ChatSession, ...sessions];
        }
      }
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.send'));
    } finally {
      sending = false;
    }
  };

  const stopAssistantMessage = async () => {
    if (!activeAssistantMessage) return;
    if (stoppingMessageId) return;
    stoppingMessageId = activeAssistantMessage.id;
    errorMsg = null;
    try {
      // Delegate host call to the controller (slice 1D).
      await ctrl.stop(activeAssistantMessage.id);
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.stop'));
    } finally {
      stoppingMessageId = null;
    }
  };

  const setFeedback = async (
    messageId: string,
    next: 'up' | 'down' | 'clear',
  ) => {
    errorMsg = null;
    try {
      // Delegate host call + feedbackVote patch to the controller (slice 1D).
      await ctrl.setFeedback(messageId, next);
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.feedback'));
    }
  };

  $: {
    if (mode !== 'ai') {
      if (sessionDocsKey) {
        sessionDocsKey = '';
        sessionDocs = [];
      }
    } else {
      const key = sessionId ? `chat_session:${sessionId}` : '';
      if (key && key !== sessionDocsKey) {
        sessionDocsKey = key;
      }
      if (!key && sessionDocsKey) {
        sessionDocsKey = '';
        sessionDocs = [];
      }
    }
  }

  onMount(async () => {
    updateComposerHeight();
    if (mode === 'ai') {
      await loadModelCatalog();
      await loadSessions();
      if (sessionId && messages.length === 0) {
        await loadMessages(sessionId, { scrollToBottom: true });
      }
      loadPrefs(sessionId);
      ensureDefaultToolToggles();
      updateContextFromRoute();
      void loadExtensionActiveTabContext();
      void refreshGoogleDriveConnection({ silent: true });
      handleUserAISettingsUpdated = (event: Event) => {
        const detail = (event as CustomEvent<UserAISettingsUpdatedPayload>)
          .detail;
        if (!detail?.defaultModel) return;
        applyUserDefaultsForNewSessions(
          detail.defaultProviderId,
          detail.defaultModel,
        );
      };
      window.addEventListener(
        USER_AI_SETTINGS_UPDATED_EVENT,
        handleUserAISettingsUpdated,
      );
      handleGoogleDriveConnectionUpdated = () => {
        void refreshGoogleDriveConnection({ silent: true });
      };
      window.addEventListener(
        GOOGLE_DRIVE_CONNECTION_UPDATED_EVENT,
        handleGoogleDriveConnectionUpdated,
      );
    }
    handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      // mention menu handled inside CommentsPanel
    };
    if (handleDocumentClick) {
      document.addEventListener('click', handleDocumentClick);
    }
    // Slice 1E: inject the local-tool machine into the controller.
    // The controller owns state + sequencing; the app supplies extension-specific
    // executor, decider, and result poster (ApiError retry stays app-side).
    ctrl.attachLocalToolMachine({
      executeLocalTool: (toolCallId, name, args, opts) =>
        executeLocalTool(toolCallId, name as LocalToolName, args, opts),
      decideLocalToolPermission: (requestId, decision) =>
        decideLocalToolPermission(requestId, decision as LocalToolPermissionDecision),
      postLocalToolResult: postLocalToolResultWithRetry,
      isLocalToolName: (name: string) => isLocalToolName(name),
      isLocalToolRuntimeAvailable: () => isLocalToolRuntimeAvailable(),
      isLocalToolPermissionRequired: (error: unknown) =>
        error instanceof LocalToolPermissionRequiredError,
      getPermissionRequest: (error: unknown) =>
        (error as LocalToolPermissionRequiredError).request,
    });
    localToolsHubKey = `chat-local-tools:${Math.random().toString(36).slice(2)}`;
    // Route all streamHub local-tool events through the controller (slice 1E).
    streamHub.set(localToolsHubKey, (event: StreamHubEvent) => {
      ctrl.handleLocalToolStreamEvent(event);
    });
    // Slice 1C: controller owns the projection stream subscription.
    ctrl.attachStream({
      streamClient: chatCoreHost.streamClient,
      pollJob: (jobId) => chatCoreHost.pollJob(jobId),
      onProjectionEvent: () => scheduleScrollToBottom(),
      onTerminal: () => scheduleScrollToBottom({ force: true }),
    });
    if (mode !== 'ai') return;
    sessionDocsSseKey = `chat-documents:${Math.random().toString(36).slice(2)}`;
    streamHub.setJobUpdates(sessionDocsSseKey, (ev: StreamHubEvent) => {
      if (ev.type !== 'job_update' || !('jobId' in ev)) return;
      const jobIds = new Set(
        sessionDocs.map((d) => d.job_id).filter(Boolean) as string[],
      );
      if (jobIds.size === 0) return;
      if (!jobIds.has(ev.jobId)) return;
      if (sessionDocsReloadTimer) clearTimeout(sessionDocsReloadTimer);
      sessionDocsReloadTimer = setTimeout(() => {
        void loadSessionDocs();
      }, 150);
    });
    sessionTitlesSseKey = `chat-sessions:${Math.random().toString(36).slice(2)}`;
    streamHub.set(sessionTitlesSseKey, (ev: StreamHubEvent) => {
      if (ev.type !== 'workspace_update') return;
      const action = (ev as any)?.data?.action;
      if (action !== 'chat_session_title_updated') return;
      const sessionIdUpdated = String(
        (ev as any)?.data?.sessionId ?? '',
      ).trim();
      const title = String((ev as any)?.data?.title ?? '').trim();
      if (!sessionIdUpdated || !title) return;
      if (!sessions?.length) return;
      sessions = sessions.map((s) =>
        s.id === sessionIdUpdated ? { ...s, title } : s,
      );
    });
  });

  // Track last loaded prefs session to avoid re-loading on every reactive tick.
  let lastLoadedPrefsSession: string | null | undefined = undefined;

  $: if (mode === 'ai' && sessionId !== undefined && sessionId !== lastLoadedPrefsSession) {
    lastLoadedPrefsSession = sessionId;
    loadPrefs(sessionId);
    ensureDefaultToolToggles();
    void contextModule.refreshLabels();
  }

  $: if (mode === 'ai' && showComposerMenu) {
    void loadExtensionActiveTabContext();
    if (!previousComposerMenuOpen) {
      previousComposerMenuOpen = true;
      void refreshGoogleDriveConnection({ silent: true });
    }
    // Compute dynamic max-heights for context/tool sections
    if (panelEl && composerMenuButtonRef) {
      const panelTop = panelEl.getBoundingClientRect().top;
      const btnTop = composerMenuButtonRef.getBoundingClientRect().top;
      const availableH = btnTop - panelTop - 160; // leave room for header, file input, padding
      const halfH = Math.max(60, Math.floor(availableH / 2));
      composerMenuContextsMaxH = 'max-height:' + halfH + 'px';
      composerMenuToolsMaxH = 'max-height:' + halfH + 'px';
    }
  } else if (previousComposerMenuOpen) {
    previousComposerMenuOpen = false;
  }

  $: if (mode === 'ai' && $workspaceScopeHydrated) {
    const nextWorkspaceId = $selectedWorkspace?.id ?? null;
    if (previousAiWorkspaceId === undefined) {
      previousAiWorkspaceId = nextWorkspaceId;
    } else if (nextWorkspaceId !== previousAiWorkspaceId) {
      previousAiWorkspaceId = nextWorkspaceId;
      googleDriveConnection = null;
      googleDriveConnectionLoaded = false;
      googleDriveConnectionError = null;
      void loadGoogleDriveConnection({ silent: true });
      void rescopeSessionsForWorkspaceChange();
    }
  }

  let lastPath = '';
  $: if (
    mode === 'ai' &&
    $contextStore?.url?.pathname &&
    $contextStore.url.pathname !== lastPath
  ) {
    lastPath = $contextStore.url.pathname;
    updateContextFromRoute();
  }

  $: if (
    mode === 'ai' &&
    ($organizationsStore || $foldersStore || $initiativesStore)
  ) {
    // Refresh labels when Svelte stores hydrate (module owns label cache + store patches).
    void contextModule.refreshLabels();
  }

  onDestroy(() => {
    if (sessionDocsReloadTimer) clearTimeout(sessionDocsReloadTimer);
    sessionDocsReloadTimer = null;
    if (sessionDocsSseKey) streamHub.delete(sessionDocsSseKey);
    sessionDocsSseKey = '';
    if (sessionTitlesSseKey) streamHub.delete(sessionTitlesSseKey);
    sessionTitlesSseKey = '';
    if (localToolsHubKey) streamHub.delete(localToolsHubKey);
    localToolsHubKey = '';
    ctrl.detachStream(); // slice 1C: controller owns projection subscription teardown
    ctrl.detachLocalToolMachine(); // slice 1E: controller owns local-tool teardown
    if (handleDocumentClick) {
      document.removeEventListener('click', handleDocumentClick);
    }
    if (handleUserAISettingsUpdated) {
      window.removeEventListener(
        USER_AI_SETTINGS_UPDATED_EVENT,
        handleUserAISettingsUpdated,
      );
    }
    if (handleGoogleDriveConnectionUpdated) {
      window.removeEventListener(
        GOOGLE_DRIVE_CONNECTION_UPDATED_EVENT,
        handleGoogleDriveConnectionUpdated,
      );
    }
    clearComposerAttachments();
  });
</script>


<!-- Gold shell adoption (S6a): the gold panel markup now lives in
     @sentropic/chat-ui ChatPanelShell; this host defines the domain snippets
     (rich-text input, popover menus, icons) and wires its orchestration
     state into the shell's props. -->
    {#snippet renderComposerInput(p: { value: string; disabled: boolean; placeholder: string; onChange: (v: string) => void; onKeyDown: (e: KeyboardEvent) => void })}
      <!-- Restore GOLD fidelity: comments composer uses EditableInput (TipTap/contenteditable).
           The wrapping div captures keydown events from the ProseMirror contenteditable,
           forwarding them to CommentsPanel's Enter-to-send / @mention handler.
           role=textbox + aria-label preserve the selector used by e2e spec 04. -->
      <!-- svelte-ignore a11y-no-static-element-interactions a11y-interactive-supports-focus -->
      <div
        class="w-full"
        role="textbox"
        aria-label={$_('chat.composer.ariaLabel')}
        aria-disabled={p.disabled}
        aria-multiline="true"
        tabindex="0"
        on:keydown={p.onKeyDown}
      >
        <EditableInput
          markdown={true}
          value={p.value}
          placeholder={p.placeholder}
          disabled={p.disabled}
          on:change={(e) => p.onChange((e as CustomEvent<{ value: string }>).detail.value)}
        />
      </div>
    {/snippet}
    {#snippet renderThreadMenuPopover(p: {
      threads: CommentThreadSummary[];
      currentThreadId: string | null;
      resolvedCount: number;
      showResolvedComments: boolean;
      onSelect: (t: CommentThreadSummary) => void;
      onNew: () => void;
      onToggleShowResolved: () => void;
      getThreadSectionLabel: (sectionKey: string | null) => string;
    })}
      <!-- Thread picker — faithful restore of the pre-extraction comments header
           menu (MenuPopover + max-h-56 thread list). Lost when CommentsPanel
           became canonical (host never passed this snippet); e2e 07_comment_assistant
           selectThreadByLabel depends on it. -->
      <MenuPopover widthClass="w-72">
        <svelte:fragment slot="trigger" let:toggle>
          <button
            class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
            on:click={toggle}
            title={$_('chat.comments.chooseThread')}
            aria-label={$_('chat.comments.chooseThread')}
            type="button"
          >
            <List class="w-3.5 h-3.5" />
          </button>
        </svelte:fragment>
        <svelte:fragment slot="menu" let:close>
          {#if p.resolvedCount > 0}
            <button
              class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50 flex items-center gap-2"
              type="button"
              on:click|stopPropagation={p.onToggleShowResolved}
            >
              {#if p.showResolvedComments}
                <Eye class="w-3.5 h-3.5" />
                <span>{$_('chat.comments.hideResolved')}</span>
              {:else}
                <EyeOff class="w-3.5 h-3.5" />
                <span>{$_('chat.comments.showResolved')}</span>
              {/if}
            </button>
            <div class="border-t border-slate-100 my-1"></div>
          {/if}
          <button
            class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50"
            type="button"
            on:click={() => {
              close();
              p.onNew();
            }}
          >
            {$_('chat.comments.newThread')}
          </button>
          <div class="border-t border-slate-100 my-1"></div>
          {#if p.threads.length === 0}
            <div class="px-2 py-1 text-[11px] text-slate-500">{$_('chat.comments.none')}</div>
          {:else}
            <div class="max-h-56 overflow-auto slim-scroll space-y-1">
              {#each p.threads as t (t.id)}
                <button
                  class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50 {p.currentThreadId === t.id ? 'text-slate-900 font-semibold' : 'text-slate-600'} {t.status === 'closed' ? 'line-through text-slate-400' : ''}"
                  type="button"
                  on:click={() => {
                    close();
                    p.onSelect(t);
                  }}
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="truncate">
                      {p.getThreadSectionLabel(t.sectionKey) || $_('chat.tabs.comments')}
                    </span>
                    <span class="inline-flex items-center gap-1 text-[10px] text-slate-400">
                      <MessageCircle class="w-3 h-3" />
                      {t.count}
                    </span>
                  </div>
                  <div class="text-[10px] text-slate-400 truncate">
                    {t.authorLabel} — {t.preview}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </svelte:fragment>
      </MenuPopover>
    {/snippet}
{#snippet renderEditForm(p: { messageId: string })}
                    <div class="space-y-2">
                      <EditableInput
                        markdown={true}
                        bind:value={editingContent}
                        placeholder={$_('chat.edit.placeholder')}
                      />
                      <div
                        class="flex items-center justify-end gap-2 text-[11px]"
                      >
                        <button
                          class="chat-edit-action-secondary rounded border border-slate-600 px-2 py-0.5 text-slate-200 hover:bg-slate-800"
                          type="button"
                          on:click={cancelEditMessage}
                        >
                          {$_('common.cancel')}
                        </button>
                        <button
                          class="chat-edit-action-primary rounded bg-white text-slate-900 px-2 py-0.5 hover:bg-slate-200"
                          type="button"
                          on:click={() => void saveEditMessage(p.messageId)}
                        >
                          {$_('common.send')}
                        </button>
                      </div>
                    </div>
{/snippet}
{#snippet renderComposerMenu()}
          <MenuPopover
            placement="up"
            align="left"
            widthClass="w-80"
            menuClass="p-3 space-y-3"
            strategy="fixed"
            bind:open={showComposerMenu}
            bind:triggerRef={composerMenuButtonRef}
          >
            <svelte:fragment slot="trigger" let:toggle>
              <button
                class="rounded text-slate-600 w-8 h-8 flex items-center justify-center hover:bg-slate-100"
                aria-label={$_('common.openMenu')}
                title={$_('common.openMenu')}
                type="button"
                bind:this={composerMenuButtonRef}
                on:click={toggle}
              >
                <Plus class="w-4 h-4" />
              </button>
            </svelte:fragment>
            <svelte:fragment slot="menu">
              <DocumentSourceMenu
                localActionLabel={$_('chat.documents.addFile')}
                localUploading={sessionDocsUploading}
                googleDriveReady={googleDriveConnectionLoaded}
                googleDriveConnected={Boolean(googleDriveConnection?.connected)}
                googleDriveBusy={googleDriveConnectionLoading || googleDriveActionInFlight}
                googleDriveAccountLabel={googleDriveConnection?.accountEmail ?? googleDriveConnection?.accountSubject ?? null}
                on:pickLocal={onPickSessionDoc}
                on:importGoogleDrive={importSessionDocsFromGoogleDrive}
                on:openConnectors={openGoogleDriveSettings}
              />
              <div class="border-t border-slate-100 pt-2"></div>
              <div class="text-xs font-semibold text-slate-600">
                {$_('chat.contexts.title')}
              </div>
              {#if contextEntries.length === 0 && !extensionActiveTabContext}
                <div class="text-[11px] text-slate-500">
                  {$_('chat.contexts.none')}
                </div>
              {:else}
                <ChatContextPicker
                  entries={sortedContexts}
                  iconFor={(e: ChatContextEntry) => getContextIcon(e.type)}
                  onToggle={(e: ChatContextEntry) => toggleContextActive(e)}
                  maxHeightStyle={composerMenuContextsMaxH || 'max-height:10rem'}
                >
                  <svelte:fragment slot="leading">
                    {#if extensionActiveTabContext}
                      <div
                        class="flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-700 bg-slate-50"
                        title={extensionActiveTabContext.url}
                      >
                        <Globe class="w-4 h-4 text-slate-500" />
                        <span class="truncate max-w-[220px]">
                          {$_('chat.context.activeTabPrefix', {
                            values: {
                              title:
                                extensionActiveTabContext.title ||
                                extensionActiveTabContext.origin,
                            },
                          })}
                        </span>
                      </div>
                    {/if}
                  </svelte:fragment>
                </ChatContextPicker>
              {/if}

              <div class="border-t border-slate-100 pt-2">
                <div class="text-xs font-semibold text-slate-600 mb-1">
                  {$_('chat.tools.title')}
                </div>
                <div class="space-y-1 overflow-auto slim-scroll" style={composerMenuToolsMaxH || 'max-height:12rem'}>
                  {#each getVisibleToolToggles() as t (t.id)}
                    <button
                      class="flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                      type="button"
                      on:click={() => toggleTool(t.id)}
                    >
                      <svelte:component
                        this={t.icon}
                        class={`w-4 h-4 ${toolEnabledById[t.id] !== false ? 'text-slate-900' : 'text-slate-400'}`}
                      />
                      <span class="truncate">{t.label}</span>
                    </button>
                  {/each}
                  {#if getVisibleLocalToolToggles().length > 0}
                    <div class="pt-1 mt-1 border-t border-slate-100">
                      <div class="px-1 py-1 text-xs font-semibold text-slate-600">
                        Outils locaux
                      </div>
                      {#each getVisibleLocalToolToggles() as localToolToggle (localToolToggle.id)}
                        <button
                          class="flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                          type="button"
                          on:click={() => toggleTool(localToolToggle.id)}
                        >
                          <svelte:component
                            this={localToolToggle.icon}
                            class={`w-4 h-4 ${toolEnabledById[localToolToggle.id] !== false ? 'text-slate-900' : 'text-slate-400'}`}
                          />
                          <span class="truncate">{localToolToggle.label}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>

            </svelte:fragment>
          </MenuPopover>
{/snippet}
{#snippet renderComposerSurfaceInput()}
            <EditableInput
              markdown={true}
              bind:value={input}
              placeholder={$_('chat.composer.placeholder.chat')}
              on:change={handleComposerChange}
            />
{/snippet}
{#snippet renderRestoreIcon()}<UndoDot class="w-3.5 h-3.5" />{/snippet}
{#snippet renderTrashIcon()}<Trash2 class="w-4 h-4" />{/snippet}
{#snippet renderChevronIcon(p: { collapsed: boolean })}
  <ChevronDown
    class={`w-4 h-4 transition-transform duration-150 ${p.collapsed ? 'rotate-180' : ''}`}
  />
{/snippet}
{#snippet renderStopIcon()}<Square class="w-4 h-4 fill-current stroke-none" />{/snippet}
{#snippet renderSteerIcon()}<ShipWheel class="w-4 h-4" />{/snippet}
{#snippet renderSendIcon()}<Send class="w-4 h-4" />{/snippet}

<ChatPanelShell
  {mode}
  streamClient={streamHub}
  labels={(k: string, o?: Record<string, unknown>) => $_(k, o as Parameters<typeof $_>[1])}
  commentHost={commentHost}
  {commentContextType}
  {commentContextId}
  {commentSectionKey}
  {commentSectionLabel}
  bind:commentThreadId
  bind:commentLoading
  {renderComposerInput}
  {renderComposerSurfaceInput}
  {renderThreadMenuPopover}
  bind:panelEl
  bind:listEl
  bind:historyStageMeasureEl
  {onListScroll}
  {projectedTimelineItems}
  {stagedHistoryTimelineItems}
  messagesCount={messages.length}
  {historyHydrationInFlight}
  {historyHydrationSwapPending}
  {sessionId}
  {editingMessageId}
  {renderEditForm}
  onStartEditMessage={startEditMessage}
  {copyToClipboard}
  {renderMarkdownWithRefs}
  isCopied={isCopied}
  markCopied={markCopied}
  showCheckpointRestoreForMessage={(id: string) => hasCheckpointRollbackDelta(getCheckpointForUserMessage(id))}
  openCheckpointPromptForMessage={openCheckpointPromptForMessage}
  getCheckpointPreviewTitle={getCheckpointPreviewTitle}
  getGeneratedFileCards={(id: string) => generatedFileCardsByMessageId.get(id) ?? []}
  onGeneratedFileCard={handleGeneratedFileCard}
  downloadGeneratedFile={(card: ChatGeneratedFileCard) => void downloadGeneratedFile(card)}
  useUnifiedActiveRunPresentation={(m: unknown) => useUnifiedActiveRunPresentation(m as LocalMessage)}
  isSmoothStreamingModel={isGeminiModel}
  loadRuntimeDetails={(sid: string, mid: string) => loadRuntimeDetailsForMessage(sid, mid)}
  onTodoRuntime={handleTodoRuntimeToolResult as never}
  retryFromAssistant={(id: string) => void retryFromAssistant(id)}
  setFeedback={(id: string, action: 'up' | 'down' | 'clear') => void setFeedback(id, action)}
  getAttachmentImageSrc={getAttachmentImageSrc as never}
  openLightbox={openLightbox}
  {renderRestoreIcon}
  pendingLocalToolPermissionPrompts={pendingLocalToolPermissionPrompts as never}
  onLocalToolPermissionDecision={handleLocalToolPermissionDecision as never}
  resolvePermissionPromptDetails={resolvePermissionPromptDetails as never}
  pendingCheckpointPrompt={pendingCheckpointPrompt}
  {checkpointActionInFlight}
  confirmCheckpointPrompt={confirmCheckpointPrompt}
  cancelCheckpointPrompt={cancelCheckpointPrompt}
  {errorMsg}
  todoRuntimePanel={todoRuntimePanel}
  bind:todoRuntimeCollapsed
  {todoRuntimeDeleteInFlight}
  bind:pendingTodoRuntimeDeleteConfirm
  onDeleteTodoRuntime={handleDeleteTodoRuntime}
  isRuntimeTaskDone={isRuntimeTaskDone}
  {renderTrashIcon}
  {renderChevronIcon}
  lightboxImage={lightboxImage}
  onCloseLightbox={closeLightbox}
  bind:input
  {composerIsMultiline}
  {composerMaxHeight}
  bind:composerEl
  onComposerKeyDown={handleKeyDown}
  onComposerPaste={handleComposerPaste}
  onComposerChange={handleComposerChange}
  {sessionDocsError}
  {googleDriveConnectionError}
  attachmentBand={attachmentBand}
  getBandItemImageSrc={getBandItemImageSrc as never}
  removeBandItem={(item: unknown) => void removeBandItem(item as UnifiedAttachmentItem)}
  {renderComposerMenu}
  bind:selectedModelSelectionKey
  modelCatalogGroups={$ctrl.modelCatalogGroups}
  modelCatalogModels={$ctrl.modelCatalogModels}
  {selectedModelWidthCh}
  onModelChange={({ providerId, modelId }: { providerId: string; modelId: string }) => {
    ctrl.setModelSelection(providerId as ModelProviderId, modelId);
    selectedModelSelectionKey = `${providerId}::${modelId}`;
  }}
  showStopButton={composerSteerReady && activeAssistantMessage !== null}
  stopInFlight={stoppingMessageId === activeAssistantMessage?.id}
  onStopAssistant={stopAssistantMessage}
  primaryDisabled={composerPrimaryActionState.disabled}
  primaryShowsSteer={composerPrimaryButtonShowsSteer}
  onPrimaryAction={handleComposerPrimaryAction}
  {renderStopIcon}
  {renderSteerIcon}
  {renderSendIcon}
/>
