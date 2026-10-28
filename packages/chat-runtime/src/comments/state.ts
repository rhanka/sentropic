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
} from '@sentropic/chat-ui/comments';
import {
  buildCommentThreads,
  getMentionCandidate,
  getMentionMatches,
  findAssignedMentionFromText,
  type CommentPresentation,
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

export function createCommentState(host: CommentHost, presentation: CommentPresentation): CommentState {
  const { getMentionLabel, getCommentAuthorLabel } = presentation;
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
