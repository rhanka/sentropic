<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Readable } from 'svelte/store';
  import type { AppContext } from '$lib/core/context-provider';
  import { _, locale } from 'svelte-i18n';
  import {
    apiFetch,
    apiGet,
    apiPost,
    apiPatch,
    apiDelete,
    ApiError,
  } from '$lib/utils/api';
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
  import { Streamdown } from 'svelte-streamdown';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import MenuPopover from '$lib/components/MenuPopover.svelte';
  import { currentFolderId, foldersStore } from '$lib/stores/folders';
  import { organizationsStore } from '$lib/stores/organizations';
  import { initiativesStore } from '$lib/stores/initiatives';
  import { getScopedWorkspaceIdForUser, workspaceCanComment, selectedWorkspace, selectedWorkspaceRole, workspaceScopeHydrated } from '$lib/stores/workspaceScope';
  import { deleteDocument, listDocuments, uploadDocument, type ContextDocumentItem } from '$lib/utils/documents';
  import { streamHub, type StreamHubEvent } from '$lib/stores/streamHub';
  import {
    decideLocalToolPermission,
    executeLocalTool,
    getLocalToolDefinitions,
    isLocalToolName,
    isLocalToolRuntimeAvailable,
    LocalToolPermissionRequiredError,
    type LocalToolPermissionDecision,
    type LocalToolPermissionRequest,
    type LocalToolName,
  } from '$lib/stores/localTools';
  import {
    Send,
    ThumbsUp,
    ThumbsDown,
    Copy,
    Pencil,
    RotateCcw,
    UndoDot,
    Check,
    Paperclip,
    X,
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
    GitBranch
  } from '@lucide/svelte';
  import { renderMarkdownWithRefs } from '$lib/utils/markdown';
  import { postChatSteer } from '$lib/utils/chat-steer';
  import {
    filterPermissionPromptsForPendingStream,
    parsePendingLocalToolCallsFromStatusPayload,
    shouldResetLocalToolStateForFreshRound,
  } from '$lib/utils/localToolStreamSync';
  import {
    EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS,
    VSCODE_NEW_SESSION_ALLOWED_TOOL_IDS,
    computeEnabledToolIds,
    computeToolToggleDefaults,
    computeVisibleToolToggleIds,
    isExtensionRestrictedToolsetMode as computeIsExtensionRestrictedToolsetMode,
  } from '$lib/utils/chat-tool-scope';
  import {
    USER_AI_SETTINGS_UPDATED_EVENT,
    type UserAISettingsUpdatedPayload,
  } from '$lib/utils/user-ai-settings-events';
  import {
    getCheckpointMutationPreviewItems,
    hasCheckpointMutationDelta,
  } from '$lib/utils/checkpointDelta';
  import {
    appendLiveProjectionEvent,
    countLinkedSteerMessages,
    getLinkedSteerMessageIds,
    mergeProjectionHistoryEvents,
    projectAssistantRunSegments,
    type ProjectedRunSegment,
  } from '$lib/utils/chat-run-projection';

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
  };
  type ProjectedTimelineItem =
    | {
        kind: 'message';
        key: string;
        message: LocalMessage;
      }
    | {
        kind: 'assistant-segment';
        key: string;
        message: LocalMessage;
        streamId: string;
        segment: ProjectedRunSegment;
        isLastAssistantSegment: boolean;
        isTerminal: boolean;
      }
    | {
        kind: 'runtime-segment';
        key: string;
        message: LocalMessage;
        streamId: string;
        segment: ProjectedRunSegment & {
          runtimeSummary?: RuntimeSegmentSummary;
        };
        acknowledgementText?: string;
        isActiveRuntimeSegment: boolean;
      };
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
  type SessionHistorySnapshot = {
    sessionId: string;
    title: string | null;
    messages: LocalMessage[];
    timelineItems: ProjectedTimelineItem[];
    initialEvents: Map<string, StreamEvent[]>;
    runtimeSummaries: Map<string, RuntimeSegmentSummary>;
    checkpoints: ChatCheckpoint[];
    documents: ContextDocumentItem[];
    todoRuntime: Record<string, unknown> | null;
    lastAssistantModel: string | null;
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
  type ProjectedAssistantComputation = {
    signature: string;
    segments: ProjectedRunSegment[];
    linkedSteerCount: number;
  };
  type LocalToolStreamState = {
    streamId: string;
    name: LocalToolName;
    argsText: string;
    lastSequence: number;
    firstSeenAt: number;
    executed: boolean;
  };
  type LocalToolPermissionPrompt = {
    toolCallId: string;
    streamId: string;
    name: LocalToolName;
    args: unknown;
    request: LocalToolPermissionRequest;
    createdAt: number;
  };
  type IconComponent = typeof FileText;
  type ChatContextEntry = {
    contextType: 'organization' | 'folder' | 'initiative' | 'executive_summary';
    contextId?: string;
    label: string;
    active: boolean;
    used: boolean;
    lastUsedAt: number;
  };

  type ToolToggle = {
    id: string;
    label: string;
    description?: string;
    toolIds: string[];
    icon: IconComponent;
  };

  type ModelProviderId = 'openai' | 'gemini' | 'anthropic' | 'mistral' | 'cohere';
  type ModelCatalogProvider = {
    provider_id: ModelProviderId;
    label: string;
    status: 'ready' | 'planned';
  };
  type ModelCatalogModel = {
    provider_id: ModelProviderId;
    model_id: string;
    label: string;
    default_contexts: string[];
  };
  type ModelCatalogPayload = {
    providers: ModelCatalogProvider[];
    models: ModelCatalogModel[];
    defaults: {
      provider_id: ModelProviderId;
      model_id: string;
    };
  };
  type ModelCatalogGroup = {
    provider: ModelCatalogProvider;
    models: ModelCatalogModel[];
  };

  const getContextIcon = (type: ChatContextEntry['contextType']) => {
    if (type === 'organization') return Building2;
    if (type === 'folder') return Folder;
    if (type === 'initiative') return Lightbulb;
    if (type === 'executive_summary') return ScrollText;
    return FileText;
  };

  const contextNameByKey = new Map<string, string>();
  const contextNameLoading = new Set<string>();

  const getContextLabelFromStores = (
    type: ChatContextEntry['contextType'],
    contextId: string,
  ) => {
    if (!contextId) return '';
    if (type === 'organization') {
      const org = $organizationsStore.find((o) => o.id === contextId);
      return org?.name || '';
    }
    if (type === 'folder') {
      const folder = $foldersStore.find((f) => f.id === contextId);
      return folder?.name || '';
    }
    if (type === 'initiative') {
      const useCase = $initiativesStore.find((u) => u.id === contextId);
      return useCase?.data?.name || useCase?.name || '';
    }
    if (type === 'executive_summary') {
      const folder = $foldersStore.find((f) => f.id === contextId);
      return folder?.name
        ? $_('chat.context.executiveSummaryPrefix', {
            values: { name: folder.name },
          })
        : '';
    }
    return '';
  };

  const loadContextName = async (
    type: ChatContextEntry['contextType'],
    contextId: string,
  ) => {
    const key = `${type}:${contextId}`;
    if (!contextId || contextNameByKey.has(key) || contextNameLoading.has(key))
      return;
    contextNameLoading.add(key);
    try {
      if (type === 'organization') {
        const org = await apiGet<{ name?: string }>(
          `/organizations/${contextId}`,
        );
        if (org?.name) contextNameByKey.set(key, org.name);
      } else if (type === 'folder' || type === 'executive_summary') {
        const folder = await apiGet<{ name?: string }>(`/folders/${contextId}`);
        if (folder?.name) {
          contextNameByKey.set(
            key,
            type === 'executive_summary'
              ? $_('chat.context.executiveSummaryPrefix', {
                  values: { name: folder.name },
                })
              : folder.name,
          );
        }
      } else if (type === 'initiative') {
        const useCase = await apiGet<{
          data?: { name?: string };
          name?: string;
        }>(`/initiatives/${contextId}`);
        const name = useCase?.data?.name || useCase?.name;
        if (name) contextNameByKey.set(key, name);
      }
    } catch {
      // ignore
    } finally {
      contextNameLoading.delete(key);
    }
  };

  const refreshContextLabels = () => {
    contextEntries = contextEntries.map((c) => {
      const key = `${c.contextType}:${c.contextId}`;
      const fromStore = getContextLabelFromStores(
        c.contextType,
        c.contextId || '',
      );
      const cached = contextNameByKey.get(key) || '';
      const nextLabel = fromStore || cached || c.label;
      if (!nextLabel || nextLabel === c.contextId) {
        void loadContextName(c.contextType, c.contextId || '');
      }
      return { ...c, label: nextLabel };
    });
  };

  export let sessions: ChatSession[] = [];
  export let contextStore: Readable<AppContext>;
  export let sessionId: string | null = null;
  export let draft = '';
  export let loadingSessions = false;
  export let mode: 'ai' | 'comments' = 'ai';
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

  const SECTION_LABEL_KEYS: Record<string, Record<string, string>> = {
    usecase: {
      name: 'common.name',
      description: 'chat.sections.usecase.description',
      problem: 'chat.sections.usecase.problem',
      solution: 'chat.sections.usecase.solution',
      benefits: 'chat.sections.usecase.benefits',
      constraints: 'chat.sections.usecase.constraints',
      risks: 'chat.sections.usecase.risks',
      metrics: 'chat.sections.usecase.metrics',
      nextSteps: 'chat.sections.usecase.nextSteps',
      technologies: 'chat.sections.usecase.technologies',
      dataSources: 'chat.sections.usecase.dataSources',
      dataObjects: 'chat.sections.usecase.dataObjects',
      valueScores: 'chat.sections.usecase.valueScores',
      complexityScores: 'chat.sections.usecase.complexityScores',
      references: 'chat.sections.usecase.references',
      contact: 'chat.sections.usecase.contact',
      domain: 'chat.sections.usecase.domain',
      deadline: 'chat.sections.usecase.deadline',
    },
    organization: {
      name: 'common.name',
      industry: 'organization.fields.industry',
      size: 'chat.sections.organization.size',
      technologies: 'chat.sections.organization.technologies',
      products: 'chat.sections.organization.products',
      processes: 'chat.sections.organization.processes',
      kpis: 'chat.sections.organization.kpis',
      challenges: 'chat.sections.organization.challenges',
      objectives: 'chat.sections.organization.objectives',
      references: 'chat.sections.organization.references',
    },
    folder: {
      description: 'chat.sections.folder.description',
      name: 'chat.sections.folder.name',
    },
    executive_summary: {
      name: 'chat.sections.folder.name',
      introduction: 'chat.sections.executiveSummary.introduction',
      analyse: 'chat.sections.executiveSummary.analysis',
      analysis: 'chat.sections.executiveSummary.analysis',
      recommandation: 'chat.sections.executiveSummary.recommendations',
      recommendations: 'chat.sections.executiveSummary.recommendations',
      synthese_executive: 'chat.sections.executiveSummary.summary',
      synthese: 'chat.sections.executiveSummary.summary',
      summary: 'chat.sections.executiveSummary.summary',
      references: 'chat.sections.executiveSummary.references',
    },
  };

  const getCommentSectionLabel = (type: string | null, key: string | null) => {
    if (!type) return null;
    if (!key) return $_('common.general');
    const i18nKey = SECTION_LABEL_KEYS[type]?.[key];
    return i18nKey ? $_(i18nKey) : key;
  };

  const getInitials = (label: string) => {
    const parts = label.trim().split(/\s+/);
    const initials = parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
    return initials || '?';
  };

  const commentAuthorLabel = (comment: CommentItem) =>
    comment.created_by_user?.displayName ||
    comment.created_by_user?.email ||
    comment.created_by;

  const mentionLabelFor = (member: MentionMember) =>
    member.displayName || member.email || member.userId;

  const isCommentByCurrentUser = (comment: CommentItem) => {
    const user = $session.user;
    if (!user) return false;
    if (comment.created_by === user.id) return true;
    if (comment.created_by === user.email) return true;
    if (comment.created_by_user?.id === user.id) return true;
    if (user.email && comment.created_by_user?.email === user.email)
      return true;
    return false;
  };

  const isAiComment = (comment: CommentItem) => Boolean(comment.tool_call_id);

  const getMentionCandidate = (text: string) => {
    if (!text) return null;
    if (/\s$/.test(text)) return null;
    const match = /(^|[\s([{])@([^\s@]{0,32})$/.exec(text);
    if (!match) return null;
    const start = (match.index ?? 0) + match[1].length;
    return { start, end: text.length, query: match[2] ?? '' };
  };

  const getMentionMatches = (query: string) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return mentionMembers.slice(0, 6);
    return mentionMembers
      .filter((m) => mentionLabelFor(m).toLowerCase().includes(needle))
      .slice(0, 6);
  };

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

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

  const formatCommentTimestamp = (value: string | null | undefined) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    if (isSameDay(date, now)) return timeFormatter.format(date);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(date, yesterday))
      return `${$_('common.yesterday')} ${timeFormatter.format(date)}`;
    return `${dateFormatter.format(date)} ${timeFormatter.format(date)}`;
  };

  const findAssignedUserFromText = (text: string) => {
    if (!text || mentionMembers.length === 0) return null;
    const haystack = text.toLowerCase();
    let best: { member: MentionMember; index: number } | null = null;
    for (const member of mentionMembers) {
      const label = mentionLabelFor(member).toLowerCase();
      const idx = haystack.lastIndexOf(`@${label}`);
      if (idx >= 0 && (!best || idx > best.index)) {
        best = { member, index: idx };
      }
    }
    return best?.member ?? null;
  };

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

  const buildCommentThreads = (items: CommentItem[]) => {
    const threads = new Map<string, CommentItem[]>();
    for (const item of items) {
      const threadId = item.thread_id;
      if (!threadId) continue;
      const current = threads.get(threadId) ?? [];
      current.push(item);
      threads.set(threadId, current);
    }
    for (const [threadId, threadItems] of threads.entries()) {
      threads.set(
        threadId,
        threadItems.sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
      );
    }
    const nextThreads = Array.from(threads.entries()).map(
      ([threadId, threadItems]) => {
        const last = threadItems[threadItems.length - 1];
        const root = threadItems[0] ?? null;
        const lastAt = last?.created_at ?? '';
        return {
          id: threadId,
          sectionKey: last?.section_key || null,
          count: threadItems.length,
          lastAt,
          preview: last?.content ?? '',
          authorLabel: last ? commentAuthorLabel(last) : '',
          status: (root?.status ?? 'open') as 'open' | 'closed',
          assignedTo: root?.assigned_to ?? null,
          rootId: root?.id ?? threadId,
          createdBy: root?.created_by ?? '',
        };
      },
    );
    nextThreads.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    return { threads: nextThreads, map: threads };
  };

  let messages: LocalMessage[] = [];
  let loadingMessages = false;
  let sending = false;
  let stoppingMessageId: string | null = null;
  let errorMsg: string | null = null;
  let lastShownErrorMsg: string | null = null;
  let modelCatalogProviders: ModelCatalogProvider[] = [];
  let modelCatalogModels: ModelCatalogModel[] = [];
  let modelCatalogGroups: ModelCatalogGroup[] = [];
  let selectedProviderId: ModelProviderId = 'openai';
  let selectedModelId = 'gpt-4.1-nano';
  let defaultProviderIdForNewSession: ModelProviderId = 'openai';
  let defaultModelIdForNewSession = 'gpt-4.1-nano';
  let selectedModelSelectionKey = 'openai::gpt-4.1-nano';
  let pendingTodoRuntimeDeleteConfirm = false;
  let input = draft;
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
  let projectedTimelineItems: ProjectedTimelineItem[] = [];
  let historyTimelineItems: ProjectedTimelineItem[] = [];
  let stagedHistoryTimelineItems: ProjectedTimelineItem[] = [];
  let historyHydrationInFlight = false;
  let historyHydrationSwapPending = false;
  let historyHydrationStickBottom = false;
  let optimisticSteerMessages: LocalMessage[] = [];
  let previousAiWorkspaceId: string | null | undefined = undefined;
  let workspaceSessionRescopeInFlight = false;

  const getMessageStatus = (m: LocalMessage) =>
    m._localStatus ?? (m.content ? 'completed' : 'processing');
  let activeAssistantMessage: LocalMessage | null = null;
  let composerSteerStreamId: string | null = null;
  let composerSteerReady = false;
  let composerRunInFlight = false;
  const isAssistantMessageInProgress = (message: LocalMessage): boolean => {
    if (message.role !== 'assistant') return false;
    if (message._localStatus === 'processing') return true;
    if (!message._localStatus && !message.content) return true;
    return false;
  };
  $: activeAssistantMessage =
    [...messages].reverse().find((m) => isAssistantMessageInProgress(m)) ?? null;
  $: {
    projectionEventsVersion;
    initialEventsByMessageId;
    composerSteerAck;
    optimisticSteerMessages;
    projectedTimelineItems = buildProjectedTimeline(messages);
  }
  $: composerSteerStreamId = activeAssistantMessage
    ? (activeAssistantMessage._streamId ?? activeAssistantMessage.id ?? null)
    : null;
  $: composerSteerReady =
    typeof composerSteerStreamId === 'string' &&
    composerSteerStreamId.trim().length > 0;
  $: composerRunInFlight = sending || composerSteerReady;

  const hasAssistantContent = (message: LocalMessage): boolean =>
    typeof message.content === 'string' && message.content.trim().length > 0;

  const getLocalToolEligibleStreamIds = () =>
    new Set(
      messages
        .filter((message) => {
          if (message.role !== 'assistant') return false;
          const status = getMessageStatus(message);
          if (status === 'failed') return false;
          if (status === 'processing') return true;
          return !hasAssistantContent(message);
        })
        .map((message) => message._streamId ?? message.id),
    );

  const isKnownAssistantStream = (streamId: string): boolean =>
    messages.some(
      (message) =>
        message.role === 'assistant' &&
        (message._streamId ?? message.id) === streamId &&
        getMessageStatus(message) !== 'failed',
    );

  const clearLocalToolStateForStream = (streamId: string) => {
    for (const [toolCallId, state] of localToolStatesById.entries()) {
      if (state.streamId !== streamId) continue;
      const timerId = localToolExecutionTimersById.get(toolCallId);
      if (timerId) clearTimeout(timerId);
      localToolExecutionTimersById.delete(toolCallId);
      localToolStatesById.delete(toolCallId);
      localToolInFlight.delete(toolCallId);
      localToolPermissionRetriesInFlight.delete(toolCallId);
    }
    pendingLocalToolPermissionPrompts = pendingLocalToolPermissionPrompts.filter(
      (prompt) => prompt.streamId !== streamId,
    );
  };

  const resetLocalToolInterceptionState = () => {
    localToolExecutionTimersById.forEach((timerId) => clearTimeout(timerId));
    localToolExecutionTimersById.clear();
    localToolStatesById.clear();
    localToolInFlight.clear();
    localToolPermissionRetriesInFlight.clear();
    pendingLocalToolPermissionPrompts = [];
  };

  const parseBufferedToolArgs = (
    rawArgs: string,
  ): { ready: boolean; value: unknown } => {
    const trimmed = rawArgs.trim();
    if (!trimmed) return { ready: true, value: {} };
    try {
      return {
        ready: true,
        value: JSON.parse(trimmed),
      };
    } catch {
      return {
        ready: false,
        value: null,
      };
    }
  };

  const postLocalToolResultWithRetry = async (
    streamId: string,
    toolCallId: string,
    result: unknown,
  ) => {
    const maxAttempts = 12;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await apiPost(
          `/chat/messages/${encodeURIComponent(streamId)}/tool-results`,
          { toolCallId, result },
        );
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

  const hasPendingPermissionPromptForStream = (
    streamId: string,
    exceptToolCallId?: string,
  ): boolean =>
    pendingLocalToolPermissionPrompts.some(
      (item) =>
        item.streamId === streamId &&
        (!exceptToolCallId || item.toolCallId !== exceptToolCallId),
    );

  const hasInFlightToolForStream = (
    streamId: string,
    exceptToolCallId?: string,
  ): boolean => {
    for (const inFlightToolCallId of localToolInFlight) {
      if (exceptToolCallId && inFlightToolCallId === exceptToolCallId) continue;
      const state = localToolStatesById.get(inFlightToolCallId);
      if (!state) continue;
      if (state.streamId === streamId) return true;
    }
    return false;
  };

  const getNextPendingToolCallIdForStream = (
    streamId: string,
  ): string | null => {
    const pending = Array.from(localToolStatesById.entries())
      .filter(([_, state]) => state.streamId === streamId && !state.executed)
      .sort(([, a], [, b]) => {
        if (a.firstSeenAt !== b.firstSeenAt) {
          return a.firstSeenAt - b.firstSeenAt;
        }
        return a.lastSequence - b.lastSequence;
      });
    return pending[0]?.[0] ?? null;
  };

  const scheduleNextToolForStream = (streamId: string, delayMs = 80) => {
    const nextToolCallId = getNextPendingToolCallIdForStream(streamId);
    if (!nextToolCallId) return;
    scheduleBufferedLocalToolExecution(nextToolCallId, delayMs);
  };

  const tryExecuteBufferedLocalTool = async (toolCallId: string) => {
    const localToolState = localToolStatesById.get(toolCallId);
    if (!localToolState || localToolState.executed) return;
    if (localToolInFlight.has(toolCallId)) return;
    if (!isLocalToolRuntimeAvailable()) return;
    const firstPendingToolCallId = getNextPendingToolCallIdForStream(
      localToolState.streamId,
    );
    if (firstPendingToolCallId && firstPendingToolCallId !== toolCallId) return;
    if (hasPendingPermissionPromptForStream(localToolState.streamId, toolCallId))
      return;
    if (hasInFlightToolForStream(localToolState.streamId, toolCallId)) return;

    if (!localToolState.argsText.trim() && localToolState.name === 'tab_type') {
      const elapsed = Date.now() - localToolState.firstSeenAt;
      if (elapsed < 1500) {
        scheduleBufferedLocalToolExecution(toolCallId, 200);
        return;
      }
      localToolState.executed = true;
      localToolStatesById.set(toolCallId, localToolState);
      try {
        await postLocalToolResultWithRetry(localToolState.streamId, toolCallId, {
          status: 'error',
          error:
            'tab_type arguments are missing (expected at least text, and optionally selector/x/y).',
        });
      } catch (forwardError) {
        const reason =
          forwardError instanceof Error
            ? forwardError.message
            : String(forwardError);
        console.warn(
          `Failed to forward missing-args error for ${localToolState.name} (${toolCallId}): ${reason}`,
        );
      }
      scheduleNextToolForStream(localToolState.streamId);
      return;
    }

    const parsed = parseBufferedToolArgs(localToolState.argsText);
    if (!parsed.ready) {
      scheduleBufferedLocalToolExecution(toolCallId, 120);
      return;
    }

    localToolState.executed = true;
    localToolStatesById.set(toolCallId, localToolState);
    localToolInFlight.add(toolCallId);

    try {
      const localResult = await executeLocalTool(
        toolCallId,
        localToolState.name,
        parsed.value,
        { streamId: localToolState.streamId },
      );
      await postLocalToolResultWithRetry(
        localToolState.streamId,
        toolCallId,
        localResult,
      );
    } catch (error) {
      if (error instanceof LocalToolPermissionRequiredError) {
        const prompt: LocalToolPermissionPrompt = {
          toolCallId,
          streamId: localToolState.streamId,
          name: localToolState.name,
          args: parsed.value,
          request: error.request,
          createdAt: Date.now(),
        };
        const next = pendingLocalToolPermissionPrompts.filter(
          (item) => item.toolCallId !== toolCallId,
        );
        pendingLocalToolPermissionPrompts = [...next, prompt];
        return;
      }

      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `Failed to execute local tool ${localToolState.name} (${toolCallId}): ${reason}`,
      );
      try {
        await postLocalToolResultWithRetry(
          localToolState.streamId,
          toolCallId,
          { status: 'error', error: reason },
        );
      } catch (forwardError) {
        const forwardReason =
          forwardError instanceof Error
            ? forwardError.message
            : String(forwardError);
        console.warn(
          `Failed to forward local tool error for ${localToolState.name} (${toolCallId}): ${forwardReason}`,
        );
      }
    } finally {
      localToolInFlight.delete(toolCallId);
      scheduleNextToolForStream(localToolState.streamId);
    }
  };

  const handleLocalToolPermissionDecision = async (
    prompt: LocalToolPermissionPrompt,
    decision: LocalToolPermissionDecision,
  ) => {
    if (localToolPermissionRetriesInFlight.has(prompt.toolCallId)) return;
    localToolPermissionRetriesInFlight.add(prompt.toolCallId);
    try {
      await decideLocalToolPermission(prompt.request.requestId, decision);
      pendingLocalToolPermissionPrompts = pendingLocalToolPermissionPrompts.filter(
        (item) => item.toolCallId !== prompt.toolCallId,
      );

      if (decision === 'deny_once' || decision === 'deny_always') {
        await postLocalToolResultWithRetry(prompt.streamId, prompt.toolCallId, {
          status: 'error',
          error: `Permission denied for ${prompt.request.toolName} on ${prompt.request.origin}.`,
        });
        return;
      }

      const localResult = await executeLocalTool(
        prompt.toolCallId,
        prompt.name,
        prompt.args,
        { streamId: prompt.streamId },
      );
      await postLocalToolResultWithRetry(
        prompt.streamId,
        prompt.toolCallId,
        localResult,
      );
    } catch (error) {
      if (error instanceof LocalToolPermissionRequiredError) {
        const nextPrompt: LocalToolPermissionPrompt = {
          ...prompt,
          request: error.request,
          createdAt: Date.now(),
        };
        pendingLocalToolPermissionPrompts = [
          ...pendingLocalToolPermissionPrompts.filter(
            (item) => item.toolCallId !== prompt.toolCallId,
          ),
          nextPrompt,
        ];
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      try {
        await postLocalToolResultWithRetry(prompt.streamId, prompt.toolCallId, {
          status: 'error',
          error: reason,
        });
      } catch (forwardError) {
        const forwardReason =
          forwardError instanceof Error
            ? forwardError.message
            : String(forwardError);
        console.warn(
          `Failed to forward permission decision error for ${prompt.name} (${prompt.toolCallId}): ${forwardReason}`,
        );
      }
    } finally {
      localToolPermissionRetriesInFlight.delete(prompt.toolCallId);
      scheduleNextToolForStream(prompt.streamId);
    }
  };

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

  const scheduleBufferedLocalToolExecution = (
    toolCallId: string,
    delayMs = 120,
  ) => {
    const existingTimer = localToolExecutionTimersById.get(toolCallId);
    if (existingTimer) clearTimeout(existingTimer);
    const timerId = setTimeout(() => {
      localToolExecutionTimersById.delete(toolCallId);
      void tryExecuteBufferedLocalTool(toolCallId);
    }, delayMs);
    localToolExecutionTimersById.set(toolCallId, timerId);
  };

  const handleLocalToolCallStart = (event: StreamHubEvent) => {
    const streamId = String((event as any)?.streamId ?? '').trim();
    const toolCallId = String((event as any)?.data?.tool_call_id ?? '').trim();
    const toolNameRaw = String((event as any)?.data?.name ?? '').trim();
    const argsChunk =
      typeof (event as any)?.data?.args === 'string'
        ? (event as any).data.args
        : '';
    const sequenceRaw = Number((event as any)?.sequence);
    const sequence = Number.isFinite(sequenceRaw) ? sequenceRaw : 0;

    if (!streamId || !toolCallId || !isLocalToolName(toolNameRaw)) return;

    const previous = localToolStatesById.get(toolCallId);
    if (previous && sequence <= previous.lastSequence) return;
    const isFreshRound = shouldResetLocalToolStateForFreshRound(
      previous,
      sequence,
    );

    localToolStatesById.set(toolCallId, {
      streamId,
      name: toolNameRaw,
      argsText:
        previous && !isFreshRound
          ? `${previous.argsText}${argsChunk}`
          : argsChunk,
      lastSequence: sequence,
      firstSeenAt: previous?.firstSeenAt ?? Date.now(),
      executed: isFreshRound ? false : (previous?.executed ?? false),
    });
    scheduleBufferedLocalToolExecution(toolCallId);
  };

  const handleLocalToolCallDelta = (event: StreamHubEvent) => {
    const toolCallId = String((event as any)?.data?.tool_call_id ?? '').trim();
    if (!toolCallId) return;
    const previous = localToolStatesById.get(toolCallId);
    if (!previous) return;

    const sequenceRaw = Number((event as any)?.sequence);
    const sequence = Number.isFinite(sequenceRaw) ? sequenceRaw : previous.lastSequence;
    if (sequence <= previous.lastSequence) return;

    const deltaChunk =
      typeof (event as any)?.data?.delta === 'string'
        ? (event as any).data.delta
        : '';
    localToolStatesById.set(toolCallId, {
      ...previous,
      argsText: `${previous.argsText}${deltaChunk}`,
      lastSequence: sequence,
    });
    scheduleBufferedLocalToolExecution(toolCallId);
  };

  const handleLocalToolStatusEvent = (event: StreamHubEvent) => {
    const streamId = String((event as any)?.streamId ?? '').trim();
    if (!streamId || !isKnownAssistantStream(streamId)) return;

    const data = (event as any)?.data;
    const state = String(data?.state ?? '').trim();
    const sequenceRaw = Number((event as any)?.sequence);
    const sequence = Number.isFinite(sequenceRaw) ? sequenceRaw : 0;

    if (state === 'awaiting_local_tool_results') {
      const pendingCalls = parsePendingLocalToolCallsFromStatusPayload(
        streamId,
        sequence,
        data,
        isLocalToolName,
      );
      const pendingToolCallIds = new Set(
        pendingCalls.map((call) => call.toolCallId),
      );
      pendingLocalToolPermissionPrompts = filterPermissionPromptsForPendingStream(
        pendingLocalToolPermissionPrompts,
        streamId,
        pendingToolCallIds,
      );

      for (const call of pendingCalls) {
        const previous = localToolStatesById.get(call.toolCallId);
        const isFreshRound = shouldResetLocalToolStateForFreshRound(
          previous,
          sequence,
        );
        localToolStatesById.set(call.toolCallId, {
          streamId,
          name: call.name as LocalToolName,
          argsText:
            previous &&
            !isFreshRound &&
            previous.argsText.trim().length > 0
              ? previous.argsText
              : call.argsText,
          lastSequence: Math.max(previous?.lastSequence ?? 0, call.sequence),
          firstSeenAt: previous?.firstSeenAt ?? Date.now(),
          executed: isFreshRound ? false : (previous?.executed ?? false),
        });
      }

      scheduleNextToolForStream(streamId, 0);
      return;
    }

    if (state === 'local_tool_result_received') {
      const toolCallId = String(data?.tool_call_id ?? '').trim();
      if (!toolCallId) return;
      const timerId = localToolExecutionTimersById.get(toolCallId);
      if (timerId) clearTimeout(timerId);
      localToolExecutionTimersById.delete(toolCallId);
      pendingLocalToolPermissionPrompts = pendingLocalToolPermissionPrompts.filter(
        (prompt) => prompt.toolCallId !== toolCallId,
      );
      localToolStatesById.delete(toolCallId);
      localToolInFlight.delete(toolCallId);
      localToolPermissionRetriesInFlight.delete(toolCallId);
      return;
    }

    if (state === 'response_created') {
      pendingLocalToolPermissionPrompts = pendingLocalToolPermissionPrompts.filter(
        (prompt) => prompt.streamId !== streamId,
      );
    }
  };

  const handleLocalToolStreamEvent = (event: StreamHubEvent) => {
    const streamId = String((event as any)?.streamId ?? '').trim();
    if (!streamId) return;

    if (event.type === 'status') {
      handleLocalToolStatusEvent(event);
      return;
    }

    if (event.type === 'done' || event.type === 'error') {
      clearLocalToolStateForStream(streamId);
      return;
    }

    if (event.type !== 'tool_call_start' && event.type !== 'tool_call_delta')
      return;
    if (!isLocalToolRuntimeAvailable()) return;

    const localToolEligibleStreamIds = getLocalToolEligibleStreamIds();
    if (!localToolEligibleStreamIds.has(streamId)) return;

    if (event.type === 'tool_call_start') {
      handleLocalToolCallStart(event);
      return;
    }
    handleLocalToolCallDelta(event);
  };

  const handleProjectionStreamEvent = (event: StreamHubEvent) => {
    const streamId = String((event as any)?.streamId ?? '').trim();
    if (!streamId || !isTrackedAssistantStreamId(streamId)) return;
    const sequence = Number((event as any)?.sequence);
    if (!Number.isFinite(sequence)) return;
    appendProjectedLiveEvent(streamId, {
      eventType: String((event as any)?.type ?? '').trim(),
      data: (event as any)?.data ?? {},
      sequence,
      createdAt: undefined,
    });
    if (event.type === 'done' || event.type === 'error') {
      void handleAssistantTerminal(streamId, event.type);
    }
    scheduleScrollToBottom();
  };

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
  let sessionCheckpoints: ChatCheckpoint[] = [];
  let checkpointsByAnchorMessageId = new Map<string, ChatCheckpoint>();
  let checkpointActionInFlight = false;
  let pendingCheckpointPrompt: PendingCheckpointPrompt | null = null;
  let sessionDocsKey = '';
  let sessionDocsSseKey = '';
  let sessionTitlesSseKey = '';
  let sessionDocsReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let showComposerMenu = false;
  let composerMenuButtonRef: HTMLButtonElement | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleDocumentClick: ((_: MouseEvent) => void) | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleUserAISettingsUpdated: ((_: Event) => void) | null = null;
  let contextEntries: ChatContextEntry[] = [];
  let sortedContexts: ChatContextEntry[] = [];
  let toolEnabledById: Record<string, boolean> = {};
  let extensionRestrictedToolset = false;
  let prefsKey = '';
  let lastRouteContextKey: string | null = null;

  // Historique batch (Option C): messageId -> events
  let initialEventsByMessageId = new Map<string, StreamEvent[]>();
  let runtimeSummaryByMessageId = new Map<string, RuntimeSegmentSummary>();
  let projectedStreamEventsById = new Map<string, StreamEvent[]>();
  let projectedAssistantComputationByMessageId = new Map<
    string,
    ProjectedAssistantComputation
  >();
  let projectionEventsVersion = 0;
  const loadedRuntimeDetailsMessageIds = new Set<string>();
  const loadingRuntimeDetailsMessageIds = new Set<string>();
  let historyTimelineSessionId: string | null = null;
  let todoRuntimePanel: TodoRuntimePanelState | null = null;
  let todoRuntimeCollapsed = false;
  let todoRuntimeDeleteInFlight = false;
  let composerSteerInFlight = false;
  let composerSteerAck: ComposerSteerAck | null = null;
  const jobPollInFlight = new Set<string>();
  let localToolsHubKey = '';
  const localToolStatesById = new Map<string, LocalToolStreamState>();
  const localToolInFlight = new Set<string>();
  const localToolExecutionTimersById = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  let pendingLocalToolPermissionPrompts: LocalToolPermissionPrompt[] = [];
  const localToolPermissionRetriesInFlight = new Set<string>();
  let extensionActiveTabContext: {
    tabId: number;
    url: string;
    origin: string;
    title: string | null;
  } | null = null;
  let projectionHubKey = '';

  const isTrackedAssistantStreamId = (streamId: string): boolean =>
    messages.some(
      (message) =>
        message.role === 'assistant' && (message._streamId ?? message.id) === streamId,
    );

  const mergeProjectedHistoryForStream = (
    streamId: string,
    events: readonly StreamEvent[],
  ) => {
    if (!streamId) return;
    projectedStreamEventsById = new Map(projectedStreamEventsById);
    projectedStreamEventsById.set(
      streamId,
      mergeProjectionHistoryEvents(
        projectedStreamEventsById.get(streamId) ?? [],
        events,
      ),
    );
    projectionEventsVersion += 1;
  };

  const appendProjectedLiveEvent = (streamId: string, event: StreamEvent) => {
    if (!streamId) return;
    projectedStreamEventsById = new Map(projectedStreamEventsById);
    projectedStreamEventsById.set(
      streamId,
      appendLiveProjectionEvent(
        projectedStreamEventsById.get(streamId) ?? [],
        event,
      ),
    );
    projectionEventsVersion += 1;
  };

  const getProjectionEventsForMessage = (message: LocalMessage): StreamEvent[] => {
    const streamId = message._streamId ?? message.id;
    const projected = projectedStreamEventsById.get(streamId);
    if (projected && projected.length > 0) return projected;
    const hydrated = initialEventsByMessageId.get(streamId);
    if (hydrated && hydrated.length > 0) return hydrated;
    return [];
  };

  const buildProjectedAssistantSignature = (
    message: LocalMessage,
    events: readonly StreamEvent[],
  ): string => {
    const lastSequence =
      events.length > 0
        ? Number(events[events.length - 1]?.sequence ?? 0)
        : 0;
    return [
      message._streamId ?? message.id,
      message._localStatus ?? '',
      message.content ? message.content.length : 0,
      events.length,
      Number.isFinite(lastSequence) ? lastSequence : 0,
    ].join(':');
  };

  const getProjectedAssistantComputation = (
    message: LocalMessage,
  ): ProjectedAssistantComputation => {
    const messageId = String(message.id ?? '').trim();
    const projectionEvents = getProjectionEventsForMessage(message);
    const signature = buildProjectedAssistantSignature(message, projectionEvents);
    const cached = projectedAssistantComputationByMessageId.get(messageId);
    if (cached?.signature === signature) return cached;

    const segments = projectAssistantRunSegments(projectionEvents);
    const next = {
      signature,
      segments,
      linkedSteerCount: countLinkedSteerMessages(projectionEvents),
    };
    projectedAssistantComputationByMessageId = new Map(
      projectedAssistantComputationByMessageId,
    );
    projectedAssistantComputationByMessageId.set(messageId, next);
    return next;
  };

  const buildFallbackProjectedSegments = (
    message: LocalMessage,
  ): ProjectedRunSegment[] => {
    if (typeof message.content === 'string' && message.content.trim().length > 0) {
      return [
        {
          id: `assistant:fallback:${message.id}`,
          kind: 'assistant',
          events: [],
          content: message.content,
          steerCountBefore: 0,
        },
      ];
    }
    if (message._localStatus === 'processing') {
      return [
        {
          id: `runtime:fallback:${message.id}`,
          kind: 'runtime',
          events: [
            {
              eventType: 'status',
              sequence: 1,
              data: { state: 'started' },
            },
          ],
          content: '',
          steerCountBefore: 0,
        },
      ];
    }
    return [];
  };

  const loadRuntimeDetailsForMessage = async (
    targetSessionId: string,
    messageId: string,
  ): Promise<void> => {
    if (loadedRuntimeDetailsMessageIds.has(messageId)) return;
    if (loadingRuntimeDetailsMessageIds.has(messageId)) return;
    loadingRuntimeDetailsMessageIds.add(messageId);
    try {
      const response = await apiFetch(
        `/chat/sessions/${targetSessionId}/history?runtimeDetails=full`,
        {
          method: 'GET',
          headers: { Accept: 'application/x-ndjson' },
        },
      );
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
        initialEventsByMessageId = new Map(initialEventsByMessageId);
        initialEventsByMessageId.set(
          messageId,
          mergeProjectionHistoryEvents(
            initialEventsByMessageId.get(messageId) ?? [],
            collectedEvents,
          ),
        );
        projectedAssistantComputationByMessageId = new Map(
          projectedAssistantComputationByMessageId,
        );
        projectedAssistantComputationByMessageId.delete(messageId);
        projectionEventsVersion += 1;
      }
      loadedRuntimeDetailsMessageIds.add(messageId);
    } finally {
      loadingRuntimeDetailsMessageIds.delete(messageId);
    }
  };

  const buildProjectedTimeline = (
    timeline: readonly LocalMessage[],
  ): ProjectedTimelineItem[] => {
    const steerIdsByAssistantId = new Map<string, string[]>();
    const optimisticSteersByAssistantId = new Map<string, LocalMessage[]>();
    const skippedSteerIds = new Set<string>();

    for (const steerMessage of optimisticSteerMessages) {
      const assistantId = String(
        steerMessage._optimisticSteerTargetAssistantId ?? '',
      ).trim();
      if (!assistantId) continue;
      const existing = optimisticSteersByAssistantId.get(assistantId) ?? [];
      existing.push(steerMessage);
      optimisticSteersByAssistantId.set(assistantId, existing);
    }

    for (let index = 0; index < timeline.length; index += 1) {
      const message = timeline[index];
      if (message.role !== 'assistant') continue;
      if ((optimisticSteersByAssistantId.get(message.id)?.length ?? 0) > 0) {
        continue;
      }
      const assistantProjection = getProjectedAssistantComputation(message);
      const segments = assistantProjection.segments;
      const linkedSteerCount = assistantProjection.linkedSteerCount;
      if (linkedSteerCount <= 0) continue;
      const firstRuntimeSegmentWithSteer = segments.findIndex(
        (segment) => segment.kind === 'runtime' && segment.steerCountBefore > 0,
      );
      const hasAssistantVisibleBeforeSteer =
        firstRuntimeSegmentWithSteer > 0 &&
        segments
          .slice(0, firstRuntimeSegmentWithSteer)
          .some((segment) => segment.kind === 'assistant');
      if (!hasAssistantVisibleBeforeSteer) continue;
      const linkedIds = getLinkedSteerMessageIds(timeline, index, linkedSteerCount);
      if (linkedIds.length === 0) continue;
      steerIdsByAssistantId.set(message.id, linkedIds);
      for (const linkedId of linkedIds) skippedSteerIds.add(linkedId);
    }

    const projected: ProjectedTimelineItem[] = [];

    for (const message of timeline) {
      if (skippedSteerIds.has(message.id)) continue;
      if (message.role !== 'assistant') {
        projected.push({
          kind: 'message',
          key: `message:${message.id}`,
          message,
        });
        continue;
      }

      const streamId = message._streamId ?? message.id;
      const assistantProjection = getProjectedAssistantComputation(message);
      const projectedSegments = assistantProjection.segments;
      const baseSegments =
        projectedSegments.length > 0
          ? projectedSegments
          : buildFallbackProjectedSegments(message);
      const hasRuntimeSegmentAlready = baseSegments.some((s) => s.kind === 'runtime');
      const storedSummary = runtimeSummaryByMessageId.get(message.id);
      const segments =
        !hasRuntimeSegmentAlready && storedSummary
          ? [
              {
                id: `runtime:history-summary:${message.id}`,
                kind: 'runtime' as const,
                events: [] as StreamEvent[],
                content: '',
                steerCountBefore: 0,
                runtimeSummary: storedSummary,
              },
              ...baseSegments,
            ]
          : baseSegments;
      const linkedSteers = (steerIdsByAssistantId.get(message.id) ?? [])
        .map((steerId) => timeline.find((entry) => entry.id === steerId) ?? null)
        .filter((entry): entry is LocalMessage => entry !== null);
      const optimisticSteers = optimisticSteersByAssistantId.get(message.id) ?? [];
      const combinedSteers = [...linkedSteers, ...optimisticSteers].sort(
        (left, right) =>
          Number(left._optimisticSteerSubmittedAtMs ?? 0) -
          Number(right._optimisticSteerSubmittedAtMs ?? 0),
      );

      const assistantIndexes = segments
        .map((segment, index) => (segment.kind === 'assistant' ? index : -1))
        .filter((index) => index >= 0);
      const lastAssistantIndex =
        assistantIndexes.length > 0
          ? assistantIndexes[assistantIndexes.length - 1]
          : -1;
      const lastRuntimeIndex = (() => {
        for (let index = segments.length - 1; index >= 0; index -= 1) {
          if (segments[index]?.kind === 'runtime') return index;
        }
        return -1;
      })();
      const isTerminal =
        (message._localStatus ?? (message.content ? 'completed' : 'processing')) ===
        'completed';
      let steerCursor = 0;

      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (!segment) continue;

        if (segment.kind === 'runtime') {
          let steerCountToInsert = segment.steerCountBefore;
          if (
            steerCountToInsert === 0 &&
            index === lastRuntimeIndex &&
            !isTerminal &&
            steerCursor < combinedSteers.length
          ) {
            steerCountToInsert = combinedSteers.length - steerCursor;
          }
          if (steerCountToInsert > 0) {
            const nextSteers = combinedSteers.slice(
              steerCursor,
              steerCursor + steerCountToInsert,
            );
            steerCursor += nextSteers.length;
            for (const steerMessage of nextSteers) {
              projected.push({
                kind: 'message',
                key: `message:${steerMessage.id}`,
                message: steerMessage,
              });
            }
          }

          projected.push({
            kind: 'runtime-segment',
            key: `${message.id}:${segment.id}`,
            message,
            streamId,
            segment,
            isActiveRuntimeSegment: !isTerminal && index === segments.length - 1,
            acknowledgementText:
              composerSteerAck?.streamId === streamId && index === lastRuntimeIndex
                ? composerSteerAck.message
                : undefined,
          });
          continue;
        }

        projected.push({
          kind: 'assistant-segment',
          key: `${message.id}:${segment.id}`,
          message,
          streamId,
          segment,
          isLastAssistantSegment: index === lastAssistantIndex,
          isTerminal,
        });
      }

      if (steerCursor < combinedSteers.length) {
        for (const steerMessage of combinedSteers.slice(steerCursor)) {
          projected.push({
            kind: 'message',
            key: `message:${steerMessage.id}`,
            message: steerMessage,
          });
        }
      }
    }

    return projected;
  };

  let lastDraftApplied = draft;
  $: if (draft !== lastDraftApplied && draft !== input) {
    input = draft;
    lastDraftApplied = draft;
  }
  const syncDraftFromInput = () => {
    if (draft === input) return;
    draft = input;
    lastDraftApplied = input;
  };
  $: if (mode === 'ai') {
    syncDraftFromInput();
  }

  /**
   * Détecte le contexte depuis la route actuelle
   * Retourne { primaryContextType, primaryContextId? } ou null si pas de contexte
   */
  const detectContextFromRoute = (): {
    primaryContextType: string;
    primaryContextId?: string;
  } | null => {
    const routeId = $contextStore.route.id;
    const params = $contextStore.params;

    // /initiative/[id] → initiative
    if (routeId === '/initiative/[id]' && params.id) {
      return { primaryContextType: 'initiative', primaryContextId: params.id };
    }

    // /initiative → initiative list; when a folder is selected, treat chat context as folder
    if (routeId === '/initiative' && $currentFolderId) {
      return {
        primaryContextType: 'folder',
        primaryContextId: $currentFolderId,
      };
    }

    // /dashboard → dashboard is folder-scoped when a folder is selected
    if (routeId === '/dashboard' && $currentFolderId) {
      return {
        primaryContextType: 'folder',
        primaryContextId: $currentFolderId,
      };
    }

    // /matrix → matrix view is folder-scoped when a folder is selected
    if (routeId === '/matrix' && $currentFolderId) {
      return {
        primaryContextType: 'folder',
        primaryContextId: $currentFolderId,
      };
    }

    // /folders/[id] → folder
    if (routeId === '/folders/[id]' && params.id) {
      return { primaryContextType: 'folder', primaryContextId: params.id };
    }

    // /organizations/[id] → organization
    if (routeId === '/organizations/[id]' && params.id) {
      return {
        primaryContextType: 'organization',
        primaryContextId: params.id,
      };
    }

    // /organizations → organizations list (organization scope without a specific id)
    if (routeId === '/organizations') {
      return { primaryContextType: 'organization' };
    }

    // /folders → folders list (folder scope without a specific id)
    if (routeId === '/folders') {
      return { primaryContextType: 'folder' };
    }

    // Pas de contexte détecté
    return null;
  };

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
    if (runtimeId === 'topai.vscode.runtime') return 'vscode';
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

  const getPrefsKey = (id: string | null) =>
    `chat_session_prefs:${id || 'new'}`;

  const loadPrefs = (id: string | null) => {
    if (typeof localStorage === 'undefined') return;
    const key = getPrefsKey(id);
    prefsKey = key;
    const hasExtensionRuntime = isLocalToolRuntimeAvailable();
    extensionRestrictedToolset = mode === 'ai' && hasExtensionRuntime;
    try {
      if (id && !localStorage.getItem(key)) {
        const draft = localStorage.getItem(getPrefsKey(null));
        if (draft) {
          localStorage.setItem(key, draft);
        }
      }
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        contexts?: ChatContextEntry[];
        toolEnabledById?: Record<string, boolean>;
        extensionRestrictedToolset?: boolean;
      };
      if (Array.isArray(parsed.contexts)) {
        contextEntries = parsed.contexts
          .filter((c) => !!c.contextType)
          .map((c) => ({
            ...c,
            // Migrate stale "usecase" context type to "initiative"
            contextType: c.contextType === ('usecase' as any) ? 'initiative' : c.contextType,
            used: typeof c.used === 'boolean' ? c.used : true,
          }));
      }
      if (
        parsed.toolEnabledById &&
        typeof parsed.toolEnabledById === 'object'
      ) {
        toolEnabledById = parsed.toolEnabledById;
      }
      if (typeof parsed.extensionRestrictedToolset === 'boolean') {
        extensionRestrictedToolset = hasExtensionRuntime
          ? true
          : parsed.extensionRestrictedToolset;
      }
    } catch {
      // ignore
    }
  };

  const savePrefs = () => {
    if (!prefsKey || typeof localStorage === 'undefined') return;
    const payload = {
      contexts: contextEntries,
      toolEnabledById,
      extensionRestrictedToolset,
    };
    try {
      localStorage.setItem(prefsKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
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
      savePrefs();
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
      savePrefs();
    }
  };

  const updateContextFromRoute = () => {
    const context = detectContextFromRoute();
    const contextId = context?.primaryContextId || '';
    const contextType = (context?.primaryContextType || null) as
      | ChatContextEntry['contextType']
      | null;
    const routeKey =
      contextType && contextId ? `${contextType}:${contextId}` : null;
    if (lastRouteContextKey && lastRouteContextKey !== routeKey) {
      contextEntries = contextEntries.filter(
        (c) =>
          !(
            c.contextType + ':' + c.contextId === lastRouteContextKey && !c.used
          ),
      );
      savePrefs();
    }
    lastRouteContextKey = routeKey;
    if (!contextType || !contextId) return;
    const label =
      getContextLabelFromStores(contextType, contextId) ||
      contextNameByKey.get(`${contextType}:${contextId}`) ||
      contextId;
    const now = Date.now();
    const idx = contextEntries.findIndex(
      (c) => c.contextType === contextType && c.contextId === contextId,
    );
    if (idx === -1) {
      contextEntries = [
        {
          contextType,
          contextId,
          label,
          active: true,
          used: false,
          lastUsedAt: now,
        },
        ...contextEntries,
      ];
    } else {
      const next = [...contextEntries];
      const current = next[idx];
      next[idx] = { ...current, label, active: true };
      contextEntries = next;
    }
    if (label === contextId) {
      void loadContextName(contextType, contextId);
    }
    savePrefs();
  };

  const markCurrentContextUsed = () => {
    const context = detectContextFromRoute();
    if (!context?.primaryContextType || !context.primaryContextId) return;
    const contextType =
      context.primaryContextType as ChatContextEntry['contextType'];
    const contextId = context.primaryContextId;
    const label =
      getContextLabelFromStores(contextType, contextId) ||
      contextNameByKey.get(`${contextType}:${contextId}`) ||
      contextId;
    const now = Date.now();
    const idx = contextEntries.findIndex(
      (c) => c.contextType === contextType && c.contextId === contextId,
    );
    if (idx === -1) {
      contextEntries = [
        {
          contextType,
          contextId,
          label,
          active: true,
          used: true,
          lastUsedAt: now,
        },
        ...contextEntries,
      ];
    } else {
      const next = [...contextEntries];
      const current = next[idx];
      next[idx] = {
        ...current,
        label,
        active: true,
        used: true,
        lastUsedAt: now,
      };
      contextEntries = next;
    }
    if (label === contextId) {
      void loadContextName(contextType, contextId);
    }
    savePrefs();
  };

  $: sortedContexts = [...contextEntries];

  const getActiveContexts = () =>
    contextEntries
      .filter((c) => c.active && c.used)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);

  const getEnabledToolIds = () => {
    return computeEnabledToolIds({
      toolToggles: getToolScopeToggles(),
      toolEnabledById,
      restrictedMode: isExtensionRestrictedToolsetMode(),
      allowedToolIds: getRestrictedAllowedToolIds(),
    });
  };

  const toggleContextActive = (entry: ChatContextEntry) => {
    const now = Date.now();
    contextEntries = contextEntries.map((c) =>
      c.contextType === entry.contextType && c.contextId === entry.contextId
        ? {
            ...c,
            active: !c.active,
            lastUsedAt: !c.active ? now : c.lastUsedAt,
          }
        : c,
    );
    savePrefs();
  };

  const toggleTool = (id: string) => {
    const isEnabled = toolEnabledById[id] !== false;
    toolEnabledById = { ...toolEnabledById, [id]: !isEnabled };
    savePrefs();
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
    const containerHeight = panelEl?.clientHeight ?? 0;
    const maxHeight = Math.max(
      COMPOSER_BASE_HEIGHT,
      Math.floor(containerHeight * 0.3),
    );
    composerMaxHeight = maxHeight;
    const contentHeight = composerEl.scrollHeight || COMPOSER_BASE_HEIGHT;
    const wasMultiline = composerIsMultiline;
    composerIsMultiline = contentHeight > COMPOSER_BASE_HEIGHT + 2;
    if (composerIsMultiline !== wasMultiline) {
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

  const sessionDocStatusLabel = (s: string) => {
    if (s === 'uploaded') return $_('chat.documents.status.uploaded');
    if (s === 'processing') return $_('chat.documents.status.processing');
    if (s === 'ready') return $_('chat.documents.status.ready');
    if (s === 'failed') return $_('chat.documents.status.failed');
    return $_('chat.documents.status.unknown');
  };

  const loadSessionDocs = async () => {
    if (!sessionId) return;
    sessionDocsError = null;
    try {
      const scopedWs = getScopedWorkspaceIdForUser();
      const res = await listDocuments({
        contextType: 'chat_session',
        contextId: sessionId,
        workspaceId: scopedWs,
      });
      sessionDocs = res.items ?? [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sessionDocsError = msg;
    }
  };

  const onPickSessionDoc = async (e: Event) => {
    const inputEl = e.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    showComposerMenu = false;

    sessionDocsUploading = true;
    sessionDocsError = null;
    try {
      if (!sessionId) {
        const context = detectContextFromRoute();
        const res = await apiPost<{ sessionId: string }>('/chat/sessions', {
          primaryContextType: context?.primaryContextType,
          primaryContextId: context?.primaryContextId,
        });
        sessionId = res.sessionId;
        await loadSessions();
        await loadMessages(res.sessionId, { scrollToBottom: true });
      }
      const scopedWs = getScopedWorkspaceIdForUser();
      await uploadDocument({
        contextType: 'chat_session',
        contextId: sessionId!,
        file,
        workspaceId: scopedWs,
      });
      await loadSessionDocs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sessionDocsError = msg;
    } finally {
      sessionDocsUploading = false;
    }
  };

  const removeSessionDoc = async (doc: ContextDocumentItem) => {
    try {
      const scopedWs = getScopedWorkspaceIdForUser();
      await deleteDocument({ documentId: doc.id, workspaceId: scopedWs });
      sessionDocs = sessionDocs.filter((d) => d.id !== doc.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sessionDocsError = msg;
    }
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
      await apiPatch(`/chat/messages/${encodeURIComponent(messageId)}`, {
        content: next,
      });
      messages = messages.map((m) =>
        m.id === messageId ? { ...m, content: next } : m,
      );
      cancelEditMessage();
      await retryMessage(messageId);
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.editMessage'));
    }
  };

  const bootstrapAssistantRun = (input: {
    sessionId: string;
    assistantMessageId: string;
    streamId: string;
    jobId: string;
    model: string;
    userMessage?: LocalMessage;
    truncateAfterMessageId?: string;
    checkpointUserMessageId?: string;
  }) => {
    const nowIso = new Date().toISOString();
    const assistantMsg: LocalMessage = {
      id: input.assistantMessageId,
      sessionId: input.sessionId,
      role: 'assistant',
      content: null,
      model: input.model,
      createdAt: nowIso,
      _localStatus: 'processing',
      _streamId: input.streamId,
    };
    if (input.userMessage) {
      messages = [...messages, input.userMessage, assistantMsg];
    } else if (input.truncateAfterMessageId) {
      const userIndex = messages.findIndex(
        (m) => m.id === input.truncateAfterMessageId,
      );
      messages =
        userIndex >= 0
          ? [...messages.slice(0, userIndex + 1), assistantMsg]
          : [...messages, assistantMsg];
      const truncatedHistory: ProjectedTimelineItem[] = [];
      const keptHistoryMessageIds = new Set<string>();
      for (const item of historyTimelineItems) {
        truncatedHistory.push(item);
        keptHistoryMessageIds.add(String(item.message.id ?? '').trim());
        if (
          item.kind === 'message' &&
          String(item.message.id ?? '').trim() === input.truncateAfterMessageId
        ) {
          break;
        }
      }
      historyTimelineItems = truncatedHistory;
      initialEventsByMessageId = new Map(
        [...initialEventsByMessageId].filter(([messageId]) =>
          keptHistoryMessageIds.has(messageId),
        ),
      );
    } else {
      messages = [...messages, assistantMsg];
    }
    followBottom = true;
    scheduleScrollToBottom({ force: true });
    if (input.checkpointUserMessageId) {
      void createTurnCheckpoint(input.sessionId, input.checkpointUserMessageId);
    }
    void pollJobUntilTerminal(input.jobId, assistantMsg._streamId ?? assistantMsg.id, {
      timeoutMs: 90_000,
    });
  };

  const retryMessage = async (messageId: string) => {
    if (!sessionId) return;
    errorMsg = null;
    try {
      const res = await apiPost<{
        sessionId: string;
        userMessageId: string;
        assistantMessageId: string;
        streamId: string;
        jobId: string;
      }>(`/chat/messages/${encodeURIComponent(messageId)}/retry`, {
        providerId: selectedProviderId,
        model: selectedModelId,
      });
      bootstrapAssistantRun({
        sessionId: res.sessionId,
        assistantMessageId: res.assistantMessageId,
        streamId: res.streamId,
        jobId: res.jobId,
        model: selectedModelId,
        truncateAfterMessageId: messageId,
      });
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.retry'));
    }
  };

  const getCheckpointForUserMessage = (
    userMessageId: string,
  ): ChatCheckpoint | null => {
    const id = String(userMessageId ?? '').trim();
    if (!id) return null;
    return checkpointsByAnchorMessageId.get(id) ?? null;
  };

  const hasCheckpointRollbackDelta = (
    checkpoint: ChatCheckpoint | null | undefined,
  ): boolean => {
    return hasCheckpointMutationDelta(
      checkpoint,
      messages,
      initialEventsByMessageId,
    );
  };

  const getCheckpointPreviewTitle = (userMessageId: string): string => {
    const checkpoint = getCheckpointForUserMessage(userMessageId);
    const baseTitle = $_('chat.checkpoints.restoreFromMessage');
    if (!checkpoint) return baseTitle;
    const previewItems = getCheckpointMutationPreviewItems(
      checkpoint,
      messages,
      initialEventsByMessageId,
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
      await apiPost(
        `/chat/sessions/${sessionId}/checkpoints/${checkpoint.id}/restore`,
        {},
      );
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

  const formatApiError = (e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      const base =
        typeof e.message === 'string' ? e.message : String(e.message);
      if (e.status) return `HTTP ${e.status}: ${base}`;
      return base;
    }
    return fallback;
  };

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
    composerSteerAck = null;
    pendingTodoRuntimeDeleteConfirm = false;
  };

  const getActiveAssistantStreamId = (): string | null => {
    return composerSteerStreamId;
  };

  const handleComposerPrimaryAction = () => {
    if (mode === 'comments') {
      void sendCommentMessage();
      return;
    }
    if (composerRunInFlight) {
      if (composerSteerReady) void sendComposerSteer();
      return;
    }
    void sendMessage();
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
    composerSteerAck = {
      streamId: targetStreamId,
      message: $_('chat.steer.acknowledgement'),
      createdAtMs: Date.now(),
    };

    const nowIso = new Date().toISOString();
    const localSteerMessage: LocalMessage = {
      id: `local_steer_${Date.now()}`,
      sessionId: sessionId ?? '',
      role: 'user',
      content: steerText,
      createdAt: nowIso,
      _localStatus: 'completed',
      _optimisticSteerTargetAssistantId:
        activeAssistantMessage?.id ?? targetStreamId,
      _optimisticSteerSubmittedAtMs: Date.now(),
    };
    optimisticSteerMessages = [...optimisticSteerMessages, localSteerMessage];
    followBottom = true;
    scheduleScrollToBottom({ force: true });
    input = '';
    composerIsMultiline = false;
    updateComposerHeight();

    try {
      await postChatSteer(apiPost, targetStreamId, steerText);
    } catch (e) {
      optimisticSteerMessages = optimisticSteerMessages.filter(
        (message) => message.id !== localSteerMessage.id,
      );
      errorMsg = formatApiError(e, $_('chat.steer.error'));
    } finally {
      composerSteerInFlight = false;
      const expectedAck = composerSteerAck?.createdAtMs;
      setTimeout(() => {
        if (composerSteerAck?.createdAtMs === expectedAck) {
          composerSteerAck = null;
        }
      }, 5000);
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
    const map = new Map<string, ChatCheckpoint>();
    for (const checkpoint of sessionCheckpoints) {
      const anchorId = String(checkpoint.anchorMessageId ?? '').trim();
      if (!anchorId || map.has(anchorId)) continue;
      map.set(anchorId, checkpoint);
    }
    checkpointsByAnchorMessageId = map;
  };

  const mergeInitialEventsForMessage = (
    messageId: string,
    events: readonly StreamEvent[],
  ) => {
    const normalizedId = String(messageId ?? '').trim();
    if (!normalizedId || events.length === 0) return;
    const next = new Map(initialEventsByMessageId);
    next.set(
      normalizedId,
      mergeProjectionHistoryEvents(next.get(normalizedId) ?? [], events),
    );
    initialEventsByMessageId = next;
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

  const fetchSessionHistorySnapshot = async (
    id: string,
  ): Promise<SessionHistorySnapshot> => {
    const response = await apiFetch(
      `/chat/sessions/${id}/history?runtimeDetails=summary`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/x-ndjson',
        },
      },
    );
    if (!response.body) {
      throw new Error('Session history stream returned an empty body');
    }

    const snapshot: SessionHistorySnapshot = {
      sessionId: id,
      title: null,
      messages: [],
      timelineItems: [],
      initialEvents: new Map(),
      runtimeSummaries: new Map(),
      checkpoints: [],
      documents: [],
      todoRuntime: null,
      lastAssistantModel: null,
    };
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';

    const processLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line) return;
      const payload = JSON.parse(line) as
        | SessionHistoryMetaLine
        | SessionHistoryTimelineLine;
      if (payload.type === 'session_meta') {
        snapshot.sessionId = payload.sessionId;
        snapshot.title =
          typeof payload.title === 'string' && payload.title.trim().length > 0
            ? payload.title
            : null;
        snapshot.checkpoints = Array.isArray(payload.checkpoints)
          ? payload.checkpoints
          : [];
        snapshot.documents = Array.isArray(payload.documents)
          ? payload.documents
          : [];
        snapshot.todoRuntime = asRuntimeRecord(payload.todoRuntime);
        return;
      }

      const item = payload.item;
      const normalizedMessage: LocalMessage = {
        ...item.message,
        _streamId: item.message._streamId ?? item.message.id,
        _localStatus:
          item.message._localStatus ??
          (item.message.content ? 'completed' : undefined),
      };
      const existingMessageIndex = snapshot.messages.findIndex(
        (entry) => entry.id === normalizedMessage.id,
      );
      if (existingMessageIndex >= 0) {
        snapshot.messages[existingMessageIndex] = {
          ...snapshot.messages[existingMessageIndex],
          ...normalizedMessage,
        };
      } else {
        const sequence = Number(normalizedMessage.sequence ?? 0);
        let insertAt = snapshot.messages.length;
        while (
          insertAt > 0 &&
          Number(snapshot.messages[insertAt - 1]?.sequence ?? 0) > sequence
        ) {
          insertAt -= 1;
        }
        snapshot.messages.splice(insertAt, 0, normalizedMessage);
      }
      if (item.kind === 'assistant-segment' || item.kind === 'runtime-segment') {
        snapshot.initialEvents.set(
          item.message.id,
          mergeProjectionHistoryEvents(
            snapshot.initialEvents.get(item.message.id) ?? [],
            item.segment.events,
          ),
        );
      }
      if (
        item.kind === 'runtime-segment' &&
        item.segment.runtimeSummary &&
        (item.segment.runtimeSummary.hasReasoning || item.segment.runtimeSummary.hasTools)
      ) {
        snapshot.runtimeSummaries.set(item.message.id, item.segment.runtimeSummary);
      }
      const existingTimelineIndex = snapshot.timelineItems.findIndex(
        (entry) => entry.key === item.key,
      );
      if (existingTimelineIndex >= 0) {
        snapshot.timelineItems[existingTimelineIndex] = item;
      } else {
        snapshot.timelineItems.push(item);
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

    snapshot.timelineItems.sort(compareTimelineItems);
    snapshot.lastAssistantModel =
      [...snapshot.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && Boolean(message.model))
        ?.model ?? null;
    return snapshot;
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

    const nextMessages = [...messages];
    const nextInitialEvents = new Map(initialEventsByMessageId);
    const nextHistory = [...historyTimelineItems];
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
        nextInitialEvents.set(
          item.message.id,
          mergeProjectionHistoryEvents(
            nextInitialEvents.get(item.message.id) ?? [],
            item.segment.events,
          ),
        );
      }
      if (
        item.kind === 'runtime-segment' &&
        item.segment.runtimeSummary &&
        (item.segment.runtimeSummary.hasReasoning || item.segment.runtimeSummary.hasTools)
      ) {
        runtimeSummaryByMessageId = new Map(runtimeSummaryByMessageId);
        runtimeSummaryByMessageId.set(item.message.id, item.segment.runtimeSummary);
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

    messages = nextMessages;
    initialEventsByMessageId = nextInitialEvents;
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
      const res = await apiGet<{ checkpoints?: ChatCheckpoint[] }>(
        `/chat/sessions/${id}/checkpoints?limit=20`,
      );
      applySessionCheckpoints(
        Array.isArray(res.checkpoints) ? res.checkpoints : [],
      );
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
      await apiPost(`/chat/sessions/${targetSessionId}/checkpoints`, {
        anchorMessageId,
      });
      await loadCheckpoints(targetSessionId);
    } catch {
      // checkpoint creation is best-effort and must not block chat flow
    }
  };

  const loadSessions = async () => {
    loadingSessions = true;
    errorMsg = null;
    try {
      const res = await apiGet<{ sessions: ChatSession[] }>('/chat/sessions');
      sessions = res.sessions ?? [];
      // If the current sessionId is stale (e.g. from a different workspace), clear it
      if (sessionId && !sessions.some((s) => s.id === sessionId) && messages.length === 0) {
        sessionId = null;
        messages = [];
      }
      if (!sessionId && sessions.length > 0) {
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
        messages = [];
        optimisticSteerMessages = [];
        historyTimelineItems = [];
        stagedHistoryTimelineItems = [];
        historyTimelineSessionId = null;
        projectedStreamEventsById = new Map();
        projectedAssistantComputationByMessageId = new Map();
        projectionEventsVersion += 1;
        initialEventsByMessageId = new Map();
        runtimeSummaryByMessageId = new Map();
        loadedRuntimeDetailsMessageIds.clear();
        loadingRuntimeDetailsMessageIds.clear();
        applySessionCheckpoints([]);
        sessionDocs = [];
        sessionDocsError = null;
        resetTodoRuntimePanel();
      }
      const response = await apiFetch(
        `/chat/sessions/${id}/history?runtimeDetails=summary`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/x-ndjson',
          },
        },
      );
      if (!response.body) {
        throw new Error('Session history stream returned an empty body');
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';

      const processLine = async (rawLine: string) => {
        const line = rawLine.trim();
        if (!line) return;
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
      if (stagedHistoryTimelineItems.length > 0) {
        await applyHistoryTimelineBlock(stagedHistoryTimelineItems);
      }
      messages = messages.filter((message) => serverMessageIds.has(message.id));
      historyTimelineItems = historyTimelineItems.filter((item) =>
        serverTimelineKeys.has(item.key),
      );
      initialEventsByMessageId = new Map(
        [...initialEventsByMessageId].filter(([messageId]) =>
          serverEventMessageIds.has(messageId),
        ),
      );
      historyHydrationStickBottom = false;
      historyHydrationInFlight = false;

      const lastAssistantModel = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && Boolean(m.model))?.model;
      if (lastAssistantModel) {
        const fromCatalog = modelCatalogModels.find(
          (entry) => entry.model_id === lastAssistantModel,
        );
        if (fromCatalog) {
          selectedProviderId = fromCatalog.provider_id;
          selectedModelId = fromCatalog.model_id;
        }
      }
      if (opts?.scrollToBottom !== false) {
        scheduleScrollToBottom({ force: true });
      }
      // Le scroll est exécuté via afterUpdate (une fois le DOM réellement rendu).
    } catch (e) {
      historyHydrationInFlight = false;
      historyHydrationSwapPending = false;
      historyHydrationStickBottom = false;
      errorMsg = formatApiError(e, $_('chat.errors.loadMessages'));
    } finally {
      if (!historyHydrationInFlight) historyHydrationStickBottom = false;
      if (shouldShowLoader) loadingMessages = false;
    }
  };

  export const selectSession = async (id: string) => {
    const snapshot = await fetchSessionHistorySnapshot(id);
    historyHydrationInFlight = true;
    historyHydrationSwapPending = true;
    historyHydrationStickBottom = true;
    optimisticSteerMessages = [];
    projectedStreamEventsById = new Map();
    projectedAssistantComputationByMessageId = new Map();
    projectionEventsVersion += 1;
    loadedRuntimeDetailsMessageIds.clear();
    loadingRuntimeDetailsMessageIds.clear();
    resetLocalToolInterceptionState();
    messages = snapshot.messages;
    historyTimelineItems = snapshot.timelineItems;
    stagedHistoryTimelineItems = [];
    historyTimelineSessionId = snapshot.sessionId;
    initialEventsByMessageId = snapshot.initialEvents;
    runtimeSummaryByMessageId = snapshot.runtimeSummaries;
    applySessionCheckpoints(snapshot.checkpoints);
    sessionDocs = snapshot.documents;
    sessionDocsError = null;
    if (snapshot.todoRuntime) {
      handleTodoRuntimeToolResult({
        toolCallId: `session-runtime:${snapshot.sessionId}`,
        toolName: 'plan',
        result: { todoRuntime: snapshot.todoRuntime },
      });
    } else {
      resetTodoRuntimePanel();
    }
    if (snapshot.title) {
      sessions = sessions.map((entry) =>
        entry.id === snapshot.sessionId
          ? { ...entry, title: snapshot.title }
          : entry,
      );
    }
    if (snapshot.lastAssistantModel) {
      const fromCatalog = modelCatalogModels.find(
        (entry) => entry.model_id === snapshot.lastAssistantModel,
      );
      if (fromCatalog) {
        selectedProviderId = fromCatalog.provider_id;
        selectedModelId = fromCatalog.model_id;
      }
    }
    sessionId = id;
    await yieldHistoryRenderFrame();
    if (listEl) {
      listEl.scrollTop = listEl.scrollHeight;
      await yieldHistoryRenderFrame();
    }
    historyHydrationSwapPending = false;
    historyHydrationInFlight = false;
    historyHydrationStickBottom = false;
  };

  export const refreshCommentThreads = async () => {
    await loadCommentThreads({ silent: true });
    if (commentThreadId && commentItemsByThread.has(commentThreadId)) {
      commentMessages = commentItemsByThread.get(commentThreadId) ?? [];
    }
  };

  export const newSession = () => {
    sessionId = null;
    messages = [];
    historyTimelineItems = [];
    stagedHistoryTimelineItems = [];
    historyTimelineSessionId = null;
    sessionCheckpoints = [];
    sessionDocs = [];
    sessionDocsError = null;
    initialEventsByMessageId = new Map();
    runtimeSummaryByMessageId = new Map();
    loadedRuntimeDetailsMessageIds.clear();
    loadingRuntimeDetailsMessageIds.clear();
    projectedAssistantComputationByMessageId = new Map();
    optimisticSteerMessages = [];
    resetTodoRuntimePanel();
    resetLocalToolInterceptionState();
    selectedProviderId = defaultProviderIdForNewSession;
    selectedModelId = defaultModelIdForNewSession;
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
      await apiDelete(`/chat/sessions/${sessionId}`);
      sessionId = null;
      messages = [];
      historyTimelineItems = [];
      stagedHistoryTimelineItems = [];
      historyTimelineSessionId = null;
      sessionDocs = [];
      sessionDocsError = null;
      initialEventsByMessageId = new Map();
      projectedAssistantComputationByMessageId = new Map();
      optimisticSteerMessages = [];
      resetTodoRuntimePanel();
      resetLocalToolInterceptionState();
      await loadSessions();
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.deleteSession'));
    }
  };

  const handleAssistantTerminal = (
    streamId: string,
    t: 'done' | 'error',
  ) => {
    messages = messages.map((m) =>
      (m._streamId ?? m.id) === streamId
        ? { ...m, _localStatus: t === 'done' ? 'completed' : 'failed' }
        : m,
    );
    scheduleScrollToBottom({ force: true });
  };

  const pollJobUntilTerminal = async (
    jobId: string,
    streamId: string,
    opts?: { timeoutMs?: number },
  ) => {
    if (!jobId || !streamId) return;
    if (jobPollInFlight.has(jobId)) return;
    jobPollInFlight.add(jobId);
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const startedAt = Date.now();
    try {
      // Petit délai: si SSE marche, on évite de poller tout de suite
      await new Promise((r) => setTimeout(r, 750));

      while (Date.now() - startedAt < timeoutMs) {
        // Si entre-temps le message a été hydraté (contenu final) ou marqué terminal, on stop
        const current = messages.find(
          (m) => (m._streamId ?? m.id) === streamId,
        );
        if (!current) return;
        if (current.content && current.content.trim().length > 0) return;
        if (
          current._localStatus === 'completed' ||
          current._localStatus === 'failed'
        )
          return;

        // Queue: endpoint user-scopé
        const job = await apiGet<{ status?: string }>(
          `/queue/jobs/${encodeURIComponent(jobId)}`,
        );
        const status = String((job as any)?.status ?? 'unknown');

        if (status === 'completed') {
          handleAssistantTerminal(streamId, 'done');
          return;
        }
        if (status === 'failed') {
          handleAssistantTerminal(streamId, 'error');
          return;
        }
        // pending/processing
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch {
      // ignore (fallback best-effort)
    } finally {
      jobPollInFlight.delete(jobId);
    }
  };

  const loadModelCatalog = async () => {
    try {
      const payload = await apiGet<ModelCatalogPayload>('/models/catalog');
      modelCatalogProviders = Array.isArray(payload.providers)
        ? payload.providers
        : [];
      modelCatalogModels = Array.isArray(payload.models) ? payload.models : [];
      const initialProviderId =
        payload.defaults?.provider_id ??
        modelCatalogProviders[0]?.provider_id ??
        'openai';
      const initialModelId =
        payload.defaults?.model_id ??
        modelCatalogModels.find((entry) => entry.provider_id === initialProviderId)
          ?.model_id ??
        modelCatalogModels[0]?.model_id ??
        selectedModelId;
      defaultProviderIdForNewSession = initialProviderId;
      defaultModelIdForNewSession = initialModelId;
      selectedProviderId = initialProviderId;
      selectedModelId = initialModelId;
      selectedModelSelectionKey = `${selectedProviderId}::${selectedModelId}`;
    } catch (error) {
      console.error('Failed to load model catalog for chat:', error);
    }
  };

  const applyUserDefaultsForNewSessions = (
    providerId: ModelProviderId,
    modelId: string,
  ) => {
    if (!modelId) return;
    let nextProviderId: ModelProviderId = providerId;
    let nextModelId = modelId;

    if (modelCatalogModels.length > 0) {
      const exactMatch = modelCatalogModels.find(
        (entry) =>
          entry.provider_id === providerId && entry.model_id === modelId,
      );
      if (!exactMatch) {
        const modelMatch = modelCatalogModels.find(
          (entry) => entry.model_id === modelId,
        );
        if (modelMatch) {
          nextProviderId = modelMatch.provider_id;
          nextModelId = modelMatch.model_id;
        } else {
          const providerFallback =
            modelCatalogModels.find(
              (entry) => entry.provider_id === providerId,
            ) ?? modelCatalogModels[0];
          nextProviderId = providerFallback.provider_id;
          nextModelId = providerFallback.model_id;
        }
      }
    }

    defaultProviderIdForNewSession = nextProviderId;
    defaultModelIdForNewSession = nextModelId;
    if (!sessionId) {
      selectedProviderId = nextProviderId;
      selectedModelId = nextModelId;
    }
  };

  const parseModelSelectionKey = (
    rawValue: string,
  ): { providerId: ModelProviderId; modelId: string } | null => {
    const separatorIndex = rawValue.indexOf('::');
    if (separatorIndex <= 0) return null;
    const providerId = rawValue.slice(0, separatorIndex) as ModelProviderId;
    const modelId = rawValue.slice(separatorIndex + 2);
    if (!modelId) return null;
    if (providerId !== 'openai' && providerId !== 'gemini' && providerId !== 'anthropic' && providerId !== 'mistral' && providerId !== 'cohere') return null;
    return { providerId, modelId };
  };

  const handleModelSelectionChange = (event: Event) => {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    const parsed = parseModelSelectionKey(target.value);
    if (!parsed) return;
    selectedProviderId = parsed.providerId;
    selectedModelId = parsed.modelId;
  };

  const providerGroupLabel = (provider: ModelCatalogProvider) =>
    provider.status === 'ready'
      ? provider.label
      : `${provider.label} (${provider.status})`;

  const isGeminiModel = (modelId: string | null | undefined): boolean =>
    typeof modelId === 'string' &&
    modelId.trim().toLowerCase().startsWith('gemini');

  const fallbackSelectedModelOption = () =>
    modelCatalogModels.find(
      (entry) =>
        entry.provider_id === selectedProviderId &&
        entry.model_id === selectedModelId,
    ) ??
    modelCatalogModels.find((entry) => entry.model_id === selectedModelId) ??
    null;

  const getSelectedModelLabel = (): string =>
    fallbackSelectedModelOption()?.label ?? selectedModelId;

  const getLongestVisibleModelLabelLength = (): number => {
    const labels = modelCatalogGroups.flatMap((group) =>
      group.models.map((modelOption) => modelOption.label),
    );

    if (labels.length === 0) {
      labels.push(getSelectedModelLabel());
    }

    return labels.reduce((max, label) => Math.max(max, label.length), 0);
  };

  $: modelCatalogGroups = modelCatalogProviders
    .map((provider) => ({
      provider,
      models: modelCatalogModels.filter(
        (entry) => entry.provider_id === provider.provider_id,
      ),
    }))
    .filter((group) => group.models.length > 0);

  $: {
    if (modelCatalogModels.length > 0) {
      const exactMatch = modelCatalogModels.some(
        (entry) =>
          entry.provider_id === selectedProviderId &&
          entry.model_id === selectedModelId,
      );
      if (!exactMatch) {
        const providerFallback =
          modelCatalogModels.find(
            (entry) => entry.provider_id === selectedProviderId,
          ) ?? modelCatalogModels[0];
        selectedProviderId = providerFallback.provider_id;
        selectedModelId = providerFallback.model_id;
      }
    }
  }

  $: selectedModelSelectionKey = `${selectedProviderId}::${selectedModelId}`;
  $: selectedModelWidthCh = Math.max(
    getLongestVisibleModelLabelLength() + 4,
    18,
  );

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || (sending && !composerSteerReady)) return;

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
      } = {
        content: text,
      };

      if (selectedProviderId) payload.providerId = selectedProviderId;
      if (selectedModelId) payload.model = selectedModelId;

      if (sessionId) {
        payload.sessionId = sessionId;
      }

      if (focusContext?.contextType && focusContext.contextId) {
        payload.primaryContextType = focusContext.contextType;
        payload.primaryContextId = focusContext.contextId;
      }

      if (activeContexts.length > 0) {
        payload.contexts = activeContexts
          .filter((c) => c.contextType && c.contextId)
          .map((c) => ({
            contextType: c.contextType,
            contextId: c.contextId ?? '',
          }));
      }

      const enabledTools = getEnabledToolIds();
      if (enabledTools.length > 0) payload.tools = enabledTools;

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

      const res = await apiPost<{
        sessionId: string;
        userMessageId: string;
        assistantMessageId: string;
        streamId: string;
        jobId: string;
      }>('/chat/messages', payload);

      input = '';
      composerIsMultiline = false;
      updateComposerHeight();
      if (res.sessionId && res.sessionId !== sessionId) {
        sessionId = res.sessionId;
        if (!sessions.some((s) => s.id === res.sessionId)) {
          sessions = [{ id: res.sessionId, title: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as ChatSession, ...sessions];
        }
      }

      const nowIso = new Date().toISOString();
      const userMsg: LocalMessage = {
        id: res.userMessageId,
        sessionId: res.sessionId,
        role: 'user',
        content: text,
        createdAt: nowIso,
        _localStatus: 'completed',
      };
      bootstrapAssistantRun({
        sessionId: res.sessionId,
        assistantMessageId: res.assistantMessageId,
        streamId: res.streamId,
        jobId: res.jobId,
        model: selectedModelId,
        userMessage: userMsg,
        checkpointUserMessageId: userMsg.id,
      });
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
      await apiPost(
        `/chat/messages/${encodeURIComponent(activeAssistantMessage.id)}/stop`,
      );
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
      await apiPost(
        `/chat/messages/${encodeURIComponent(messageId)}/feedback`,
        { vote: next },
      );
      const voteValue = next === 'clear' ? null : next === 'up' ? 1 : -1;
      messages = messages.map((m) =>
        m.id === messageId ? { ...m, feedbackVote: voteValue } : m,
      );
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
    localToolsHubKey = `chat-local-tools:${Math.random().toString(36).slice(2)}`;
    streamHub.set(localToolsHubKey, (event: StreamHubEvent) => {
      handleLocalToolStreamEvent(event);
    });
    projectionHubKey = `chat-projection:${Math.random().toString(36).slice(2)}`;
    streamHub.set(projectionHubKey, (event: StreamHubEvent) => {
      handleProjectionStreamEvent(event);
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

  $: if (mode === 'ai' && sessionId && prefsKey !== getPrefsKey(sessionId)) {
    loadPrefs(sessionId);
    ensureDefaultToolToggles();
    refreshContextLabels();
  }

  $: if (mode === 'ai' && !sessionId && prefsKey !== getPrefsKey(null)) {
    loadPrefs(null);
    ensureDefaultToolToggles();
    refreshContextLabels();
  }

  $: if (mode === 'ai' && showComposerMenu) {
    void loadExtensionActiveTabContext();
  }

  $: if (mode === 'ai' && $workspaceScopeHydrated) {
    const nextWorkspaceId = $selectedWorkspace?.id ?? null;
    if (previousAiWorkspaceId === undefined) {
      previousAiWorkspaceId = nextWorkspaceId;
    } else if (nextWorkspaceId !== previousAiWorkspaceId) {
      previousAiWorkspaceId = nextWorkspaceId;
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
    refreshContextLabels();
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
    if (projectionHubKey) streamHub.delete(projectionHubKey);
    projectionHubKey = '';
    resetLocalToolInterceptionState();
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
        {#snippet renderTimelineItems(items: ProjectedTimelineItem[])}
          {#each items as item (item.key)}
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
                    <Streamdown content={m.content ?? ''} />
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
                  <button
                    class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                    on:click={async () => {
                      const text = m.content ?? '';
                      const ok = await copyToClipboard(
                        text,
                        renderMarkdownWithRefs(text),
                      );
                      if (ok) markCopied(m.id);
                    }}
                    type="button"
                    aria-label={$_('common.copy')}
                    title={$_('common.copy')}
                  >
                    {#if isCopied(m.id)}
                      <Check class="w-3.5 h-3.5 text-slate-900" />
                    {:else}
                      <Copy class="w-3.5 h-3.5" />
                    {/if}
                  </button>
                  <button
                    class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                    on:click={() => startEditMessage(m)}
                    type="button"
                    aria-label="Modifier"
                    title="Modifier"
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            {:else if item.kind === 'assistant-segment'}
              {@const m = item.message}
              {@const isUp = m.feedbackVote === 1}
              {@const isDown = m.feedbackVote === -1}
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
                  />
                  {#if item.isTerminal && item.isLastAssistantSegment}
                    <div
                      class="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-500"
                    >
                      <button
                        class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        on:click={async () => {
                          const text = m.content ?? '';
                          const ok = await copyToClipboard(
                            text,
                            renderMarkdownWithRefs(text),
                          );
                          if (ok) markCopied(item.key);
                        }}
                        type="button"
                        aria-label={$_('common.copy')}
                        title={$_('common.copy')}
                      >
                        {#if isCopied(item.key)}
                          <Check class="w-3.5 h-3.5 text-slate-900" />
                        {:else}
                          <Copy class="w-3.5 h-3.5" />
                        {/if}
                      </button>
                      <button
                        class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        on:click={() => void retryFromAssistant(m.id)}
                        type="button"
                        aria-label={$_('common.retry')}
                        title={$_('common.retry')}
                      >
                        <RotateCcw class="w-3.5 h-3.5" />
                      </button>
                      <button
                        class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        class:text-slate-900={isUp}
                        class:chat-message-action-button-active={isUp}
                        on:click={() =>
                          void setFeedback(m.id, isUp ? 'clear' : 'up')}
                        type="button"
                        aria-label={$_('chat.feedback.useful')}
                        title={$_('chat.feedback.useful')}
                      >
                        <ThumbsUp
                          class="w-3.5 h-3.5"
                          fill={isUp ? 'currentColor' : 'none'}
                        />
                      </button>
                      <button
                        class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        class:text-slate-900={isDown}
                        class:chat-message-action-button-active={isDown}
                        on:click={() =>
                          void setFeedback(m.id, isDown ? 'clear' : 'down')}
                        type="button"
                        aria-label={$_('chat.feedback.notUseful')}
                        title={$_('chat.feedback.notUseful')}
                      >
                        <ThumbsDown
                          class="w-3.5 h-3.5"
                          fill={isDown ? 'currentColor' : 'none'}
                        />
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
            {:else if item.kind === 'runtime-segment'}
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
                  />
                </div>
              </div>
            {/if}
          {/each}
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

  <div class="chat-composer-footer p-2 border-t border-slate-200">
    <div>
      <div class="relative">
        <div
          class="chat-composer-surface relative w-full min-w-0 rounded px-2 text-xs composer-rich slim-scroll overflow-y-auto overflow-x-hidden"
          class:composer-single-line={!composerIsMultiline}
          class:bg-white={($workspaceCanComment && !commentThreadResolved) ||
            mode !== 'comments'}
          class:bg-slate-50={mode === 'comments' &&
            (!$workspaceCanComment || commentThreadResolved)}
          style={`max-height: ${composerMaxHeight}px;`}
          bind:this={composerEl}
          role="textbox"
          aria-label={$_('chat.composer.ariaLabel')}
          aria-disabled={mode === 'comments' &&
            (!$workspaceCanComment || commentThreadResolved)}
          tabindex={mode === 'comments' &&
          (!$workspaceCanComment || commentThreadResolved)
            ? -1
            : 0}
          on:keydown={handleKeyDown}
        >
          {#if mode === 'ai'}
            {#if sessionDocsError}
              <div
                class="mb-2 rounded bg-red-50 border border-red-200 px-2 py-1 text-[11px] text-red-700"
              >
                {sessionDocsError}
              </div>
            {/if}
            {#if sessionDocs.length > 0}
              <div class="mb-2 flex flex-wrap gap-2">
                {#each sessionDocs as doc (doc.id)}
                  <div
                    class="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
                  >
                    <div class="max-w-[220px] truncate">{doc.filename}</div>
                    <span class="text-slate-400"
                      >· {sessionDocStatusLabel(doc.status)}</span
                    >
                    <button
                      class="rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-white"
                      type="button"
                      aria-label={$_('chat.documents.delete.ariaLabel')}
                      title={$_('common.delete')}
                      on:click={() => void removeSessionDoc(doc)}
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
        </div>
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
      </div>

      <div class="flex items-center gap-1.5">
        {#if mode === 'ai'}
          <MenuPopover
            placement="up"
            align="left"
            widthClass="w-80"
            menuClass="p-3 space-y-3"
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
              <label
                class={'flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-700 hover:bg-slate-50 ' +
                  (sessionDocsUploading ? 'opacity-50 pointer-events-none' : '')}
                aria-label={$_('chat.documents.addFile')}
                title={$_('chat.documents.addFile')}
              >
                <input
                  class="hidden"
                  type="file"
                  on:change={onPickSessionDoc}
                  disabled={sessionDocsUploading}
                  accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/markdown,text/plain,application/json"
                />
                <Paperclip class="w-4 h-4" />
                <span>{$_('chat.documents.addFile')}</span>
              </label>
              <div class="border-t border-slate-100 pt-2"></div>
              <div class="text-xs font-semibold text-slate-600">
                {$_('chat.contexts.title')}
              </div>
              {#if contextEntries.length === 0 && !extensionActiveTabContext}
                <div class="text-[11px] text-slate-500">
                  {$_('chat.contexts.none')}
                </div>
              {:else}
                <div class="space-y-1 max-h-40 overflow-auto slim-scroll">
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
                  {#each sortedContexts as c (c.contextType + ':' + c.contextId)}
                    <button
                      class={`flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-slate-50 ${
                        c.active ? 'text-slate-900' : 'text-slate-400'
                      }`}
                      type="button"
                      on:click={() => toggleContextActive(c)}
                    >
                      <svelte:component
                        this={getContextIcon(c.contextType)}
                        class="w-4 h-4"
                      />
                      <span class="truncate max-w-[220px]">{c.label}</span>
                    </button>
                  {/each}
                </div>
              {/if}

              <div class="border-t border-slate-100 pt-2">
                <div class="text-xs font-semibold text-slate-600 mb-1">
                  {$_('chat.tools.title')}
                </div>
                <div class="space-y-1 max-h-48 overflow-auto slim-scroll">
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
          <select
            id="chat-model-selection"
            value={selectedModelSelectionKey}
            on:change={handleModelSelectionChange}
            class="w-auto px-2 py-0.5 text-[11px] text-slate-700 focus:outline-none"
            style={`width:${selectedModelWidthCh}ch;min-width:${selectedModelWidthCh}ch;`}
          >
            {#if modelCatalogGroups.length === 0 && fallbackSelectedModelOption()}
              <option value={`${fallbackSelectedModelOption()?.provider_id ?? selectedProviderId}::${fallbackSelectedModelOption()?.model_id ?? selectedModelId}`}>
                {fallbackSelectedModelOption()?.label ?? selectedModelId}
              </option>
            {:else}
              {#each modelCatalogGroups as group}
                <optgroup label={providerGroupLabel(group.provider)}>
                  {#each group.models as modelOption}
                    <option value={`${modelOption.provider_id}::${modelOption.model_id}`}>
                      {modelOption.label}
                    </option>
                  {/each}
                </optgroup>
              {/each}
            {/if}
          </select>
        {/if}
        <div class="ml-auto flex items-center gap-2">
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
          disabled={mode === 'comments'
            ? commentInput.trim().length === 0 ||
              !commentContextType ||
              !commentContextId ||
              !$workspaceCanComment ||
              commentThreadResolved
            : composerRunInFlight
              ? !composerSteerReady ||
                composerSteerInFlight ||
                input.trim().length === 0
              : sending || input.trim().length === 0}
          type="button"
          aria-label={composerRunInFlight
            ? $_('chat.steer.submit')
            : $_('common.send')}
          title={composerRunInFlight
            ? $_('chat.steer.submit')
            : $_('common.send')}
          data-testid={composerRunInFlight
            ? 'chat-composer-steer-button'
            : 'chat-composer-send-button'}
        >
          {#if composerRunInFlight}
            <ShipWheel class="w-4 h-4" />
          {:else}
            <Send class="w-4 h-4" />
          {/if}
        </button>
        </div>
      </div>
    </div>
  </div>
</div>

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
