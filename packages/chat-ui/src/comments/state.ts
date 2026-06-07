/**
 * comments/state.ts
 *
 * createCommentState factory — owns all comment loading, sending, editing,
 * resolve/reopen/delete operations, mention handling, and thread navigation.
 *
 * D5: optimistic comment create uses host.currentUser().
 * R2: subscribeUpdates delegates to host.subscribeCommentUpdates.
 *
 * Framework-neutral (no svelte/store): uses a minimal hand-rolled store
 * matching the ReadableStore<T> shape so Svelte $-prefix subscriptions work.
 */

import type { CommentHost } from './host.js';
import type {
  CommentItem,
  CommentCurrentUser,
  CommentThreadSummary,
  MentionMember,
} from './types.js';
import {
  buildCommentThreads,
  getMentionCandidate,
  getMentionMatches,
  findAssignedMentionFromText,
  getMentionLabel,
  getCommentAuthorLabel,
} from './utils.js';

// ---------------------------------------------------------------------------
// Minimal hand-rolled store (no svelte/store import)
// ---------------------------------------------------------------------------

type Subscriber<T> = (value: T) => void;
type Unsubscriber = () => void;

type HandWritable<T> = {
  subscribe(run: Subscriber<T>): Unsubscriber;
  set(value: T): void;
  update(fn: (current: T) => T): void;
  get(): T;
};

function createWritable<T>(initial: T): HandWritable<T> {
  let current = initial;
  const subs = new Set<Subscriber<T>>();
  return {
    subscribe(run) {
      subs.add(run);
      run(current);
      return () => subs.delete(run);
    },
    set(value) {
      current = value;
      for (const sub of subs) sub(current);
    },
    update(fn) {
      current = fn(current);
      for (const sub of subs) sub(current);
    },
    get() {
      return current;
    },
  };
}

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type CommentStateSnapshot = {
  /** Flat list of all comment items for the current context. */
  commentMessages: CommentItem[];
  /** Thread summaries derived from commentMessages. */
  commentThreads: CommentThreadSummary[];
  /** Per-thread item map. */
  commentItemsByThread: Map<string, CommentItem[]>;
  /** Currently selected thread id. */
  commentThreadId: string | null;
  /** Currently selected section key. */
  commentSectionKey: string | null;
  /** Whether the active thread is resolved (status === 'closed'). */
  commentThreadResolved: boolean;
  /** updated_at / created_at of root comment (for "resolved at" display). */
  commentThreadResolvedAt: string | null;
  /** Root comment of the active thread. */
  currentCommentRoot: CommentItem | null;
  /** Whether the loading spinner should be shown. */
  commentLoading: boolean;
  /** Error string (REST failure). */
  commentError: string | null;
  /** Current comment input text. */
  commentInput: string;
  /** Pending @-mention assignee (userId). */
  assignedToUserId: string | null;
  /** Pending @-mention assignee label. */
  assignedToLabel: string | null;
  /** @-mention popup open. */
  showMentionMenu: boolean;
  /** Current @-mention query. */
  mentionQuery: string;
  /** Mention members matching the current query. */
  mentionMatches: MentionMember[];
  /** All loaded mention members. */
  mentionMembers: MentionMember[];
  mentionLoading: boolean;
  mentionError: string | null;
  mentionDelayElapsed: boolean;
  /** Whether resolved threads are shown in the thread picker. */
  showResolvedComments: boolean;
  /** Resolved thread count. */
  resolvedCount: number;
  /** The threads visible in the picker (filtered by showResolvedComments). */
  visibleCommentThreads: CommentThreadSummary[];
  /** Index of the active thread within visibleCommentThreads. */
  commentThreadIndex: number;
  hasPreviousThread: boolean;
  hasNextThread: boolean;
  /** Id of the comment currently being edited. */
  editingCommentId: string | null;
  editingCommentContent: string;
  /** Last editable comment id (the most recent comment authored by currentUser). */
  lastEditableCommentId: string | null;
};

export type CommentStateActions = {
  /** Load all comments for the current context (does a full reload). */
  loadCommentThreads(opts?: { silent?: boolean }): Promise<void>;
  /** Send the current commentInput as a new or reply comment. */
  sendComment(): Promise<void>;
  /** Select a thread by summary. */
  selectThread(thread: CommentThreadSummary): void;
  /** Start a new thread (clear selected thread). */
  newThread(): void;
  /** Navigate prev/next thread in the visible list. */
  goToRelativeThread(direction: -1 | 1): void;
  /** Toggle resolve/reopen for the active thread root. */
  resolveThread(): Promise<void>;
  /** Delete the active thread. */
  deleteThread(): Promise<void>;
  /** Start editing a comment. */
  startEditComment(comment: CommentItem): void;
  /** Cancel editing. */
  cancelEditComment(): void;
  /** Commit the edited comment. */
  commitEditComment(): Promise<void>;
  /** Select a mention member (inserts @label into input). */
  selectMentionMember(member: MentionMember): void;
  /** Update the comment input (called from composer on:change). */
  setCommentInput(value: string): void;
  /** Update section-key context (triggers reload). */
  setContext(params: {
    contextType: string | null;
    contextId: string | null;
    sectionKey?: string | null;
  }): void;
  /** Update thread id (e.g. from parent prop). */
  setThreadId(threadId: string | null): void;
  /** Toggle showResolvedComments. */
  toggleShowResolved(): void;
  /** Subscribe to real-time updates for the current context. Returns unsub. */
  subscribeUpdates(): () => void;
  /** Load mention members (lazy, deduped). */
  loadMentionMembers(): Promise<void>;
  /** Reset the assignee chip. */
  clearAssignment(): void;
};

export type CommentState = {
  /** Subscribe to the full snapshot (Svelte-compatible store). */
  subscribe: HandWritable<CommentStateSnapshot>['subscribe'];
  /** All state actions. */
  actions: CommentStateActions;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCommentState(host: CommentHost): CommentState {
  // -- internal mutable state -----------------------------------------------

  let contextType: string | null = null;
  let contextId: string | null = null;
  let sectionKey: string | null = null;
  let lastContextKey = '';
  let lastSectionKey: string | null = null;

  let commentMessages: CommentItem[] = [];
  let commentThreads: CommentThreadSummary[] = [];
  let commentItemsByThread = new Map<string, CommentItem[]>();
  let commentThreadId: string | null = null;
  let commentSectionKey: string | null = null;
  let commentThreadResolved = false;
  let commentThreadResolvedAt: string | null = null;
  let currentCommentRoot: CommentItem | null = null;
  let commentLoading = false;
  let commentError: string | null = null;
  let commentInput = '';
  let assignedToUserId: string | null = null;
  let assignedToLabel: string | null = null;
  let showMentionMenu = false;
  let mentionQuery = '';
  let mentionMatches: MentionMember[] = [];
  let mentionMembers: MentionMember[] = [];
  let mentionLoading = false;
  let mentionError: string | null = null;
  let mentionDelayElapsed = false;
  let mentionDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let mentionWorkspaceLoaded = false;
  let mentionSuppressUntilChange = false;
  let mentionSuppressValue = '';
  let showResolvedComments = false;
  let editingCommentId: string | null = null;
  let editingCommentContent = '';
  let lastCommentKey = '';
  let lastCommentThreadId: string | null = null;
  let lastCommentMessageCount = 0;
  let lastSelectedCommentThreadId: string | null = null;
  let commentReloadTimer: ReturnType<typeof setTimeout> | null = null;

  // -- derived helpers -------------------------------------------------------

  const computeThreadRoot = (threadId: string | null): CommentItem | null =>
    threadId ? (commentItemsByThread.get(threadId)?.[0] ?? null) : null;

  const computeLastEditableId = (
    threadId: string | null,
    messages: CommentItem[],
    user: CommentCurrentUser | null,
  ): string | null => {
    if (!threadId || !user) return null;
    const last = messages.length > 0 ? messages[messages.length - 1] : null;
    if (!last) return null;
    const byId = user.id && last.created_by === user.id;
    const byEmail =
      user.email && last.created_by_user?.email === user.email;
    return byId || byEmail ? last.id : null;
  };

  const buildSnapshot = (): CommentStateSnapshot => {
    const resolvedThreads = commentThreads.filter((t) => t.status === 'closed');
    const resolvedCount = resolvedThreads.length;
    const visibleCommentThreads = showResolvedComments
      ? commentThreads
      : commentThreads.filter((t) => t.status !== 'closed');
    const commentThreadIndex = commentThreadId
      ? visibleCommentThreads.findIndex((t) => t.id === commentThreadId)
      : -1;
    const hasPreviousThread = commentThreadIndex > 0;
    const hasNextThread =
      commentThreadIndex >= 0 &&
      commentThreadIndex < visibleCommentThreads.length - 1;
    const user = host.currentUser();
    const lastEditableCommentId = computeLastEditableId(
      commentThreadId,
      commentMessages,
      user,
    );
    return {
      commentMessages,
      commentThreads,
      commentItemsByThread,
      commentThreadId,
      commentSectionKey,
      commentThreadResolved,
      commentThreadResolvedAt,
      currentCommentRoot,
      commentLoading,
      commentError,
      commentInput,
      assignedToUserId,
      assignedToLabel,
      showMentionMenu,
      mentionQuery,
      mentionMatches,
      mentionMembers,
      mentionLoading,
      mentionError,
      mentionDelayElapsed,
      showResolvedComments,
      resolvedCount,
      visibleCommentThreads,
      commentThreadIndex,
      hasPreviousThread,
      hasNextThread,
      editingCommentId,
      editingCommentContent,
      lastEditableCommentId,
    };
  };

  const store = createWritable<CommentStateSnapshot>(buildSnapshot());
  const notify = () => store.set(buildSnapshot());

  // -- thread-root / resolved sync ------------------------------------------

  const syncThreadRoot = () => {
    const root = computeThreadRoot(commentThreadId);
    currentCommentRoot = root;
    commentThreadResolved = root?.status === 'closed';
    commentThreadResolvedAt =
      (root?.updated_at ?? root?.created_at ?? null) as string | null;
  };

  // -- actions ---------------------------------------------------------------

  const loadCommentThreads = async (
    opts?: { silent?: boolean },
  ): Promise<void> => {
    if (!contextType || !contextId) {
      commentThreads = [];
      commentMessages = [];
      commentItemsByThread = new Map();
      lastCommentThreadId = null;
      lastCommentMessageCount = 0;
      notify();
      return;
    }
    const shouldShowLoader = !opts?.silent;
    if (shouldShowLoader) commentLoading = true;
    commentError = null;
    const activeThreadId = commentThreadId;
    notify();
    try {
      const res = await host.listComments({
        contextType,
        contextId,
        sectionKey,
      });
      const items = res.items || [];
      const { threads, map } = buildCommentThreads(items);
      commentThreads = threads;
      commentItemsByThread = new Map(map);

      if (activeThreadId && commentItemsByThread.has(activeThreadId)) {
        const nextMessages = commentItemsByThread.get(activeThreadId) ?? [];
        commentMessages = nextMessages;
        const nextCount = nextMessages.length;
        const threadChanged = lastCommentThreadId !== activeThreadId;
        if (threadChanged) {
          lastCommentThreadId = activeThreadId;
          lastCommentMessageCount = nextCount;
        } else {
          lastCommentMessageCount = nextCount;
        }
      } else if (!opts?.silent) {
        commentMessages = [];
        lastCommentThreadId = null;
        lastCommentMessageCount = 0;
      }
      syncThreadRoot();
    } catch (e) {
      commentError = e instanceof Error ? e.message : String(e);
    } finally {
      if (shouldShowLoader) commentLoading = false;
      notify();
    }
  };

  const scheduleCommentReload = () => {
    if (commentReloadTimer) return;
    commentReloadTimer = setTimeout(() => {
      commentReloadTimer = null;
      void loadCommentThreads({ silent: true });
    }, 150);
  };

  const loadMentionMembers = async (): Promise<void> => {
    if (mentionLoading || mentionWorkspaceLoaded) return;
    mentionLoading = true;
    mentionError = null;
    mentionDelayElapsed = false;
    if (mentionDelayTimer) clearTimeout(mentionDelayTimer);
    mentionDelayTimer = setTimeout(() => {
      mentionDelayElapsed = true;
      mentionDelayTimer = null;
      notify();
    }, 500);
    notify();
    try {
      const res = await host.listMentionMembers();
      mentionMembers = res.items ?? [];
      mentionWorkspaceLoaded = true;
    } catch (e) {
      mentionError = e instanceof Error ? e.message : String(e);
    } finally {
      mentionLoading = false;
      notify();
    }
  };

  const sendComment = async (): Promise<void> => {
    if (!host.canComment()) return;
    if (commentThreadResolved) return;
    if (!contextType || !contextId) return;
    const trimmed = commentInput.trim();
    if (!trimmed) return;

    commentError = null;

    try {
      if (trimmed.includes('@') && mentionMembers.length === 0) {
        await loadMentionMembers();
      }
      let resolvedAssigneeId = assignedToUserId;
      let resolvedAssigneeLabel = assignedToLabel;
      if (!resolvedAssigneeId && mentionMembers.length > 0) {
        const inferred = findAssignedMentionFromText(trimmed, mentionMembers);
        if (inferred) {
          resolvedAssigneeId = inferred.userId;
          resolvedAssigneeLabel = getMentionLabel(inferred);
        }
      }

      if (commentThreadId) {
        // Reply to existing thread.
        await host.createComment({
          contextType,
          contextId,
          sectionKey: commentSectionKey || undefined,
          content: trimmed,
          threadId: commentThreadId,
          assignedTo: resolvedAssigneeId ?? undefined,
        });
      } else {
        // New thread — optimistic update (D5).
        const nowIso = new Date().toISOString();
        const user = host.currentUser();
        const res = await host.createComment({
          contextType,
          contextId,
          sectionKey: commentSectionKey || undefined,
          content: trimmed,
          assignedTo: resolvedAssigneeId ?? undefined,
        });
        commentThreadId = res.thread_id;
        commentSectionKey = sectionKey;

        const assignedUserId = resolvedAssigneeId ?? user?.id ?? null;
        const assignedMember = resolvedAssigneeId
          ? (mentionMembers.find((m) => m.userId === resolvedAssigneeId) ?? null)
          : null;
        const optimistic: CommentItem = {
          id: res.id,
          context_type: contextType,
          context_id: contextId,
          section_key: commentSectionKey ?? null,
          created_by: user?.id ?? '',
          assigned_to: assignedUserId,
          status: 'open',
          thread_id: res.thread_id,
          content: trimmed,
          created_at: nowIso,
          updated_at: null,
          created_by_user: user
            ? {
                id: user.id ?? null,
                email: user.email ?? null,
                displayName: user.displayName ?? null,
              }
            : null,
          assigned_to_user: assignedMember
            ? {
                id: assignedMember.userId,
                email: assignedMember.email ?? null,
                displayName: assignedMember.displayName ?? null,
              }
            : assignedUserId && user
              ? {
                  id: user.id ?? null,
                  email: user.email ?? null,
                  displayName: user.displayName ?? null,
                }
              : null,
        };

        commentItemsByThread = new Map(commentItemsByThread);
        commentItemsByThread.set(res.thread_id, [optimistic]);
        commentMessages = [optimistic];

        const authorLabel =
          user?.displayName || user?.email || user?.id || '';
        const newThread: CommentThreadSummary = {
          id: res.thread_id,
          sectionKey: commentSectionKey ?? null,
          count: 1,
          lastAt: nowIso,
          preview: trimmed,
          authorLabel,
          status: 'open',
          assignedTo: assignedUserId,
          rootId: res.id,
          createdBy: user?.id ?? '',
        };
        commentThreads = [
          newThread,
          ...commentThreads.filter((t) => t.id !== res.thread_id),
        ];
        lastCommentThreadId = res.thread_id;
        lastCommentMessageCount = 1;
        syncThreadRoot();
      }

      commentInput = '';
      assignedToUserId = null;
      assignedToLabel = null;
      mentionQuery = '';
      mentionMatches = [];
      showMentionMenu = false;
      notify();

      await loadCommentThreads({ silent: true });
      if (commentThreadId && commentItemsByThread.has(commentThreadId)) {
        commentMessages = commentItemsByThread.get(commentThreadId) ?? [];
        syncThreadRoot();
        notify();
      }
    } catch (e) {
      commentError = e instanceof Error ? e.message : String(e);
      notify();
    }
  };

  const selectThread = (thread: CommentThreadSummary) => {
    commentThreadId = thread.id;
    commentSectionKey = thread.sectionKey;
    syncThreadRoot();
    if (commentThreadId && commentItemsByThread.has(commentThreadId)) {
      commentMessages = commentItemsByThread.get(commentThreadId) ?? [];
    }
    notify();
  };

  const newThread = () => {
    commentThreadId = null;
    commentSectionKey = sectionKey;
    syncThreadRoot();
    commentMessages = [];
    notify();
  };

  const goToRelativeThread = (direction: -1 | 1) => {
    const visible = showResolvedComments
      ? commentThreads
      : commentThreads.filter((t) => t.status !== 'closed');
    const idx = commentThreadId
      ? visible.findIndex((t) => t.id === commentThreadId)
      : -1;
    if (idx < 0) return;
    const next = visible[idx + direction];
    if (!next) return;
    commentThreadId = next.id;
    commentSectionKey = next.sectionKey;
    syncThreadRoot();
    if (commentThreadId && commentItemsByThread.has(commentThreadId)) {
      commentMessages = commentItemsByThread.get(commentThreadId) ?? [];
    }
    notify();
  };

  const selectNextOpenThreadAfterResolve = (
    currentThreadId: string,
    previousOpenOrder: string[],
  ) => {
    const openThreads = commentThreads.filter((t) => t.status !== 'closed');
    if (openThreads.length === 0) {
      commentThreadId = null;
      return;
    }
    const preferredIds = previousOpenOrder.filter((id) => id !== currentThreadId);
    const next =
      preferredIds
        .map((id) => openThreads.find((t) => t.id === id) ?? null)
        .find(Boolean) ?? openThreads[0];
    commentThreadId = next?.id ?? null;
    commentSectionKey = next?.sectionKey ?? null;
  };

  const resolveThread = async (): Promise<void> => {
    if (!currentCommentRoot || !host.canResolve(currentCommentRoot)) return;
    try {
      const currentThreadId = commentThreadId;
      const previousOpenOrder = commentThreads
        .filter((t) => t.status !== 'closed')
        .map((t) => t.id);
      const wasClosed = currentCommentRoot.status === 'closed';
      if (wasClosed) {
        await host.reopenComment(currentCommentRoot.id);
      } else {
        await host.closeComment(currentCommentRoot.id);
      }
      await loadCommentThreads({ silent: true });
      if (!wasClosed && currentThreadId) {
        selectNextOpenThreadAfterResolve(currentThreadId, previousOpenOrder);
        syncThreadRoot();
        if (commentThreadId && commentItemsByThread.has(commentThreadId)) {
          commentMessages = commentItemsByThread.get(commentThreadId) ?? [];
        }
        notify();
      }
    } catch (e) {
      commentError = e instanceof Error ? e.message : String(e);
      notify();
    }
  };

  const deleteThread = async (): Promise<void> => {
    if (!currentCommentRoot) return;
    try {
      await host.deleteComment(currentCommentRoot.id);
      commentThreadId = null;
      await loadCommentThreads({ silent: true });
    } catch (e) {
      commentError = e instanceof Error ? e.message : String(e);
      notify();
    }
  };

  const startEditComment = (comment: CommentItem) => {
    editingCommentId = comment.id;
    editingCommentContent = comment.content;
    notify();
  };

  const cancelEditComment = () => {
    editingCommentId = null;
    editingCommentContent = '';
    notify();
  };

  const commitEditComment = async (): Promise<void> => {
    if (!editingCommentId) return;
    const trimmed = editingCommentContent.trim();
    if (!trimmed) return;
    try {
      await host.updateComment(editingCommentId, { content: trimmed });
      await loadCommentThreads();
    } catch (e) {
      commentError = e instanceof Error ? e.message : String(e);
      notify();
    }
    cancelEditComment();
  };

  const selectMentionMember = (member: MentionMember) => {
    const candidate = getMentionCandidate(commentInput);
    if (!candidate) return;
    const label = getMentionLabel(member);
    const nextInput = `${commentInput.slice(0, candidate.start)}@${label} ${commentInput.slice(candidate.end)}`;
    commentInput = nextInput;
    assignedToUserId = member.userId;
    assignedToLabel = label;
    showMentionMenu = false;
    mentionQuery = '';
    mentionMatches = [];
    mentionSuppressUntilChange = true;
    mentionSuppressValue = nextInput.trimEnd();
    notify();
  };

  const setCommentInput = (value: string) => {
    commentInput = value;

    // Mention suppress logic
    if (mentionSuppressUntilChange) {
      if (commentInput.trimEnd() === mentionSuppressValue) {
        mentionQuery = '';
        showMentionMenu = false;
        mentionMatches = [];
        notify();
        return;
      } else {
        mentionSuppressUntilChange = false;
        mentionSuppressValue = '';
      }
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
    mentionMatches = showMentionMenu
      ? getMentionMatches(mentionMembers, mentionQuery)
      : [];
    notify();
  };

  const setContext = (params: {
    contextType: string | null;
    contextId: string | null;
    sectionKey?: string | null;
  }) => {
    const prevContextKey = lastContextKey;
    const nextKey = `${params.contextType || ''}:${params.contextId || ''}:${params.sectionKey ?? ''}`;

    // Section key changed → reset thread lists.
    if (
      params.sectionKey !== lastSectionKey &&
      params.sectionKey !== undefined
    ) {
      lastSectionKey = params.sectionKey ?? null;
      commentThreads = [];
      commentMessages = [];
      commentItemsByThread = new Map();
      lastCommentThreadId = null;
      lastCommentMessageCount = 0;
    }

    contextType = params.contextType;
    contextId = params.contextId;
    sectionKey = params.sectionKey ?? null;

    if (nextKey !== prevContextKey) {
      lastContextKey = nextKey;
      void loadCommentThreads();
    }
  };

  const setThreadId = (threadId: string | null) => {
    if (commentThreadId === threadId) return;
    commentThreadId = threadId;
    commentSectionKey = sectionKey;
    syncThreadRoot();
    if (threadId !== lastSelectedCommentThreadId) {
      lastSelectedCommentThreadId = threadId;
      lastCommentThreadId = threadId;
      lastCommentMessageCount = commentMessages.length;
    }
    if (commentThreadId && commentItemsByThread.has(commentThreadId)) {
      commentMessages = commentItemsByThread.get(commentThreadId) ?? [];
    } else if (!commentLoading) {
      commentMessages = [];
    }
    notify();
  };

  const toggleShowResolved = () => {
    showResolvedComments = !showResolvedComments;
    notify();
  };

  const subscribeUpdates = (): (() => void) => {
    if (!contextType || !contextId) return () => {};
    return host.subscribeCommentUpdates(contextType, contextId, () => {
      scheduleCommentReload();
    });
  };

  const clearAssignment = () => {
    assignedToUserId = null;
    assignedToLabel = null;
    notify();
  };

  return {
    subscribe: store.subscribe.bind(store),
    actions: {
      loadCommentThreads,
      sendComment,
      selectThread,
      newThread,
      goToRelativeThread,
      resolveThread,
      deleteThread,
      startEditComment,
      cancelEditComment,
      commitEditComment,
      selectMentionMember,
      setCommentInput,
      setContext,
      setThreadId,
      toggleShowResolved,
      subscribeUpdates,
      loadMentionMembers,
      clearAssignment,
    },
  };
}
