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
  import {
    listComments,
    createComment,
    updateComment,
    closeComment,
    reopenComment,
    deleteComment,
    listMentionMembers,
    type CommentItem,
    type CommentContextType,
    type MentionMember,
  } from '$lib/utils/comments';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import ChatComposerWrapper from '$lib/components/chat/ChatComposerWrapper.svelte';
  import ChatTimelineWrapper from '$lib/components/chat/ChatTimelineWrapper.svelte';
  import { Streamdown } from 'svelte-streamdown';
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
    composerBandItems,
    deleteDocument,
    getDownloadUrl,
    listDocuments,
    uploadDocument,
    type ContextDocumentItem,
    type UnifiedAttachmentItem,
  } from '$lib/utils/documents';
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
  import {
    buildCommentThreads as buildChatCommentThreads,
    findAssignedMentionFromText,
    formatCommentTimestamp as formatChatCommentTimestamp,
    getCommentAuthorLabel,
    getCommentSectionLabel as getChatCommentSectionLabel,
    getInitials,
    getMentionCandidate,
    getMentionLabel,
    getMentionMatches as getChatMentionMatches,
    isAiComment,
    isCommentByUser,
  } from '$lib/chat/comment-adapter';
  import {
    createChatSessionCreatePayload,
    createChatSessionDocumentContext,
    createGoogleDriveChatAttachInput,
    extractGeneratedFileCardsFromEvents,
    extractGeneratedFileCardsFromRuntimeSummary as collectGeneratedFileCardsFromRuntimeSummary,
    getGeneratedFileFormatLabel,
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
  import ModelSelector from '@sentropic/chat-ui/components/ModelSelector.svelte';
  import MessageActions from '@sentropic/chat-ui/components/MessageActions.svelte';
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
    X,
    Plus,
    Download,
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
    Image as ImageIcon,
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
        $_,
      )(type, id),
    $_,
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
  export let commentThreads: Array<{
    id: string;
    sectionKey: string | null;
    count: number;
    lastAt: string;
    preview: string;
    authorLabel: string;
    status: 'open' | 'closed';
    assignedTo: string | null;
    rootId: string;
    createdBy: string;
  }> = [];

  const getCommentSectionLabel = (type: string | null, key: string | null) =>
    getChatCommentSectionLabel(type, key, $_);

  const commentAuthorLabel = (comment: CommentItem) =>
    getCommentAuthorLabel(comment);

  const mentionLabelFor = (member: MentionMember) => getMentionLabel(member);

  const isCommentByCurrentUser = (comment: CommentItem) =>
    isCommentByUser(comment, $session.user);

  const getMentionMatches = (query: string) =>
    getChatMentionMatches(mentionMembers, query);

  let timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  let dateFormatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  $: {
    const intlLocale = $locale === 'fr' ? 'fr-FR' : 'en-US';
    timeFormatter = new Intl.DateTimeFormat(intlLocale, {
      hour: '2-digit',
      minute: '2-digit',
    });
    dateFormatter = new Intl.DateTimeFormat(intlLocale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  const formatCommentTimestamp = (value: string | null | undefined) =>
    formatChatCommentTimestamp({
      value,
      now: new Date(),
      yesterdayLabel: $_('common.yesterday'),
      timeFormatter,
      dateFormatter,
    });

  const findAssignedUserFromText = (text: string) =>
    findAssignedMentionFromText(text, mentionMembers);

  const loadMentionMembers = async () => {
    const workspaceId = getScopedWorkspaceIdForUser();
    if (!workspaceId) return;
    if (mentionLoading && workspaceId === mentionWorkspaceId) return;
    mentionLoading = true;
    mentionError = null;
    mentionDelayElapsed = false;
    if (mentionDelayTimer) clearTimeout(mentionDelayTimer);
    mentionDelayTimer = setTimeout(() => {
      mentionDelayElapsed = true;
      mentionDelayTimer = null;
    }, 500);
    try {
      const res = await listMentionMembers(workspaceId);
      mentionMembers = res.items ?? [];
      mentionWorkspaceId = workspaceId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      mentionError = msg;
    } finally {
      mentionLoading = false;
    }
  };

  const selectMentionMember = (member: MentionMember) => {
    const candidate = getMentionCandidate(commentInput);
    if (!candidate) return;
    const label = mentionLabelFor(member);
    const nextInput = `${commentInput.slice(0, candidate.start)}@${label} ${commentInput.slice(candidate.end)}`;
    commentInput = nextInput;
    assignedToUserId = member.userId;
    assignedToLabel = label;
    showMentionMenu = false;
    mentionQuery = '';
    mentionMatches = [];
    mentionSuppressUntilChange = true;
    mentionSuppressValue = nextInput.trimEnd();
    void focusComposerEnd();
  };

  const buildCommentThreads = (items: CommentItem[]) =>
    buildChatCommentThreads(items);

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
  let commentInput = '';
  let commentMessages: CommentItem[] = [];
  export let commentLoading = false;
  const hasCommentContext = () =>
    Boolean(commentContextType && commentContextId);
  let commentError: string | null = null;
  let commentReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let commentHubKey = '';
  let commentItemsByThread = new Map<string, CommentItem[]>();
  let lastCommentKey = '';
  let lastCommentSectionKey: string | null = null;
  let lastCommentThreadId: string | null = null;
  let lastCommentMessageCount = 0;
  let lastSelectedCommentThreadId: string | null = null;
  let mentionMembers: MentionMember[] = [];
  let mentionLoading = false;
  let mentionError: string | null = null;
  let mentionQuery = '';
  let mentionMatches: MentionMember[] = [];
  let showMentionMenu = false;
  let mentionDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let mentionDelayElapsed = false;
  let mentionWorkspaceId: string | null = null;
  let mentionMenuRef: HTMLDivElement | null = null;
  let showCommentMenu = false;
  let commentMenuButtonRef: HTMLButtonElement | null = null;
  let showResolvedComments = false;
  let assignedToUserId: string | null = null;
  let assignedToLabel: string | null = null;
  let mentionSuppressUntilChange = false;
  let mentionSuppressValue = '';
  // eslint-disable-next-line no-unused-vars
  let handleMentionRefresh: ((_: Event) => void) | null = null;
  let listEl: HTMLDivElement | null = null;
  let historyStageMeasureEl: HTMLDivElement | null = null;
  let composerEl: HTMLDivElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let followBottom = true;
  let scrollScheduled = false;
  let commentPlaceholder = '';
  let commentThreadResolved = false;
  let commentThreadResolvedAt: string | null = null;
  let currentCommentRoot: CommentItem | null = null;
  let activeCommentSectionLabel: string | null = null;
  let canResolveCurrent = false;
  let resolvedThreads: typeof commentThreads = [];
  let resolvedCount = 0;
  let visibleCommentThreads: typeof commentThreads = [];
  let commentThreadIndex = -1;
  let hasPreviousThread = false;
  let hasNextThread = false;
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
  $: attachmentBand = composerBandItems(composerAttachments);
  $: composerPrimaryActionState = resolveComposerPrimaryAction({
    mode,
    input,
    commentInput,
    commentContextType,
    commentContextId,
    workspaceCanComment: $workspaceCanComment,
    commentThreadResolved,
    sending,
    composerRunInFlight,
    composerSteerReady,
    composerSteerInFlight,
    attachments: mode === 'ai' ? composerAttachmentSummary : undefined,
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

  $: commentPlaceholder = !$workspaceCanComment
    ? $_('chat.comments.placeholder.disabledViewer')
    : commentThreadResolved
      ? $_('chat.comments.placeholder.resolved')
      : $_('chat.comments.placeholder.write');
  let scrollForcePending = false;
  const BOTTOM_THRESHOLD_PX = 96;
  let editingMessageId: string | null = null;
  let editingContent = '';
  let editingCommentId: string | null = null;
  let editingCommentContent = '';
  let lastEditableCommentId: string | null = null;
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mode === 'comments') {
        if (showMentionMenu && mentionMatches.length > 0) {
          selectMentionMember(mentionMatches[0]);
          return;
        }
        void sendCommentMessage();
        return;
      }
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

  const loadCommentThreads = async (opts?: { silent?: boolean }) => {
    if (mode !== 'comments') return;
    if (!hasCommentContext()) {
      commentThreads = [];
      commentMessages = [];
      commentItemsByThread = new Map();
      lastCommentThreadId = null;
      lastCommentMessageCount = 0;
      return;
    }
    const contextType = commentContextType;
    const contextId = commentContextId;
    if (!contextType || !contextId) return;
    const shouldShowLoader = !opts?.silent;
    if (shouldShowLoader) commentLoading = true;
    commentError = null;
    const activeThreadId = commentThreadId;
    try {
      const res = await listComments({
        contextType,
        contextId,
      });
      const items = res.items || [];
      const { threads, map } = buildCommentThreads(items);
      commentThreads = threads;
      commentItemsByThread = new Map(map);
      if (activeThreadId && commentItemsByThread.has(activeThreadId)) {
        commentMessages = commentItemsByThread.get(activeThreadId) ?? [];
        const nextCount = commentMessages.length;
        const threadChanged = lastCommentThreadId !== activeThreadId;
        if (threadChanged) {
          lastCommentThreadId = activeThreadId;
          lastCommentMessageCount = nextCount;
          followBottom = true;
          scheduleScrollToBottom({ force: true });
        } else if (
          nextCount > lastCommentMessageCount &&
          (followBottom || isNearBottom())
        ) {
          lastCommentMessageCount = nextCount;
          scheduleScrollToBottom({ force: true });
        } else {
          lastCommentMessageCount = nextCount;
        }
      } else if (!opts?.silent) {
        commentMessages = [];
        lastCommentThreadId = null;
        lastCommentMessageCount = 0;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      commentError = msg;
    } finally {
      if (shouldShowLoader) commentLoading = false;
    }
  };

  const scheduleCommentReload = () => {
    if (commentReloadTimer) return;
    commentReloadTimer = setTimeout(() => {
      commentReloadTimer = null;
      void loadCommentThreads({ silent: true });
    }, 150);
  };

  const sendCommentMessage = async () => {
    if (mode !== 'comments') return;
    if (!$workspaceCanComment || commentThreadResolved) return;
    if (!commentContextType || !commentContextId) return;
    const trimmed = commentInput.trim();
    if (!trimmed) return;
    try {
      if (trimmed.includes('@') && mentionMembers.length === 0) {
        await loadMentionMembers();
      }
      if (!assignedToUserId && mentionMembers.length > 0) {
        const inferred = findAssignedUserFromText(trimmed);
        if (inferred) {
          assignedToUserId = inferred.userId;
          assignedToLabel = mentionLabelFor(inferred);
        }
      }
      if (commentThreadId) {
        await createComment({
          contextType: commentContextType,
          contextId: commentContextId,
          sectionKey: commentSectionKey || undefined,
          content: trimmed,
          threadId: commentThreadId,
          assignedTo: assignedToUserId ?? undefined,
        });
      } else {
        const nowIso = new Date().toISOString();
        const currentUser = $session.user;
        const res = await createComment({
          contextType: commentContextType,
          contextId: commentContextId,
          sectionKey: commentSectionKey || undefined,
          content: trimmed,
          assignedTo: assignedToUserId ?? undefined,
        });
        commentThreadId = res.thread_id;
        const assignedUserId = assignedToUserId ?? currentUser?.id ?? null;
        const assignedMember = assignedToUserId
          ? (mentionMembers.find((m) => m.userId === assignedToUserId) ?? null)
          : null;
        const optimisticComment: CommentItem = {
          id: res.id,
          context_type: commentContextType,
          context_id: commentContextId,
          section_key: commentSectionKey ?? null,
          created_by: currentUser?.id ?? '',
          assigned_to: assignedUserId,
          status: 'open',
          thread_id: res.thread_id,
          content: trimmed,
          created_at: nowIso,
          updated_at: null,
          created_by_user: currentUser
            ? {
                id: currentUser.id,
                email: currentUser.email ?? null,
                displayName: currentUser.displayName ?? null,
              }
            : null,
          assigned_to_user: assignedMember
            ? {
                id: assignedMember.userId,
                email: assignedMember.email ?? null,
                displayName: assignedMember.displayName ?? null,
              }
            : assignedUserId && currentUser
              ? {
                  id: currentUser.id,
                  email: currentUser.email ?? null,
                  displayName: currentUser.displayName ?? null,
                }
              : null,
        };
        commentItemsByThread = new Map(commentItemsByThread);
        commentItemsByThread.set(res.thread_id, [optimisticComment]);
        commentMessages = [optimisticComment];
        const authorLabel =
          currentUser?.displayName ||
          currentUser?.email ||
          currentUser?.id ||
          'Moi';
        commentThreads = [
          {
            id: res.thread_id,
            sectionKey: commentSectionKey ?? null,
            count: 1,
            lastAt: nowIso,
            preview: trimmed,
            authorLabel,
            status: 'open' as const,
            assignedTo: assignedUserId,
            rootId: res.id,
            createdBy: currentUser?.id ?? '',
          },
          ...commentThreads,
        ].filter((t, idx, arr) => arr.findIndex((x) => x.id === t.id) === idx);
        lastCommentThreadId = res.thread_id;
        lastCommentMessageCount = 1;
      }
      commentInput = '';
      assignedToUserId = null;
      assignedToLabel = null;
      mentionQuery = '';
      mentionMatches = [];
      showMentionMenu = false;
      followBottom = true;
      await loadCommentThreads({ silent: true });
      if (commentThreadId && commentItemsByThread.has(commentThreadId)) {
        commentMessages = commentItemsByThread.get(commentThreadId) ?? [];
      }
      scheduleScrollToBottom({ force: true });
    } catch (e) {
      commentError = e instanceof Error ? e.message : String(e);
    }
  };

  const selectCommentThread = (thread: (typeof commentThreads)[number]) => {
    commentThreadId = thread.id;
    commentSectionKey = thread.sectionKey;
    showCommentMenu = false;
  };

  const handleNewCommentThread = () => {
    commentThreadId = null;
    showCommentMenu = false;
  };

  const goToRelativeCommentThread = (direction: -1 | 1) => {
    if (commentThreadIndex < 0) return;
    const next = visibleCommentThreads[commentThreadIndex + direction];
    if (!next) return;
    commentThreadId = next.id;
    commentSectionKey = next.sectionKey;
  };

  const selectNextOpenThreadAfterResolve = (currentThreadId: string, previousOpenThreadOrder: string[]) => {
    const openThreads = commentThreads.filter((t) => t.status !== 'closed');
    if (openThreads.length === 0) {
      commentThreadId = null;
      return;
    }
    const preferredIds = previousOpenThreadOrder.filter((id) => id !== currentThreadId);
    const next = preferredIds
      .map((id) => openThreads.find((t) => t.id === id) ?? null)
      .find(Boolean) ?? openThreads[0];
    commentThreadId = next?.id ?? null;
    commentSectionKey = next?.sectionKey ?? null;
  };

  const handleResolveCommentThread = async () => {
    if (!currentCommentRoot || !canResolveCurrent) return;
    try {
      const currentThreadId = commentThreadId;
      const previousOpenThreadOrder = commentThreads.filter((t) => t.status !== 'closed').map((t) => t.id);
      const wasClosed = currentCommentRoot.status === 'closed';
      if (wasClosed) {
        await reopenComment(currentCommentRoot.id);
      } else {
        await closeComment(currentCommentRoot.id);
      }
      await loadCommentThreads({ silent: true });
      if (!wasClosed && currentThreadId) {
        selectNextOpenThreadAfterResolve(currentThreadId, previousOpenThreadOrder);
      }
    } catch (e) {
      commentError = e instanceof Error ? e.message : String(e);
    }
  };

  const handleDeleteCommentThread = async () => {
    if (!currentCommentRoot) return;
    if (!confirm($_('chat.comments.confirmDeleteThread'))) return;
    try {
      await deleteComment(currentCommentRoot.id);
      commentThreadId = null;
      await loadCommentThreads({ silent: true });
    } catch (e) {
      commentError = e instanceof Error ? e.message : String(e);
    }
  };

  const saveCommentEdit = async (commentId: string, content: string) => {
    if (mode !== 'comments') return;
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      await updateComment(commentId, { content: trimmed });
      await loadCommentThreads();
    } catch (e) {
      commentError = e instanceof Error ? e.message : String(e);
    }
  };

  const startEditComment = (comment: CommentItem) => {
    editingCommentId = comment.id;
    editingCommentContent = comment.content;
  };

  const cancelEditComment = () => {
    editingCommentId = null;
    editingCommentContent = '';
  };

  $: if (mode === 'comments' && editingCommentId && commentThreadId) {
    const items = commentItemsByThread.get(commentThreadId) ?? [];
    if (!items.some((c) => c.id === editingCommentId)) {
      cancelEditComment();
    }
  }

  $: if (mode === 'comments' && editingCommentId) {
    const last =
      commentMessages.length > 0
        ? commentMessages[commentMessages.length - 1]
        : null;
    if (last && last.id === editingCommentId) {
      followBottom = true;
      scheduleScrollToBottom({ force: true });
    }
  }

  const commitEditComment = async () => {
    if (!editingCommentId) return;
    await saveCommentEdit(editingCommentId, editingCommentContent);
    cancelEditComment();
  };

  $: if (mode === 'comments') {
    if (commentSectionKey !== lastCommentSectionKey) {
      lastCommentSectionKey = commentSectionKey;
      commentThreads = [];
      commentMessages = [];
      commentItemsByThread = new Map();
      lastCommentThreadId = null;
      lastCommentMessageCount = 0;
    }
    const key = `${commentContextType || ''}:${commentContextId || ''}:${commentSectionKey || ''}`;
    if (key !== lastCommentKey) {
      lastCommentKey = key;
      void loadCommentThreads();
    }
  }

  $: if (mode === 'comments' && commentThreadId) {
    const root = commentItemsByThread.get(commentThreadId)?.[0] ?? null;
    currentCommentRoot = root;
    commentThreadResolved = root?.status === 'closed';
    commentThreadResolvedAt = (root?.updated_at ?? root?.created_at ?? null) as
      | string
      | null;
  } else {
    currentCommentRoot = null;
    commentThreadResolved = false;
    commentThreadResolvedAt = null;
  }

  $: canResolveCurrent =
    Boolean(currentCommentRoot) &&
    (currentCommentRoot?.created_by === $session.user?.id || $selectedWorkspaceRole === 'admin') &&
    $workspaceCanComment;
  $: activeCommentSectionLabel =
    getCommentSectionLabel(commentContextType, currentCommentRoot?.section_key ?? commentSectionKey) ??
    commentSectionLabel ??
    $_('common.general');

  $: resolvedThreads = commentThreads.filter((t) => t.status === 'closed');
  $: resolvedCount = resolvedThreads.length;
  $: visibleCommentThreads = showResolvedComments ? commentThreads : commentThreads.filter((t) => t.status !== 'closed');
  $: commentThreadIndex = commentThreadId ? visibleCommentThreads.findIndex((t) => t.id === commentThreadId) : -1;
  $: hasPreviousThread = commentThreadIndex > 0;
  $: hasNextThread = commentThreadIndex >= 0 && commentThreadIndex < visibleCommentThreads.length - 1;

  $: if (mode === 'comments') {
    if (commentThreadId && commentItemsByThread.has(commentThreadId)) {
      commentMessages = commentItemsByThread.get(commentThreadId) ?? [];
    } else if (!commentLoading) {
      commentMessages = [];
    }
  }

  $: if (mode === 'comments') {
    const last =
      commentMessages.length > 0
        ? commentMessages[commentMessages.length - 1]
        : null;
    lastEditableCommentId =
      commentThreadId && $session.user && last && isCommentByCurrentUser(last)
        ? last.id
        : null;
  }

  $: if (mode === 'comments') {
    if (
      mentionSuppressUntilChange &&
      commentInput.trimEnd() === mentionSuppressValue
    ) {
      mentionQuery = '';
      showMentionMenu = false;
      mentionMatches = [];
    } else {
      if (
        mentionSuppressUntilChange &&
        commentInput.trimEnd() !== mentionSuppressValue
      ) {
        mentionSuppressUntilChange = false;
        mentionSuppressValue = '';
      }
      const candidate = getMentionCandidate(commentInput);
      if (candidate) {
        mentionQuery = candidate.query;
        showMentionMenu = true;
        void loadMentionMembers();
      } else {
        mentionQuery = '';
        showMentionMenu = false;
      }
      mentionMatches = showMentionMenu ? getMentionMatches(mentionQuery) : [];
    }
  }

  $: if (mode === 'comments') {
    if (commentThreadId !== lastSelectedCommentThreadId) {
      lastSelectedCommentThreadId = commentThreadId;
      lastCommentThreadId = commentThreadId;
      lastCommentMessageCount = commentMessages.length;
      if (commentThreadId) {
        followBottom = true;
        scheduleScrollToBottom({ force: true });
      }
    }
  }

  $: if (mode === 'comments' && commentContextType && commentContextId) {
    if (!commentHubKey)
      commentHubKey = `commentThreads:${Math.random().toString(36).slice(2)}`;
    streamHub.set(commentHubKey, (evt: any) => {
      if (evt?.type !== 'comment_update') return;
      if (
        evt.contextType !== commentContextType ||
        evt.contextId !== commentContextId
      )
        return;
      scheduleCommentReload();
    });
  } else if (commentHubKey) {
    streamHub.delete(commentHubKey);
    commentHubKey = '';
  }


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

  const createComposerAttachmentId = () =>
    `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  const clearComposerAttachments = () => {
    for (const attachment of composerAttachments) {
      revokeComposerAttachmentPreview(attachment);
    }
    composerAttachments = [];
  };

  const removeComposerAttachment = (attachmentId: string) => {
    const attachment = composerAttachments.find((item) => item.id === attachmentId);
    if (attachment) revokeComposerAttachmentPreview(attachment);
    composerAttachments = composerAttachments.filter((item) => item.id !== attachmentId);
  };

  const updateComposerAttachment = (
    attachmentId: string,
    patch: Partial<ChatComposerAttachmentDraft>,
  ) => {
    composerAttachments = composerAttachments.map((attachment) =>
      attachment.id === attachmentId ? { ...attachment, ...patch } : attachment,
    );
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

  const getBandItemImageSrc = (item: UnifiedAttachmentItem): string => {
    if (item.previewUrl) return item.previewUrl;
    if (item.documentId) {
      return getDownloadUrl({
        documentId: item.documentId,
        workspaceId: getScopedWorkspaceIdForUser(),
      });
    }
    return '';
  };

  const getBandItemStatusLabel = (item: UnifiedAttachmentItem): string => {
    if (item.status === 'failed') return $_('common.error');
    if (item.status === 'ready') return item.mimeType;
    return $_('common.loading');
  };

  // Removing a pending attachment also deletes its just-uploaded context
  // document so no orphaned (model-visible) session document is left behind.
  const removeBandItem = async (item: UnifiedAttachmentItem) => {
    removeComposerAttachment(item.composerAttachmentId);
    const documentId = item.documentId;
    if (!documentId) return;
    try {
      await deleteDocument({
        documentId,
        workspaceId: getScopedWorkspaceIdForUser(),
      });
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

  const handleLightboxKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && lightboxImage) {
      event.preventDefault();
      closeLightbox();
    }
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
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      isSupportedImageAttachmentMimeType(file.type),
    );
    if (files.length === 0) return;
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
    if (composerPrimaryActionState.action === 'comment_send') {
      void sendCommentMessage();
      return;
    }
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

  export const refreshCommentThreads = async () => {
    await loadCommentThreads({ silent: true });
    if (commentThreadId && commentItemsByThread.has(commentThreadId)) {
      commentMessages = commentItemsByThread.get(commentThreadId) ?? [];
    }
  };

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
    const sentAttachments: ChatMessageAttachment[] = composerAttachments
      .filter(
        (attachment) =>
          attachment.state === 'ready' &&
          (attachment.kind === 'image' || attachment.kind === 'file') &&
          typeof attachment.documentId === 'string' &&
          attachment.documentId.trim().length > 0,
      )
      .map((attachment) => ({
        kind: attachment.kind,
        source: 'context_document',
        documentId: attachment.documentId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        state: 'ready' as const,
      }));
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
      if (showMentionMenu) {
        if (mentionMenuRef?.contains(target)) return;
        showMentionMenu = false;
      }
    };
    if (handleDocumentClick) {
      document.addEventListener('click', handleDocumentClick);
    }
    if (mode === 'comments') {
      void loadMentionMembers();
      handleMentionRefresh = (event: Event) => {
        const detail = (event as CustomEvent<any>).detail as {
          workspaceId?: string;
        } | null;
        const currentWs = getScopedWorkspaceIdForUser();
        if (
          !currentWs ||
          !detail?.workspaceId ||
          detail.workspaceId !== currentWs
        )
          return;
        void loadMentionMembers();
      };
      window.addEventListener(
        'streamhub:workspace_membership_update',
        handleMentionRefresh,
      );
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
    if (mentionDelayTimer) clearTimeout(mentionDelayTimer);
    if (sessionDocsReloadTimer) clearTimeout(sessionDocsReloadTimer);
    sessionDocsReloadTimer = null;
    if (sessionDocsSseKey) streamHub.delete(sessionDocsSseKey);
    sessionDocsSseKey = '';
    if (sessionTitlesSseKey) streamHub.delete(sessionTitlesSseKey);
    sessionTitlesSseKey = '';
    if (commentReloadTimer) clearTimeout(commentReloadTimer);
    commentReloadTimer = null;
    if (commentHubKey) streamHub.delete(commentHubKey);
    commentHubKey = '';
    if (localToolsHubKey) streamHub.delete(localToolsHubKey);
    localToolsHubKey = '';
    ctrl.detachStream(); // slice 1C: controller owns projection subscription teardown
    ctrl.detachLocalToolMachine(); // slice 1E: controller owns local-tool teardown
    if (handleDocumentClick) {
      document.removeEventListener('click', handleDocumentClick);
    }
    if (handleMentionRefresh) {
      window.removeEventListener(
        'streamhub:workspace_membership_update',
        handleMentionRefresh,
      );
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

<div class="topai-chat-panel-shell flex flex-col h-full" bind:this={panelEl}>
  {#if mode === 'comments'}
    {@const assignedUser = currentCommentRoot?.assigned_to_user ?? null}
    {@const isAssignedToMe = assignedUser?.id && assignedUser.id === $session.user?.id}
    <div class="border-b border-slate-100 px-3 py-2 space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0 text-xs text-slate-500 flex flex-wrap items-center gap-2">
          <span>{activeCommentSectionLabel}</span>
          {#if currentCommentRoot?.status === 'closed' && commentThreadResolvedAt}
            <span class="text-slate-400">•</span>
            <span>
              {$_('chat.comments.resolvedAt', {
                values: { at: formatCommentTimestamp(commentThreadResolvedAt) },
              })}
            </span>
          {:else if assignedUser}
            <span class="text-slate-400">•</span>
            <span>
              {#if isAssignedToMe}
                {$_('chat.comments.assignedToMe')}
              {:else}
                {$_('chat.comments.assignedTo', {
                  values: {
                    label:
                      assignedUser.displayName ||
                      assignedUser.email ||
                      assignedUser.id,
                  },
                })}
              {/if}
            </span>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <MenuPopover bind:open={showCommentMenu} bind:triggerRef={commentMenuButtonRef} widthClass="w-72">
            <svelte:fragment slot="trigger" let:toggle>
              <button
                class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
                on:click={toggle}
                title={$_('chat.comments.chooseThread')}
                aria-label={$_('chat.comments.chooseThread')}
                type="button"
                bind:this={commentMenuButtonRef}
              >
                <List class="w-3.5 h-3.5" />
              </button>
            </svelte:fragment>
            <svelte:fragment slot="menu">
              {#if resolvedCount > 0}
                <button
                  class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50 flex items-center gap-2"
                  type="button"
                  on:click|stopPropagation={() => (showResolvedComments = !showResolvedComments)}
                >
                  {#if showResolvedComments}
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
                on:click={handleNewCommentThread}
              >
                {$_('chat.comments.newThread')}
                {activeCommentSectionLabel ? ` — ${activeCommentSectionLabel}` : ''}
              </button>
              <div class="border-t border-slate-100 my-1"></div>
              {#if visibleCommentThreads.length === 0}
                <div class="px-2 py-1 text-[11px] text-slate-500">{$_('chat.comments.none')}</div>
              {:else}
                <div class="max-h-56 overflow-auto slim-scroll space-y-1">
                  {#each visibleCommentThreads as t (t.id)}
                    <button
                      class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50 {commentThreadId === t.id ? 'text-slate-900 font-semibold' : 'text-slate-600'} {t.status === 'closed' ? 'line-through text-slate-400' : ''}"
                      type="button"
                      on:click={() => selectCommentThread(t)}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span class="truncate">
                          {getCommentSectionLabel(commentContextType, t.sectionKey) || $_('chat.tabs.comments')}
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
          <button
            class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
            on:click={handleNewCommentThread}
            title={$_('chat.comments.newThread')}
            aria-label={$_('chat.comments.newThread')}
            type="button"
          >
            <Plus class="w-4 h-4" />
          </button>
          <button
            class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded disabled:opacity-50"
            on:click={() => void handleResolveCommentThread()}
            title={commentThreadResolved ? $_('chat.comments.reopen') : $_('chat.comments.resolve')}
            aria-label={commentThreadResolved ? $_('chat.comments.reopen') : $_('chat.comments.resolve')}
            type="button"
            disabled={!currentCommentRoot || !canResolveCurrent}
          >
            {#if commentThreadResolved}
              <FolderOpen class="w-4 h-4" />
            {:else}
              <Check class="w-4 h-4" />
            {/if}
          </button>
          <button
            class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded disabled:opacity-50"
            type="button"
            disabled={!hasPreviousThread}
            on:click={() => goToRelativeCommentThread(-1)}
            title={$_('chat.comments.previous')}
            aria-label={$_('chat.comments.previous')}
          >
            <ChevronLeft class="w-4 h-4" />
          </button>
          <button
            class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded disabled:opacity-50"
            type="button"
            disabled={!hasNextThread}
            on:click={() => goToRelativeCommentThread(1)}
            title={$_('chat.comments.next')}
            aria-label={$_('chat.comments.next')}
          >
            <ChevronRight class="w-4 h-4" />
          </button>
          <button
            class="chat-danger-action-button text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
            on:click={() => void handleDeleteCommentThread()}
            title={$_('chat.comments.deleteThread')}
            aria-label={$_('chat.comments.deleteThread')}
            type="button"
            disabled={!currentCommentRoot}
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  {/if}

  <div
    class="flex-1 min-h-0 relative"
    style={mode === 'comments' && commentThreadResolved
      ? 'background-color: #f1f5f9 !important;'
      : ''}
  >
    <div
      class="h-full overflow-y-auto p-3 space-y-2 slim-scroll"
      style={mode === 'comments' && commentThreadResolved
        ? 'scrollbar-gutter: stable; background-color: #f1f5f9 !important;'
        : 'scrollbar-gutter: stable;'}
      bind:this={listEl}
      on:scroll={onListScroll}
    >
      {#if mode === 'comments'}
        {#if commentError}
          <div
            class="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2"
          >
            {commentError}
          </div>
        {/if}
        {#if commentLoading && commentMessages.length === 0}
          <div class="text-xs text-slate-500">{$_('common.loading')}</div>
        {:else if !commentThreadId}
          {#if commentThreads.length > 0}
            <div class="text-xs text-slate-500">
              {$_('chat.comments.selectThreadHint')}
            </div>
          {:else}
            <div class="text-xs text-slate-500">
              {$_('chat.comments.emptyHint')}
            </div>
          {/if}
        {:else if commentMessages.length === 0}
          <div class="text-xs text-slate-500">
            {$_('chat.comments.noMessagesThread')}
          </div>
        {:else}
          {#each commentMessages as c (c.id)}
            {@const isMine = isCommentByCurrentUser(c)}
            {@const canEdit =
              isMine && c.id === lastEditableCommentId && $workspaceCanComment}
            {#if isMine}
              <div class="flex flex-col items-end group">
                {#if isAiComment(c)}
                  <div class="mb-1 flex items-center justify-end">
                    <div
                      class="relative h-7 w-7 rounded-full bg-primary text-white border border-primary/80 flex items-center justify-center text-[11px]"
                    >
                      {getInitials(commentAuthorLabel(c))}
                      <span
                        class="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-white border border-slate-200 flex items-center justify-center"
                      >
                        <Brain class="w-2.5 h-2.5 text-slate-700" />
                      </span>
                    </div>
                  </div>
                {/if}
                <div
                  class="chat-user-bubble max-w-[85%] rounded bg-primary text-white text-xs px-3 py-2 break-words w-full userMarkdown"
                >
                  {#if editingCommentId === c.id}
                    <div class="space-y-2">
                      <EditableInput
                        markdown={true}
                        bind:value={editingCommentContent}
                        placeholder={$_('chat.edit.placeholder')}
                        disabled={!$workspaceCanComment}
                      />
                      <div
                        class="flex items-center justify-end gap-2 text-[11px]"
                      >
                        <button
                          class="chat-edit-action-secondary rounded border border-slate-600 px-2 py-0.5 text-slate-200 hover:bg-slate-800"
                          type="button"
                          on:click={cancelEditComment}
                        >
                          {$_('common.cancel')}
                        </button>
                        <button
                          class="chat-edit-action-primary rounded bg-white text-slate-900 px-2 py-0.5 hover:bg-slate-200"
                          type="button"
                          on:click={() => void commitEditComment()}
                        >
                          {$_('common.send')}
                        </button>
                      </div>
                    </div>
                  {:else}
                    <Streamdown content={c.content ?? ''} />
                  {/if}
                </div>
                <div
                  class="mt-1 flex items-center justify-end gap-2 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <button
                    class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                    on:click={async () => {
                      const text = c.content ?? '';
                      const ok = await copyToClipboard(
                        text,
                        renderMarkdownWithRefs(text),
                      );
                      if (ok) markCopied(c.id);
                    }}
                    type="button"
                    aria-label={$_('common.copy')}
                    title={$_('common.copy')}
                  >
                    {#if isCopied(c.id)}
                      <Check class="w-3.5 h-3.5 text-slate-900" />
                    {:else}
                      <Copy class="w-3.5 h-3.5" />
                    {/if}
                  </button>
                  {#if canEdit && editingCommentId !== c.id}
                    <button
                      class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                      on:click={() => startEditComment(c)}
                      type="button"
                      aria-label="Modifier"
                      title="Modifier"
                    >
                      <Pencil class="w-3.5 h-3.5" />
                    </button>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="flex items-start gap-2 group">
                <div
                  class="relative h-7 w-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[11px] text-slate-600"
                >
                  {getInitials(commentAuthorLabel(c))}
                  {#if isAiComment(c)}
                    <span
                      class="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-white border border-slate-200 flex items-center justify-center"
                    >
                      <Brain class="w-2.5 h-2.5 text-slate-700" />
                    </span>
                  {/if}
                </div>
                <div class="max-w-[85%] w-full">
                  <div
                    class="text-[11px] text-slate-500 mb-1 flex items-center gap-2"
                  >
                    <span
                      >{commentAuthorLabel(c)}{isAiComment(c)
                        ? ', Assistant IA'
                        : ''}</span
                    >
                    {#if c.created_at}
                      <span>{formatCommentTimestamp(c.created_at)}</span>
                    {/if}
                  </div>
                  <div
                    class="rounded border border-slate-200 bg-white text-xs px-3 py-2 break-words"
                  >
                    <Streamdown content={c.content ?? ''} />
                  </div>
                  <div
                    class="mt-1 flex items-center gap-2 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <button
                      class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                      on:click={async () => {
                        const text = c.content ?? '';
                        const ok = await copyToClipboard(
                          text,
                          renderMarkdownWithRefs(text),
                        );
                        if (ok) markCopied(c.id);
                      }}
                      type="button"
                      aria-label={$_('common.copy')}
                      title={$_('common.copy')}
                    >
                      {#if isCopied(c.id)}
                        <Check class="w-3.5 h-3.5 text-slate-900" />
                      {:else}
                        <Copy class="w-3.5 h-3.5" />
                      {/if}
                    </button>
                  </div>
                </div>
              </div>
            {/if}
          {/each}
        {/if}
        {#if commentLoading && commentMessages.length > 0}
          <div class="text-[11px] text-slate-400 mt-2">
            {$_('chat.comments.updating')}
          </div>
        {/if}
      {:else}
        {#snippet renderTimelineMessageAttachments(item: any)}
          {#if item.kind === 'message' && item.message.role === 'user' && (item.message.attachments?.length ?? 0) > 0}
            <div class="mt-1 flex justify-end">
              <div class="grid max-w-[85%] grid-cols-2 gap-1">
                {#each item.message.attachments as attachment (attachment.id ?? attachment.documentId ?? attachment.url ?? attachment.fileName)}
                  {#if attachment.kind === 'image'}
                    {@const imageSrc = getAttachmentImageSrc(attachment)}
                    <div class="overflow-hidden rounded border border-primary/20 bg-white/10">
                      {#if imageSrc}
                        <button
                          type="button"
                          class="block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          aria-label={$_('chat.attachments.enlarge')}
                          title={$_('chat.attachments.enlarge')}
                          on:click={() =>
                            openLightbox(imageSrc, attachment.fileName ?? 'image')}
                        >
                          <img
                            src={imageSrc}
                            alt={attachment.fileName ?? 'image'}
                            class="block h-24 w-24 object-cover"
                            loading="lazy"
                          />
                        </button>
                      {:else}
                        <div class="flex h-24 w-24 items-center justify-center bg-slate-100 text-slate-500">
                          <ImageIcon class="h-5 w-5" />
                        </div>
                      {/if}
                    </div>
                  {:else if attachment.kind === 'file'}
                    <a
                      class="col-span-2 flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                      href={getAttachmentImageSrc(attachment)}
                      download={attachment.fileName ?? 'document'}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={attachment.fileName ?? 'document'}
                    >
                      <FileText class="h-4 w-4 shrink-0 text-primary" />
                      <span class="truncate">{attachment.fileName ?? 'document'}</span>
                      <Download class="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />
                    </a>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
        {/snippet}

        {#snippet renderTimelineUserMessage(item: any)}
            {#if item.kind === 'message' && item.message.role === 'user'}
              {@const m = item.message}
              <div class="flex flex-col items-end group">
                <div
                  class="chat-user-bubble max-w-[85%] rounded bg-primary text-white text-xs px-3 py-2 break-words w-full userMarkdown"
                >
                  {#if editingMessageId === m.id}
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
                          on:click={() => void saveEditMessage(m.id)}
                        >
                          {$_('common.send')}
                        </button>
                      </div>
                    </div>
                  {:else}
                    {#if (m.content ?? '').trim().length > 0}
                      <Streamdown content={m.content ?? ''} />
                    {/if}
                  {/if}
                </div>
                <div
                  class="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {#if hasCheckpointRollbackDelta(getCheckpointForUserMessage(m.id))}
                    <button
                      class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                      on:click={() => openCheckpointPromptForMessage(m.id)}
                      type="button"
                      aria-label={$_('chat.checkpoints.restoreFromMessage')}
                      title={getCheckpointPreviewTitle(m.id)}
                    >
                      <UndoDot class="w-3.5 h-3.5" />
                    </button>
                  {/if}
                  <MessageActions
                    role="user"
                    streamStatus="completed"
                    isCopied={isCopied(m.id)}
                    labels={$_}
                    onCopy={async () => {
                      const text = m.content ?? '';
                      const ok = await copyToClipboard(text, renderMarkdownWithRefs(text));
                      if (ok) markCopied(m.id);
                    }}
                    onEdit={() => startEditMessage(m)}
                  />
                </div>
              </div>
            {/if}
        {/snippet}

        {#snippet renderTimelineAssistantSegment(item: any)}
              {@const m = item.message}
              <div class="flex justify-start group">
                <div class="max-w-[85%] w-full">
                  <StreamMessage
                    variant="chat"
                    streamId={item.key}
                    status={item.isTerminal ? 'completed' : 'processing'}
                    finalContent={item.segment.content}
                    smoothContentStreaming={isGeminiModel(m.model)}
                    subscriptionMode="passive"
                    initialEvents={item.segment.events}
                    initiallyExpanded={false}
                    deferCollapsedDetails={!useUnifiedActiveRunPresentation(item.message)}
                    onGeneratedFile={(card) => handleGeneratedFileCard(m.id, card)}
                  />
                  {#if item.isTerminal && item.isLastAssistantSegment}
                    {@const generatedFileCards = generatedFileCardsByMessageId.get(m.id) ?? []}
                    {#each generatedFileCards as card (card.jobId)}
                      <div class="rounded border border-slate-200 bg-white px-2 py-1.5 flex items-center gap-2 max-w-[14rem] mt-1">
                        <FileText class="w-4 h-4 text-primary shrink-0" />
                        <div class="min-w-0 flex-1">
                          <div class="text-xs font-medium text-slate-900 truncate">{card.fileName}</div>
                          <div class="text-[10px] text-slate-500">{getGeneratedFileFormatLabel(card.format)}</div>
                        </div>
                        <button
                          class="ml-auto text-primary hover:bg-slate-100 rounded p-1"
                          type="button"
                          aria-label={$_('common.download')}
                          on:click={() => downloadGeneratedFile(card)}
                        >
                          <Download class="w-3.5 h-3.5" />
                        </button>
                      </div>
                    {/each}
                  {/if}
                  <MessageActions
                    role="assistant"
                    streamStatus={item.isTerminal ? 'completed' : 'processing'}
                    isLastAssistantSegment={item.isLastAssistantSegment}
                    isCopied={isCopied(item.key)}
                    feedbackVote={m.feedbackVote ?? null}
                    labels={$_}
                    onCopy={async () => {
                      const text = m.content ?? '';
                      const ok = await copyToClipboard(text, renderMarkdownWithRefs(text));
                      if (ok) markCopied(item.key);
                    }}
                    onRegenerate={() => void retryFromAssistant(m.id)}
                    onFeedback={(action: 'up' | 'down' | 'clear') => void setFeedback(m.id, action)}
                  />
                </div>
              </div>
        {/snippet}

        {#snippet renderTimelineRuntimeSegment(item: any)}
              <div class="flex justify-start">
                <div class="max-w-[85%] w-full">
                  <StreamMessage
                    variant="chat"
                    streamId={item.key}
                    status={item.message._localStatus ??
                      (item.message.content ? 'completed' : 'processing')}
                    subscriptionMode="passive"
                    initialEvents={item.segment.events}
                    runtimeSummary={item.segment.runtimeSummary}
                    initiallyExpanded={false}
                    deferCollapsedDetails={!useUnifiedActiveRunPresentation(item.message)}
                    requestDeferredDetails={sessionId ? (() => { const sid = sessionId; return sid ? loadRuntimeDetailsForMessage(sid, item.message.id) : Promise.resolve(); }) : undefined}
                    showRuntimeInlinePreview={item.isActiveRuntimeSegment}
                    acknowledgementText={item.acknowledgementText}
                    onTodoRuntime={handleTodoRuntimeToolResult}
                    onGeneratedFile={(card) => handleGeneratedFileCard(item.message.id, card)}
                  />
                </div>
              </div>
        {/snippet}

        {#snippet renderTimelineItems(items: ProjectedTimelineItem[])}
          <ChatTimelineWrapper
            {items}
            renderUserMessage={renderTimelineUserMessage}
            renderMessageAttachments={renderTimelineMessageAttachments}
            renderAssistantSegment={renderTimelineAssistantSegment}
            renderRuntimeSegment={renderTimelineRuntimeSegment}
          />
        {/snippet}

        {#if stagedHistoryTimelineItems.length > 0}
          <div
            class="pointer-events-none invisible absolute inset-x-0 top-0 z-[-1] p-3 space-y-2"
            bind:this={historyStageMeasureEl}
            aria-hidden="true"
          >
            {@render renderTimelineItems(stagedHistoryTimelineItems)}
          </div>
        {:else}
          <div
            class="pointer-events-none invisible absolute inset-x-0 top-0 z-[-1]"
            bind:this={historyStageMeasureEl}
            aria-hidden="true"
          ></div>
        {/if}

        {#if historyHydrationInFlight && projectedTimelineItems.length === 0}
          <div class="text-xs text-slate-500">{$_('common.loading')}</div>
        {:else if messages.length === 0}
          <div class="text-xs text-slate-500">{$_('chat.chat.empty')}</div>
        {:else}
          <div class:invisible={historyHydrationSwapPending}>
            {@render renderTimelineItems(projectedTimelineItems)}
          </div>
        {/if}
        {#if pendingLocalToolPermissionPrompts.length > 0}
          {#each pendingLocalToolPermissionPrompts as prompt (prompt.toolCallId)}
            <div class="rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
              <div class="text-xs font-semibold text-slate-700">
                {$_('chat.tools.permissions.promptTitle')}
              </div>
              <div class="text-[11px] text-slate-600">
                {$_('chat.tools.permissions.promptDescription', {
                  values: {
                    tool: prompt.request.toolName,
                  },
                })}
              </div>
              {#if resolvePermissionPromptDetails(prompt).length > 0}
                <div class="space-y-1">
                  {#each resolvePermissionPromptDetails(prompt) as detail}
                    <div class="text-[11px] text-slate-600 break-all">
                      <span class="font-semibold text-slate-700">{detail.label}:</span>
                      {' '}
                      {detail.value}
                    </div>
                  {/each}
                </div>
              {/if}
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="chat-tool-permission-choice rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90"
                  on:click={() =>
                    void handleLocalToolPermissionDecision(
                      prompt,
                      'allow_once',
                    )}
                >
                  {$_('chat.tools.permissions.allowOnce')}
                </button>
                <button
                  type="button"
                  class="chat-tool-permission-choice rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                  on:click={() =>
                    void handleLocalToolPermissionDecision(
                      prompt,
                      'deny_once',
                    )}
                >
                  {$_('chat.tools.permissions.denyOnce')}
                </button>
                <button
                  type="button"
                  class="chat-tool-permission-choice rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100"
                  on:click={() =>
                    void handleLocalToolPermissionDecision(
                      prompt,
                      'allow_always',
                    )}
                >
                  {$_('chat.tools.permissions.allowAlways')}
                </button>
                <button
                  type="button"
                  class="chat-tool-permission-choice rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:bg-red-100"
                  on:click={() =>
                    void handleLocalToolPermissionDecision(
                      prompt,
                      'deny_always',
                    )}
                >
                  {$_('chat.tools.permissions.denyAlways')}
                </button>
              </div>
            </div>
          {/each}
        {/if}
        {#if pendingCheckpointPrompt}
          <div class="rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
            <div class="text-xs font-semibold text-slate-700">
              {pendingCheckpointPrompt.kind === 'retry'
                ? $_('chat.checkpoints.confirmRestoreBeforeRetry')
                : $_('chat.checkpoints.confirmRestoreBeforeAction')}
            </div>
            <div class="text-[11px] text-slate-600">
              {$_('chat.checkpoints.confirmRestoreDetails')}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="chat-checkpoint-choice rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                on:click={() => void confirmCheckpointPrompt()}
                disabled={checkpointActionInFlight}
              >
                {$_('chat.checkpoints.restoreCta')}
              </button>
              <button
                type="button"
                class="chat-checkpoint-choice rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                on:click={() => void cancelCheckpointPrompt()}
                disabled={checkpointActionInFlight}
              >
                {pendingCheckpointPrompt.kind === 'retry'
                  ? $_('chat.checkpoints.retryWithoutRestore')
                  : $_('chat.checkpoints.continueWithoutRestore')}
              </button>
            </div>
          </div>
        {/if}
        {#if errorMsg}
          <div
            class="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2"
          >
            {errorMsg}
          </div>
        {/if}
      {/if}
    </div>
  </div>

  {#if mode === 'ai' && todoRuntimePanel}
    <div class="w-full border-t border-slate-200 bg-slate-50/70" data-testid="todo-runtime-panel">
      <div class="px-3 py-2">
        <div class="w-full flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-xs font-semibold text-slate-700">
              {$_('chat.todoRuntimePanel.title')}
            </div>
            <div class="text-[11px] text-slate-500 truncate">
              {todoRuntimePanel.title || $_('chat.todoRuntimePanel.subtitle')}
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button
              class="chat-danger-action-button text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
              type="button"
              disabled={todoRuntimeDeleteInFlight}
              on:click={() => (pendingTodoRuntimeDeleteConfirm = true)}
              aria-label={$_('chat.todoRuntimePanel.delete')}
              title={$_('chat.todoRuntimePanel.delete')}
              data-testid="todo-runtime-delete-button"
            >
              <Trash2 class="w-4 h-4" />
            </button>
            <button
              type="button"
              class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
              on:click={() => (todoRuntimeCollapsed = !todoRuntimeCollapsed)}
              aria-label={todoRuntimeCollapsed
                ? $_('chat.todoRuntimePanel.expand')
                : $_('chat.todoRuntimePanel.collapse')}
              title={todoRuntimeCollapsed
                ? $_('chat.todoRuntimePanel.expand')
                : $_('chat.todoRuntimePanel.collapse')}
              data-testid="todo-runtime-toggle-button"
            >
              <ChevronDown
                class={`w-4 h-4 transition-transform duration-150 ${
                  todoRuntimeCollapsed ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>
        </div>
        {#if !todoRuntimeCollapsed}
          <div class="mt-2 max-h-28 overflow-y-auto slim-scroll space-y-2 text-[11px] text-slate-700">
            {#if pendingTodoRuntimeDeleteConfirm}
              <div class="chat-delete-confirm-surface rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
                <div class="text-xs font-semibold text-slate-700">
                  {$_('chat.todoRuntimePanel.confirmDelete')}
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class="chat-delete-confirm-choice rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                    on:click={() => void handleDeleteTodoRuntime()}
                    disabled={todoRuntimeDeleteInFlight}
                  >
                    {$_('common.delete')}
                  </button>
                  <button
                    type="button"
                    class="chat-delete-confirm-choice rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    on:click={() => (pendingTodoRuntimeDeleteConfirm = false)}
                    disabled={todoRuntimeDeleteInFlight}
                  >
                    {$_('common.cancel')}
                  </button>
                </div>
              </div>
            {/if}
            {#if todoRuntimePanel.conflictMessage}
              <div class="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                {todoRuntimePanel.conflictMessage}
              </div>
            {/if}
            <div>
              <div class="font-medium">
                {$_('chat.todoRuntimePanel.tasksLabel')} ({todoRuntimePanel.tasks.length})
              </div>
              {#if todoRuntimePanel.tasks.length === 0}
                <div class="mt-1 text-[11px] text-slate-500">
                  {$_('chat.todoRuntimePanel.noTasks')}
                </div>
              {:else}
                <ul class="mt-1 space-y-1">
                  {#each todoRuntimePanel.tasks as task, index (task.id ?? `${todoRuntimePanel.todoId}-${index}`)}
                    {@const done = isRuntimeTaskDone(task.status)}
                    <li class="flex items-center gap-2">
                      <span
                        class={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] leading-none ${
                          done
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-slate-400 text-transparent'
                        }`}
                      >{done ? '✓' : ''}</span
                      >
                      <span
                        class={`truncate ${
                          done ? 'line-through text-slate-400' : 'text-slate-700'
                        }`}
                      >
                        {task.title}
                      </span>
                      <span class="sr-only">
                        {done
                          ? $_('chat.todoRuntimePanel.completedTaskLabel')
                          : $_('chat.todoRuntimePanel.pendingTaskLabel')}
                      </span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#snippet renderComposerSurface()}
          {#if mode === 'ai'}
            {#if sessionDocsError}
              <div
                class="mb-2 rounded bg-red-50 border border-red-200 px-2 py-1 text-[11px] text-red-700"
              >
                {sessionDocsError}
              </div>
            {/if}
            {#if googleDriveConnectionError}
              <div
                class="mb-2 rounded bg-red-50 border border-red-200 px-2 py-1 text-[11px] text-red-700"
              >
                {googleDriveConnectionError}
              </div>
            {/if}
            {#if attachmentBand.length > 0}
              <div
                class="mb-2 flex flex-wrap gap-2"
                data-testid="chat-composer-attachment-band"
              >
                {#each attachmentBand as item (item.key)}
                  {@const imageSrc =
                    item.kind === 'image' ? getBandItemImageSrc(item) : ''}
                  <div
                    class="flex h-14 min-w-0 max-w-[12rem] items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                  >
                    {#if item.kind === 'image' && imageSrc}
                      <button
                        type="button"
                        class="h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        aria-label={$_('chat.attachments.enlarge')}
                        title={$_('chat.attachments.enlarge')}
                        on:click={() => openLightbox(imageSrc, item.fileName)}
                      >
                        <img
                          src={imageSrc}
                          alt={item.fileName}
                          class="h-10 w-10 object-cover"
                        />
                      </button>
                    {:else}
                      <div
                        class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500"
                      >
                        {#if item.kind === 'image'}
                          <ImageIcon class="h-4 w-4" />
                        {:else}
                          <FileText class="h-4 w-4" />
                        {/if}
                      </div>
                    {/if}
                    <div class="min-w-0 flex-1">
                      <div class="truncate font-medium">{item.fileName}</div>
                      <div class="truncate text-slate-400">
                        {getBandItemStatusLabel(item)}
                      </div>
                    </div>
                    <button
                      class="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      type="button"
                      aria-label={$_('chat.documents.delete.ariaLabel')}
                      title={$_('common.delete')}
                      on:click={() => void removeBandItem(item)}
                    >
                      <X class="w-3 h-3" />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
            <EditableInput
              markdown={true}
              bind:value={input}
              placeholder={$_('chat.composer.placeholder.chat')}
              on:change={handleComposerChange}
            />
          {:else}
            {#if (commentThreadResolved || !$workspaceCanComment) && commentInput.trim().length === 0}
              <div
                class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400"
              >
                {commentPlaceholder}
              </div>
            {/if}
            {#if assignedToLabel}
              <div
                class="mb-2 inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
              >
                <span
                  >{$_('chat.comments.assignedTo', {
                    values: { label: assignedToLabel },
                  })}</span
                >
                <button
                  type="button"
                  class="rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200"
                  on:click={() => {
                    assignedToUserId = null;
                    assignedToLabel = null;
                  }}
                  aria-label={$_('chat.comments.unassign')}
                  title={$_('chat.comments.unassign')}
                >
                  <X class="w-3 h-3" />
                </button>
              </div>
            {/if}
            <EditableInput
              markdown={true}
              bind:value={commentInput}
              placeholder={commentPlaceholder}
              on:change={handleComposerChange}
              disabled={!$workspaceCanComment || commentThreadResolved}
            />
          {/if}
  {/snippet}

  {#snippet renderFloatingLayer()}
        {#if mode === 'comments' && showMentionMenu}
          <div
            class="absolute bottom-12 left-0 z-30 w-64 rounded-lg border border-slate-200 bg-white shadow-lg p-2"
            bind:this={mentionMenuRef}
          >
            {#if mentionLoading && mentionDelayElapsed}
              <div class="px-2 py-1 text-[11px] text-slate-500">
                {$_('common.loading')}
              </div>
            {:else if mentionError}
              <div class="px-2 py-1 text-[11px] text-red-600">
                {$_('chat.comments.mention.loadError')}
              </div>
            {:else if !mentionLoading && mentionMatches.length === 0}
              <div class="px-2 py-1 text-[11px] text-slate-500">
                {$_('chat.comments.mention.none')}
              </div>
            {:else}
              <div class="space-y-1 max-h-48 overflow-auto slim-scroll">
                {#each mentionMatches as member (member.userId)}
                  <button
                    class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50"
                    type="button"
                    on:click={() => selectMentionMember(member)}
                  >
                    <div class="font-medium text-slate-900 truncate">
                      {mentionLabelFor(member)}
                    </div>
                    {#if member.email}
                      <div class="text-[10px] text-slate-400 truncate">
                        {member.email}
                      </div>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
  {/snippet}

  {#snippet renderLeftControls()}
        {#if mode === 'ai'}
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
          <ModelSelector
            bind:value={selectedModelSelectionKey}
            groups={$ctrl.modelCatalogGroups as ModelCatalogGroup[]}
            models={$ctrl.modelCatalogModels as ModelCatalogModel[]}
            widthCh={selectedModelWidthCh}
            labels={$_}
            onChange={({ providerId, modelId }: { providerId: ModelProviderId; modelId: string }) => {
              ctrl.setModelSelection(providerId, modelId);
              selectedModelSelectionKey = `${providerId}::${modelId}`;
            }}
          />
        {/if}
  {/snippet}

  {#snippet renderRightActions()}
        {#if composerSteerReady && activeAssistantMessage}
          <button
            class="chat-composer-stop-button rounded text-slate-600 w-8 h-8 flex items-center justify-center hover:bg-slate-100 disabled:opacity-60"
            on:click={stopAssistantMessage}
            disabled={stoppingMessageId === activeAssistantMessage.id}
            type="button"
            aria-label="Stopper"
            title="Stopper"
          >
            <Square class="w-4 h-4 fill-current stroke-none" />
          </button>
        {/if}
        <button
          class="rounded bg-primary hover:bg-primary/90 text-white w-8 h-8 flex items-center justify-center disabled:opacity-60"
          on:click={handleComposerPrimaryAction}
          disabled={composerPrimaryActionState.disabled}
          type="button"
          aria-label={composerPrimaryButtonShowsSteer
            ? $_('chat.steer.submit')
            : $_('common.send')}
          title={composerPrimaryButtonShowsSteer
            ? $_('chat.steer.submit')
            : $_('common.send')}
          data-testid={composerPrimaryButtonShowsSteer
            ? 'chat-composer-steer-button'
            : 'chat-composer-send-button'}
        >
          {#if composerPrimaryButtonShowsSteer}
            <ShipWheel class="w-4 h-4" />
          {:else}
            <Send class="w-4 h-4" />
          {/if}
        </button>
  {/snippet}

  <ChatComposerWrapper
    mode={mode}
    value={mode === 'comments' ? commentInput : input}
    disabled={mode === 'comments' &&
      (!$workspaceCanComment || commentThreadResolved)}
    isMultiline={composerIsMultiline}
    maxHeight={composerMaxHeight}
    surfaceEnabled={($workspaceCanComment && !commentThreadResolved) ||
      mode !== 'comments'}
    surfaceDisabled={mode === 'comments' &&
      (!$workspaceCanComment || commentThreadResolved)}
    ariaLabel={$_('chat.composer.ariaLabel')}
    tabIndex={mode === 'comments' &&
    (!$workspaceCanComment || commentThreadResolved)
      ? -1
      : 0}
    bind:composerElement={composerEl}
    onKeyDown={handleKeyDown}
    onPaste={handleComposerPaste}
    {renderComposerSurface}
    {renderFloatingLayer}
    {renderLeftControls}
    {renderRightActions}
  />
</div>

<svelte:window on:keydown={handleLightboxKeydown} />

{#if lightboxImage}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    data-testid="chat-image-lightbox"
  >
    <button
      type="button"
      class="absolute inset-0 h-full w-full cursor-default"
      aria-label={$_('chat.attachments.lightbox.close')}
      on:click={closeLightbox}
    ></button>
    <div class="relative z-10 flex max-h-full max-w-full flex-col items-center gap-2">
      <div class="flex items-center gap-2 self-end">
        <a
          class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          href={lightboxImage.src}
          download={lightboxImage.alt}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={$_('chat.attachments.lightbox.download')}
          title={$_('chat.attachments.lightbox.download')}
        >
          <Download class="h-5 w-5" />
        </a>
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label={$_('chat.attachments.lightbox.close')}
          title={$_('chat.attachments.lightbox.close')}
          on:click={closeLightbox}
        >
          <X class="h-5 w-5" />
        </button>
      </div>
      <img
        src={lightboxImage.src}
        alt={lightboxImage.alt}
        class="max-h-[80vh] max-w-[90vw] rounded object-contain shadow-2xl"
      />
    </div>
  </div>
{/if}

<style>
  .composer-rich :global(.markdown-input-wrapper),
  .userMarkdown :global(.markdown-input-wrapper) {
    padding-left: 0;
    margin-left: 0;
    border-left: 0;
  }

  .composer-rich :global(.markdown-input-wrapper:hover),
  .userMarkdown :global(.markdown-input-wrapper:hover) {
    border-left-color: transparent;
    background-color: transparent;
  }

  .composer-rich :global(.markdown-wrapper) {
    max-height: 100%;
    overflow: hidden;
  }

  .composer-rich :global(.ProseMirror) {
    outline: none;
  }

  .composer-single-line :global(.ProseMirror) {
    line-height: 1.25rem;
  }

  .userMarkdown :global(.markdown-wrapper .text-slate-700),
  .userMarkdown :global(.markdown-wrapper .text-slate-700 *) {
    color: #fff;
  }
</style>
