<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Readable } from 'svelte/store';
  import type { AppContext } from '$lib/core/context-provider';
  import { _, locale } from 'svelte-i18n';
  import {
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
  import { useCasesStore } from '$lib/stores/useCases';
  import { getScopedWorkspaceIdForUser, workspaceCanComment, selectedWorkspaceRole } from '$lib/stores/workspaceScope';
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
    Clapperboard,
    ChevronsLeftRightEllipsis,
    List,
    Eye,
    EyeOff,
    FolderOpen,
    Trash2,
    ChevronLeft,
    ChevronRight
  } from '@lucide/svelte';
  import { renderMarkdownWithRefs } from '$lib/utils/markdown';
  import {
    EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS,
    computeEnabledToolIds,
    computeToolToggleDefaults,
    computeVisibleToolToggleIds,
    isExtensionRestrictedToolsetMode as computeIsExtensionRestrictedToolsetMode,
  } from '$lib/utils/chat-tool-scope';

  type ChatSession = {
    id: string;
    title?: string | null;
    primaryContextType?: string | null;
    primaryContextId?: string | null;
    createdAt?: string;
    updatedAt?: string | null;
  };

  type ChatMessage = {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content?: string | null;
    reasoning?: string | null;
    sequence?: number;
    createdAt?: string;
    feedbackVote?: number | null;
  };

  type LocalMessage = ChatMessage & {
    _localStatus?: 'processing' | 'completed' | 'failed';
    _streamId?: string;
  };

  type StreamEvent = {
    eventType: string;
    data: any;
    sequence: number;
    createdAt?: string;
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
    contextType: 'organization' | 'folder' | 'usecase' | 'executive_summary';
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

  const getContextIcon = (type: ChatContextEntry['contextType']) => {
    if (type === 'organization') return Building2;
    if (type === 'folder') return Folder;
    if (type === 'usecase') return Lightbulb;
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
    if (type === 'usecase') {
      const useCase = $useCasesStore.find((u) => u.id === contextId);
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
      } else if (type === 'usecase') {
        const useCase = await apiGet<{
          data?: { name?: string };
          name?: string;
        }>(`/use-cases/${contextId}`);
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
      introduction: 'chat.sections.executiveSummary.introduction',
      analyse: 'chat.sections.executiveSummary.analysis',
      analysis: 'chat.sections.executiveSummary.analysis',
      recommandation: 'chat.sections.executiveSummary.recommendations',
      recommendations: 'chat.sections.executiveSummary.recommendations',
      synthese: 'chat.sections.executiveSummary.summary',
      summary: 'chat.sections.executiveSummary.summary',
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

  const getMessageStatus = (m: LocalMessage) =>
    m._localStatus ?? (m.content ? 'completed' : 'processing');
  let activeAssistantMessage: LocalMessage | null = null;
  $: activeAssistantMessage =
    mode === 'ai'
      ? ([...messages]
          .reverse()
          .find(
            (m) =>
              m.role === 'assistant' && getMessageStatus(m) === 'processing',
          ) ?? null)
      : null;

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

  const tryExecuteBufferedLocalTool = async (toolCallId: string) => {
    const localToolState = localToolStatesById.get(toolCallId);
    if (!localToolState || localToolState.executed) return;
    if (localToolInFlight.has(toolCallId)) return;
    if (!isLocalToolRuntimeAvailable()) return;

    if (!localToolState.argsText.trim() && localToolState.name === 'tab_type') {
      const elapsed = Date.now() - localToolState.firstSeenAt;
      if (elapsed < 1500) return;
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
      return;
    }

    const parsed = parseBufferedToolArgs(localToolState.argsText);
    if (!parsed.ready) return;

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
    }
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

    localToolStatesById.set(toolCallId, {
      streamId,
      name: toolNameRaw,
      argsText: previous ? `${previous.argsText}${argsChunk}` : argsChunk,
      lastSequence: sequence,
      firstSeenAt: previous?.firstSeenAt ?? Date.now(),
      executed: previous?.executed ?? false,
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

  const handleLocalToolStreamEvent = (event: StreamHubEvent) => {
    if (event.type !== 'tool_call_start' && event.type !== 'tool_call_delta')
      return;
    if (!isLocalToolRuntimeAvailable()) return;

    const streamId = String((event as any)?.streamId ?? '').trim();
    if (!streamId) return;
    const localToolEligibleStreamIds = getLocalToolEligibleStreamIds();
    if (!localToolEligibleStreamIds.has(streamId)) return;

    if (event.type === 'tool_call_start') {
      handleLocalToolCallStart(event);
      return;
    }
    handleLocalToolCallDelta(event);
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
  let sessionDocsKey = '';
  let sessionDocsSseKey = '';
  let sessionTitlesSseKey = '';
  let sessionDocsReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let showComposerMenu = false;
  let composerMenuButtonRef: HTMLButtonElement | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleDocumentClick: ((_: MouseEvent) => void) | null = null;
  let contextEntries: ChatContextEntry[] = [];
  let sortedContexts: ChatContextEntry[] = [];
  let toolEnabledById: Record<string, boolean> = {};
  let extensionRestrictedToolset = false;
  let prefsKey = '';
  let lastRouteContextKey: string | null = null;

  // Historique batch (Option C): messageId -> events
  let initialEventsByMessageId = new Map<string, StreamEvent[]>();
  let streamDetailsLoading = false;
  const terminalRefreshInFlight = new Set<string>();
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

    // /usecase/[id] → usecase
    if (routeId === '/usecase/[id]' && params.id) {
      return { primaryContextType: 'usecase', primaryContextId: params.id };
    }

    // /usecase → use case list; when a folder is selected, treat chat context as folder
    if (routeId === '/usecase' && $currentFolderId) {
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
      toolIds: ['usecases_list', 'usecase_get', 'read_usecase'],
      icon: Lightbulb,
    },
    {
      id: 'usecase_update',
      label: $_('chat.tools.usecaseUpdate.label'),
      toolIds: ['usecase_update', 'update_usecase_field'],
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
  ];

  const LOCAL_TOOL_TOGGLE_IDS = new Set(['tab_read', 'tab_action']);

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
    mode === 'ai' && isLocalToolRuntimeAvailable() && !sessionId;

  const isExtensionRestrictedToolsetMode = () =>
    computeIsExtensionRestrictedToolsetMode({
      mode,
      hasExtensionRuntime: isLocalToolRuntimeAvailable(),
      sessionId,
      extensionRestrictedToolset,
    });

  const getToolScopeToggles = () =>
    TOOL_TOGGLES.filter(
      (toggle) =>
        !LOCAL_TOOL_TOGGLE_IDS.has(toggle.id) || isLocalToolRuntimeAvailable(),
    ).map((toggle) => ({
      id: toggle.id,
      toolIds: toggle.toolIds,
    }));

  const getToolToggleDefaults = () => {
    return computeToolToggleDefaults({
      toolToggles: getToolScopeToggles(),
      restrictedMode: isExtensionRestrictedToolsetMode(),
      allowedToolIds: EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS,
    });
  };

  const getVisibleToolToggles = () => {
    const visibleIds = new Set(
      computeVisibleToolToggleIds({
        toolToggles: getToolScopeToggles(),
        restrictedMode: isExtensionRestrictedToolsetMode(),
        allowedToolIds: EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS,
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
        allowedToolIds: EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS,
      }),
    );
    return TOOL_TOGGLES.filter(
      (toggle) =>
        LOCAL_TOOL_TOGGLE_IDS.has(toggle.id) && visibleIds.has(toggle.id),
    );
  };

  const loadExtensionActiveTabContext = async () => {
    if (!isLocalToolRuntimeAvailable()) {
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
    if (!isLocalToolRuntimeAvailable()) {
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
      allowedToolIds: EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS,
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
      void sendMessage();
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

  const retryMessage = async (messageId: string) => {
    if (!sessionId) return;
    errorMsg = null;
    try {
      await apiPost(`/chat/messages/${encodeURIComponent(messageId)}/retry`);
      await loadMessages(sessionId, { scrollToBottom: true });
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.retry'));
    }
  };

  const retryFromAssistant = async (assistantMessageId: string) => {
    const idx = messages.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) return;
    const previousUser = [...messages.slice(0, idx)]
      .reverse()
      .find((m) => m.role === 'user');
    if (!previousUser) return;
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

  const loadSessions = async () => {
    loadingSessions = true;
    errorMsg = null;
    try {
      const res = await apiGet<{ sessions: ChatSession[] }>('/chat/sessions');
      sessions = res.sessions ?? [];
      if (!sessionId && sessions.length > 0) {
        await selectSession(sessions[0].id);
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
    if (shouldShowLoader) loadingMessages = true;
    errorMsg = null;
    try {
      const res = await apiGet<{ sessionId: string; messages: ChatMessage[] }>(
        `/chat/sessions/${id}/messages`,
      );
      const raw = res.messages ?? [];
      messages = raw.map((m) => ({
        ...m,
        _streamId: m.id,
        _localStatus: m.content ? 'completed' : undefined,
      }));
      if (opts?.scrollToBottom !== false)
        scheduleScrollToBottom({ force: true });

      // Hydratation batch (Option C) en arrière-plan: ne doit pas bloquer l'affichage des messages
      initialEventsByMessageId = new Map();
      streamDetailsLoading = true;
      void (async () => {
        try {
          const hist = await apiGet<{
            sessionId: string;
            streams: Array<{ messageId: string; events: StreamEvent[] }>;
          }>(
            `/chat/sessions/${id}/stream-events?limitMessages=20&limitEvents=2000`,
          );
          if (sessionId !== id) return;
          const map = new Map<string, StreamEvent[]>();
          for (const item of (hist as any)?.streams ?? []) {
            const mid = String(item?.messageId ?? '').trim();
            if (!mid) continue;
            map.set(mid, (item as any)?.events ?? []);
          }
          initialEventsByMessageId = map;
        } catch {
          initialEventsByMessageId = new Map();
        } finally {
          if (sessionId === id) streamDetailsLoading = false;
        }
      })();

      // Le scroll est exécuté via afterUpdate (une fois le DOM réellement rendu).
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.loadMessages'));
    } finally {
      if (shouldShowLoader) loadingMessages = false;
    }
  };

  export const selectSession = async (id: string) => {
    sessionId = id;
    resetLocalToolInterceptionState();
    await loadMessages(id, { scrollToBottom: true });
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
    initialEventsByMessageId = new Map();
    resetLocalToolInterceptionState();
    errorMsg = null;
    scheduleScrollToBottom({ force: true });
  };

  export const deleteCurrentSession = async () => {
    if (!sessionId) return;
    if (!confirm($_('chat.sessions.confirmDelete'))) return;
    errorMsg = null;
    try {
      await apiDelete(`/chat/sessions/${sessionId}`);
      sessionId = null;
      messages = [];
      initialEventsByMessageId = new Map();
      resetLocalToolInterceptionState();
      await loadSessions();
    } catch (e) {
      errorMsg = formatApiError(e, $_('chat.errors.deleteSession'));
    }
  };

  const handleAssistantTerminal = async (
    streamId: string,
    t: 'done' | 'error',
  ) => {
    if (terminalRefreshInFlight.has(streamId)) return;
    terminalRefreshInFlight.add(streamId);
    messages = messages.map((m) =>
      (m._streamId ?? m.id) === streamId
        ? { ...m, _localStatus: t === 'done' ? 'completed' : 'failed' }
        : m,
    );
    // Silent refresh: keep the message list mounted to avoid a visible "blink" at stream completion.
    if (sessionId)
      await loadMessages(sessionId, { scrollToBottom: true, silent: true });
    scheduleScrollToBottom({ force: true });
    // Laisser le temps à la UI de se stabiliser avant d'autoriser un autre refresh (évite boucles sur replay).
    await tick();
    terminalRefreshInFlight.delete(streamId);
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
          await handleAssistantTerminal(streamId, 'done');
          return;
        }
        if (status === 'failed') {
          await handleAssistantTerminal(streamId, 'error');
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

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

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
        void loadSessions();
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
      const assistantMsg: LocalMessage = {
        id: res.assistantMessageId,
        sessionId: res.sessionId,
        role: 'assistant',
        content: null,
        createdAt: nowIso,
        _localStatus: 'processing',
        _streamId: res.streamId,
      };
      messages = [...messages, userMsg, assistantMsg];
      followBottom = true;
      scheduleScrollToBottom({ force: true });

      // Fallback: si SSE rate les events (connection pas prête), on rattrape via polling queue.
      // On évite ainsi un "Préparation…" bloqué alors que le job est déjà terminé.
      void pollJobUntilTerminal(
        res.jobId,
        assistantMsg._streamId ?? assistantMsg.id,
        { timeoutMs: 90_000 },
      );
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
        sessionDocs = [];
        void loadSessionDocs();
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
      await loadSessions();
      if (sessionId && messages.length === 0) {
        await loadMessages(sessionId, { scrollToBottom: true });
      }
      loadPrefs(sessionId);
      ensureDefaultToolToggles();
      updateContextFromRoute();
      void loadExtensionActiveTabContext();
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
    ($organizationsStore || $foldersStore || $useCasesStore)
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
  });
</script>

<div class="flex flex-col h-full" bind:this={panelEl}>
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
                class="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                on:click={toggle}
                title={$_('chat.comments.chooseThread')}
                aria-label={$_('chat.comments.chooseThread')}
                type="button"
                bind:this={commentMenuButtonRef}
              >
                <List class="w-3.5 h-3.5" />
                <span>{$_('chat.comments.chooseThread')}</span>
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
            class="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
            on:click={handleNewCommentThread}
            title={$_('chat.comments.newThread')}
            aria-label={$_('chat.comments.newThread')}
            type="button"
          >
            <Plus class="w-3.5 h-3.5" />
            <span>{$_('chat.comments.newThread')}</span>
          </button>
          <button
            class="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            on:click={() => void handleResolveCommentThread()}
            title={commentThreadResolved ? $_('chat.comments.reopen') : $_('chat.comments.resolve')}
            aria-label={commentThreadResolved ? $_('chat.comments.reopen') : $_('chat.comments.resolve')}
            type="button"
            disabled={!currentCommentRoot || !canResolveCurrent}
          >
            {#if commentThreadResolved}
              <FolderOpen class="w-3.5 h-3.5" />
              <span>{$_('chat.comments.reopen')}</span>
            {:else}
              <Check class="w-3.5 h-3.5" />
              <span>{$_('chat.comments.resolve')}</span>
            {/if}
          </button>
          <button
            class="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
            on:click={() => void handleDeleteCommentThread()}
            title={$_('chat.comments.deleteThread')}
            aria-label={$_('chat.comments.deleteThread')}
            type="button"
            disabled={!currentCommentRoot}
          >
            <Trash2 class="w-3.5 h-3.5" />
          </button>
        </div>
        <div class="flex items-center gap-1">
          <button
            class="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            type="button"
            disabled={!hasPreviousThread}
            on:click={() => goToRelativeCommentThread(-1)}
            title={$_('chat.comments.previous')}
            aria-label={$_('chat.comments.previous')}
          >
            <ChevronLeft class="w-3.5 h-3.5" />
            <span>{$_('chat.comments.previous')}</span>
          </button>
          <button
            class="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            type="button"
            disabled={!hasNextThread}
            on:click={() => goToRelativeCommentThread(1)}
            title={$_('chat.comments.next')}
            aria-label={$_('chat.comments.next')}
          >
            <span>{$_('chat.comments.next')}</span>
            <ChevronRight class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  {/if}

  <div
    class="flex-1 min-h-0"
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
                  class="max-w-[85%] rounded bg-primary text-white text-xs px-3 py-2 break-words w-full userMarkdown"
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
                          class="rounded border border-slate-600 px-2 py-0.5 text-slate-200 hover:bg-slate-800"
                          type="button"
                          on:click={cancelEditComment}
                        >
                          {$_('common.cancel')}
                        </button>
                        <button
                          class="rounded bg-white text-slate-900 px-2 py-0.5 hover:bg-slate-200"
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
                    class="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
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
                      class="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
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
                      class="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
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
        {#if loadingMessages}
          <div class="text-xs text-slate-500">{$_('common.loading')}</div>
        {:else if messages.length === 0}
          <div class="text-xs text-slate-500">{$_('chat.chat.empty')}</div>
        {:else}
          {#each messages as m (m.id)}
            {#if m.role === 'user'}
              <div class="flex flex-col items-end group">
                <div
                  class="max-w-[85%] rounded bg-primary text-white text-xs px-3 py-2 break-words w-full userMarkdown"
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
                          class="rounded border border-slate-600 px-2 py-0.5 text-slate-200 hover:bg-slate-800"
                          type="button"
                          on:click={cancelEditMessage}
                        >
                          {$_('common.cancel')}
                        </button>
                        <button
                          class="rounded bg-white text-slate-900 px-2 py-0.5 hover:bg-slate-200"
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
                  <button
                    class="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
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
                    class="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                    on:click={() => startEditMessage(m)}
                    type="button"
                    aria-label="Modifier"
                    title="Modifier"
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            {:else if m.role === 'assistant'}
              {@const sid = m._streamId ?? m.id}
              {@const initEvents = initialEventsByMessageId.get(sid)}
              {@const showDetailWaiter =
                !!m.content && streamDetailsLoading && initEvents === undefined}
              {@const isUp = m.feedbackVote === 1}
              {@const isDown = m.feedbackVote === -1}
              {@const isTerminal =
                (m._localStatus ?? (m.content ? 'completed' : 'processing')) ===
                'completed'}
              <div class="flex justify-start group">
                <div class="max-w-[85%] w-full">
                  <StreamMessage
                    variant="chat"
                    streamId={sid}
                    status={m._localStatus ??
                      (m.content ? 'completed' : 'processing')}
                    finalContent={m.content ?? null}
                    historySource="stream"
                    initialEvents={initEvents}
                    historyPending={showDetailWaiter}
                    onStreamEvent={() => scheduleScrollToBottom()}
                    onTerminal={(t) => void handleAssistantTerminal(sid, t)}
                  />
                  {#if isTerminal}
                    <div
                      class="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-500"
                    >
                      <button
                        class="inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
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
                        class="inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        on:click={() => void retryFromAssistant(m.id)}
                        type="button"
                        aria-label={$_('common.retry')}
                        title={$_('common.retry')}
                      >
                        <RotateCcw class="w-3.5 h-3.5" />
                      </button>
                      <button
                        class="inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        class:text-slate-900={isUp}
                        class:bg-slate-100={isUp}
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
                        class="inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        class:text-slate-900={isDown}
                        class:bg-slate-100={isDown}
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
            {/if}
          {/each}
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
                    origin: prompt.request.origin,
                  },
                })}
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90"
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
                  class="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
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
                  class="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100"
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
                  class="rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:bg-red-100"
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

  <div class="p-3 border-t border-slate-200">
    <div class="relative flex items-center gap-2">
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
              class="rounded border border-slate-300 bg-white text-slate-600 w-10 h-10 flex items-center justify-center hover:bg-slate-50"
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
      {/if}
      <div
        class="relative flex-1 min-w-0 rounded border border-slate-300 px-3 py-2 text-xs composer-rich slim-scroll overflow-y-auto overflow-x-hidden"
        class:composer-single-line={!composerIsMultiline}
        class:bg-white={($workspaceCanComment && !commentThreadResolved) ||
          mode !== 'comments'}
        class:bg-slate-50={mode === 'comments' &&
          (!$workspaceCanComment || commentThreadResolved)}
        style={`max-height: ${composerMaxHeight}px; min-height: ${COMPOSER_BASE_HEIGHT}px;`}
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
              class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"
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
      <div class="flex items-center gap-2">
        {#if mode === 'ai' && activeAssistantMessage}
          <button
            class="rounded border border-slate-200 text-slate-600 w-10 h-10 flex items-center justify-center hover:bg-slate-100 disabled:opacity-60"
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
          class="rounded bg-primary hover:bg-primary/90 text-white w-10 h-10 flex items-center justify-center disabled:opacity-60"
          on:click={() =>
            mode === 'comments'
              ? void sendCommentMessage()
              : void sendMessage()}
          disabled={mode === 'comments'
            ? commentInput.trim().length === 0 ||
              !commentContextType ||
              !commentContextId ||
              !$workspaceCanComment ||
              commentThreadResolved
            : sending || input.trim().length === 0}
          type="button"
          aria-label="Envoyer"
        >
          <Send class="w-4 h-4" />
        </button>
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
