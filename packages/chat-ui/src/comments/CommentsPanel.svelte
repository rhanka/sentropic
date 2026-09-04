<script lang="ts">
  /**
   * CommentsPanel.svelte — self-contained comment panel.
   *
   * Mounts createCommentState(host) and wires all sub-components.
   * Zero sentropic domain strings — all labels/i18n/REST wiring via CommentHost.
   *
   * Props:
   *   - host: CommentHost (required)
   *   - contextType / contextId / sectionKey / sectionLabel: forwarded from parent
   *   - commentThreadId: bindable, parent can set the initial thread
   *
   * Architecture: AppChatPanel mounts this component when mode === 'comments'.
   * CommentsPanel is entirely self-managed — it does not share scroll/composer
   * state with the AI surface.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Snippet } from 'svelte';
  import type { CommentHost } from './host.js';
  import type { CommentItem, CommentThreadSummary, MentionMember } from './types.js';
  import { createCommentState } from './state.js';
  import { getMentionLabel } from './utils.js';

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  export let host: CommentHost;

  export let contextType: string | null = null;
  export let contextId: string | null = null;
  export let sectionKey: string | null = null;
  export let sectionLabel: string | null = null;
  /** Bindable: tracks the active thread id so parent can read it. */
  export let commentThreadId: string | null = null;
  /** Whether the workspace allows commenting (forwarded from parent RBAC). */
  export let workspaceCanComment = true;
  /** Whether the currently loaded context is loading. */
  export let commentLoading = false;

  /** i18n helper — parent must provide. */
  export let labels: (key: string, opts?: Record<string, unknown>) => string = (k) => k;
  /** Timestamp formatter — parent must provide. */
  export let formatTimestamp: (v: string | null | undefined) => string = () => '';

  /**
   * Snippet for rendering the text input inside the composer.
   * Receives { value, disabled, placeholder, onChange }.
   */
  export let renderComposerInput:
    | Snippet<[{
        value: string;
        disabled: boolean;
        placeholder: string;
        onChange: (v: string) => void;
        onKeyDown: (e: KeyboardEvent) => void;
      }]>
    | undefined = undefined;

  /**
   * Snippet for rendering the comment edit form inside a user bubble.
   */
  export let renderEditForm:
    | Snippet<[{
        commentId: string;
        content: string;
        onCancel: () => void;
        onCommit: () => void;
      }]>
    | undefined = undefined;

  /**
   * Snippet for the send button (right side of composer row).
   * Receives { disabled, onSend }.
   */
  export let renderSendButton:
    | Snippet<[{ disabled: boolean; onSend: () => void }]>
    | undefined = undefined;

  /**
   * Snippet for the thread picker menu trigger+content.
   */
  export let renderThreadMenuPopover:
    | Snippet<[{
        threads: CommentThreadSummary[];
        currentThreadId: string | null;
        resolvedCount: number;
        showResolvedComments: boolean;
        onSelect: (t: CommentThreadSummary) => void;
        onNew: () => void;
        onToggleShowResolved: () => void;
        getThreadSectionLabel: (sectionKey: string | null) => string;
      }]>
    | undefined = undefined;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = createCommentState(host);
  let snap = $state;
  state.subscribe((s) => { snap = s; });

  // Sync context props into state.
  $: state.actions.setContext({ contextType, contextId, sectionKey });
  $: if (commentThreadId !== snap.commentThreadId) {
    state.actions.setThreadId(commentThreadId);
  }
  // Keep bindable prop in sync with internal state.
  $: commentThreadId = snap.commentThreadId;
  // Forward commentLoading as a readable output.
  $: commentLoading = snap.commentLoading;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  let unsubUpdates: (() => void) | null = null;

  onMount(() => {
    void state.actions.loadMentionMembers();
    unsubUpdates = state.actions.subscribeUpdates();
  });

  onDestroy(() => {
    unsubUpdates?.();
  });

  // Re-subscribe when context changes.
  $: {
    contextType;
    contextId;
    if (unsubUpdates) {
      unsubUpdates();
      unsubUpdates = null;
    }
    unsubUpdates = state.actions.subscribeUpdates();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const isCommentByCurrentUser = (c: CommentItem): boolean => {
    const user = host.currentUser();
    if (!user) return false;
    if (user.id && c.created_by === user.id) return true;
    if (user.email && c.created_by === user.email) return true;
    if (user.id && c.created_by_user?.id === user.id) return true;
    if (user.email && c.created_by_user?.email === user.email) return true;
    return false;
  };

  const copiedIds = new Set<string>();
  const isCopied = (id: string) => copiedIds.has(id);
  const markCopied = (id: string) => {
    copiedIds.add(id);
    setTimeout(() => { copiedIds.delete(id); snap = snap; }, 2000);
    snap = snap; // trigger update
  };

  const handleCopyComment = async (c: CommentItem) => {
    try {
      await navigator.clipboard.writeText(c.content ?? '');
      markCopied(c.id);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (snap.showMentionMenu && snap.mentionMatches.length > 0) {
        state.actions.selectMentionMember(snap.mentionMatches[0]);
        return;
      }
      void state.actions.sendComment();
    }
  };

  const getCommentSectionLabel = (type: string | null, key: string | null): string =>
    host.resolveSectionLabel(type, key) ?? labels('chat.tabs.comments');

  const getThreadSectionLabel = (sk: string | null): string =>
    getCommentSectionLabel(contextType, sk);

  const activeCommentSectionLabel = (): string => {
    const root = snap.currentCommentRoot;
    const sk = root?.section_key ?? sectionKey;
    return getCommentSectionLabel(contextType, sk) ?? sectionLabel ?? labels('common.general');
  };

  const commentPlaceholder = (): string => {
    if (!workspaceCanComment) return labels('chat.comments.placeholder.disabledViewer');
    if (snap.commentThreadResolved) return labels('chat.comments.placeholder.resolved');
    return labels('chat.comments.placeholder.write');
  };

  let commentCanSend = false;
  $: commentCanSend =
    workspaceCanComment &&
    !snap.commentThreadResolved &&
    !!contextType &&
    !!contextId &&
    snap.commentInput.trim().length > 0;

  const assignedUser = () => snap.currentCommentRoot?.assigned_to_user ?? null;
  const isAssignedToCurrentUser = (): boolean => {
    const user = host.currentUser();
    const au = assignedUser();
    if (!au || !user) return false;
    return (user.id != null && au.id === user.id) || (user.email != null && au.email === user.email);
  };

  const canResolveCurrent = (): boolean =>
    snap.currentCommentRoot != null &&
    host.canResolve(snap.currentCommentRoot) &&
    host.canComment();

  const handleDeleteThread = async () => {
    if (!snap.currentCommentRoot) return;
    const msg = labels('chat.comments.confirmDeleteThread');
    if (host.confirmDelete) {
      if (!host.confirmDelete(msg)) return;
    } else if (typeof window !== 'undefined') {
      if (!confirm(msg)) return;
    }
    await state.actions.deleteThread();
  };
</script>

<div class="topai-comments-panel flex flex-col h-full">
  <!-- Thread navigation header -->
  <div class="border-b border-slate-100 px-3 py-2 space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="min-w-0 text-xs text-slate-500 flex flex-wrap items-center gap-2">
        <span>{activeCommentSectionLabel()}</span>
        {#if snap.commentThreadResolved && snap.commentThreadResolvedAt}
          <span class="text-slate-400">•</span>
          <span>
            {labels('chat.comments.resolvedAt', { values: { at: formatTimestamp(snap.commentThreadResolvedAt) } })}
          </span>
        {:else if assignedUser()}
          <span class="text-slate-400">•</span>
          <span>
            {#if isAssignedToCurrentUser()}
              {labels('chat.comments.assignedToMe')}
            {:else}
              {labels('chat.comments.assignedTo', { values: {
                label: assignedUser()?.displayName || assignedUser()?.email || assignedUser()?.id,
              } })}
            {/if}
          </span>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-1">
        {#if renderThreadMenuPopover}
          {@render renderThreadMenuPopover({
            threads: snap.visibleCommentThreads,
            currentThreadId: snap.commentThreadId,
            resolvedCount: snap.resolvedCount,
            showResolvedComments: snap.showResolvedComments,
            onSelect: (t) => state.actions.selectThread(t),
            onNew: () => state.actions.newThread(),
            onToggleShowResolved: () => state.actions.toggleShowResolved(),
            getThreadSectionLabel,
          })}
        {/if}

        <button
          class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
          on:click={() => state.actions.newThread()}
          title={labels('chat.comments.newThread')}
          aria-label={labels('chat.comments.newThread')}
          type="button"
        >
          +
        </button>

        <button
          class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded disabled:opacity-50"
          on:click={() => void state.actions.resolveThread()}
          title={snap.commentThreadResolved ? labels('chat.comments.reopen') : labels('chat.comments.resolve')}
          aria-label={snap.commentThreadResolved ? labels('chat.comments.reopen') : labels('chat.comments.resolve')}
          type="button"
          disabled={!snap.currentCommentRoot || !canResolveCurrent()}
        >
          {snap.commentThreadResolved ? '↩' : '✓'}
        </button>

        <button
          class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded disabled:opacity-50"
          type="button"
          disabled={!snap.hasPreviousThread}
          on:click={() => state.actions.goToRelativeThread(-1)}
          title={labels('chat.comments.previous')}
          aria-label={labels('chat.comments.previous')}
        >
          ‹
        </button>

        <button
          class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded disabled:opacity-50"
          type="button"
          disabled={!snap.hasNextThread}
          on:click={() => state.actions.goToRelativeThread(1)}
          title={labels('chat.comments.next')}
          aria-label={labels('chat.comments.next')}
        >
          ›
        </button>

        <button
          class="chat-danger-action-button text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
          on:click={() => void handleDeleteThread()}
          title={labels('chat.comments.deleteThread')}
          aria-label={labels('chat.comments.deleteThread')}
          type="button"
          disabled={!snap.currentCommentRoot}
        >
          🗑
        </button>
      </div>
    </div>
  </div>

  <!-- Timeline -->
  <div
    class="flex-1 min-h-0 relative"
    style={snap.commentThreadResolved ? 'background-color: #f1f5f9 !important;' : ''}
  >
    <div
      class="h-full overflow-y-auto p-3 space-y-2 slim-scroll"
      style={snap.commentThreadResolved
        ? 'scrollbar-gutter: stable; background-color: #f1f5f9 !important;'
        : 'scrollbar-gutter: stable;'}
    >
      {#if snap.commentError}
        <div class="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {snap.commentError}
        </div>
      {/if}

      {#if snap.commentLoading && snap.commentMessages.length === 0}
        <div class="text-xs text-slate-500">{labels('common.loading')}</div>
      {:else if !snap.commentThreadId}
        {#if snap.commentThreads.length > 0}
          <div class="text-xs text-slate-500">{labels('chat.comments.selectThreadHint')}</div>
        {:else}
          <div class="text-xs text-slate-500">{labels('chat.comments.emptyHint')}</div>
        {/if}
      {:else if snap.commentMessages.length === 0}
        <div class="text-xs text-slate-500">{labels('chat.comments.noMessagesThread')}</div>
      {:else}
        {#each snap.commentMessages as c (c.id)}
          {@const isMine = isCommentByCurrentUser(c)}
          {@const canEdit = isMine && c.id === snap.lastEditableCommentId && workspaceCanComment}
          {@const isAi = Boolean(c.tool_call_id)}
          {@const authorLabel = c.created_by_user?.displayName || c.created_by_user?.email || c.created_by}
          {@const initials = (authorLabel || '?').trim().split(/\s+/).slice(0,2).map((p: string) => p[0]?.toUpperCase() ?? '').join('') || '?'}

          {#if isMine}
            <div class="flex flex-col items-end group">
              {#if isAi}
                <div class="mb-1 flex items-center justify-end">
                  <div class="relative h-7 w-7 rounded-full bg-primary text-white border border-primary/80 flex items-center justify-center text-[11px]">
                    {initials}
                    <span class="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[9px] text-slate-600">AI</span>
                  </div>
                </div>
              {/if}
              <div class="chat-user-bubble max-w-[85%] rounded bg-primary text-white text-xs px-3 py-2 break-words w-full userMarkdown">
                {#if snap.editingCommentId === c.id && renderEditForm}
                  {@render renderEditForm({
                    commentId: c.id,
                    content: snap.editingCommentContent,
                    onCancel: () => state.actions.cancelEditComment(),
                    onCommit: () => void state.actions.commitEditComment(),
                  })}
                {:else}
                  {c.content ?? ''}
                {/if}
              </div>
              <div class="mt-1 flex items-center justify-end gap-2 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                  on:click={() => void handleCopyComment(c)}
                  type="button"
                  aria-label={labels('common.copy')}
                  title={labels('common.copy')}
                >
                  {isCopied(c.id) ? '✓' : '⎘'}
                </button>
                {#if canEdit && snap.editingCommentId !== c.id}
                  <button
                    class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                    on:click={() => state.actions.startEditComment(c)}
                    type="button"
                    aria-label={labels('chat.edit.editLabel') || 'Edit'}
                    title={labels('chat.edit.editLabel') || 'Edit'}
                  >
                    ✏
                  </button>
                {/if}
              </div>
            </div>
          {:else}
            <div class="flex items-start gap-2 group">
              <div class="relative h-7 w-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[11px] text-slate-600">
                {initials}
                {#if isAi}
                  <span class="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[9px] text-slate-600">AI</span>
                {/if}
              </div>
              <div class="max-w-[85%] w-full">
                <div class="text-[11px] text-slate-500 mb-1 flex items-center gap-2">
                  <!-- AI author suffix goes through the labels resolver (host i18n);
                       pre-extraction AppChatPanel labels bag carried
                       assistantLabel: ', Assistant IA' — hardcoding ', AI' here
                       was a Lot-5 fidelity regression (e2e 07_comment_assistant). -->
                  <span>{authorLabel}{isAi ? (labels('chat.comments.assistantLabel') || ', AI') : ''}</span>
                  {#if c.created_at}
                    <span>{formatTimestamp(c.created_at)}</span>
                  {/if}
                </div>
                <div class="rounded border border-slate-200 bg-white text-xs px-3 py-2 break-words">
                  {c.content ?? ''}
                </div>
                <div class="mt-1 flex items-center gap-2 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                    on:click={() => void handleCopyComment(c)}
                    type="button"
                    aria-label={labels('common.copy')}
                    title={labels('common.copy')}
                  >
                    {isCopied(c.id) ? '✓' : '⎘'}
                  </button>
                </div>
              </div>
            </div>
          {/if}
        {/each}
      {/if}

      {#if snap.commentLoading && snap.commentMessages.length > 0}
        <div class="text-[11px] text-slate-400 mt-2">{labels('chat.comments.updating')}</div>
      {/if}
    </div>
  </div>

  <!-- Composer -->
  <div class="border-t border-slate-100 p-2">
    {#if snap.showMentionMenu}
      <div class="relative">
        <div class="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-lg border border-slate-200 bg-white shadow-lg p-2">
          {#if snap.mentionLoading && snap.mentionDelayElapsed}
            <div class="px-2 py-1 text-[11px] text-slate-500">{labels('common.loading')}</div>
          {:else if snap.mentionError}
            <div class="px-2 py-1 text-[11px] text-red-600">{labels('chat.comments.mention.loadError')}</div>
          {:else if !snap.mentionLoading && snap.mentionMatches.length === 0}
            <div class="px-2 py-1 text-[11px] text-slate-500">{labels('chat.comments.mention.none')}</div>
          {:else}
            <div class="space-y-1 max-h-48 overflow-auto slim-scroll">
              {#each snap.mentionMatches as member (member.userId)}
                <button
                  class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50"
                  type="button"
                  on:click={() => state.actions.selectMentionMember(member)}
                >
                  <div class="font-medium text-slate-900 truncate">{getMentionLabel(member)}</div>
                  {#if member.email}
                    <div class="text-[10px] text-slate-400 truncate">{member.email}</div>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if snap.assignedToLabel}
      <div class="mb-2 inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
        <span>{labels('chat.comments.assignedTo', { values: { label: snap.assignedToLabel } })}</span>
        <button
          type="button"
          class="rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200"
          on:click={() => state.actions.clearAssignment()}
          aria-label={labels('chat.comments.unassign')}
          title={labels('chat.comments.unassign')}
        >
          ×
        </button>
      </div>
    {/if}

    <div class="flex items-end gap-2">
      <div class="flex-1 relative">
        {#if (!workspaceCanComment || snap.commentThreadResolved) && snap.commentInput.trim().length === 0}
          <div class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            {commentPlaceholder()}
          </div>
        {/if}
        {#if renderComposerInput}
          {@render renderComposerInput({
            value: snap.commentInput,
            disabled: !workspaceCanComment || snap.commentThreadResolved,
            placeholder: commentPlaceholder(),
            onChange: (v) => state.actions.setCommentInput(v),
            onKeyDown: handleKeyDown,
          })}
        {:else}
          <textarea
            class="w-full min-h-[36px] resize-none rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
            role="textbox"
            aria-label={labels('chat.composer.ariaLabel')}
            disabled={!workspaceCanComment || snap.commentThreadResolved}
            placeholder={commentPlaceholder()}
            value={snap.commentInput}
            on:input={(e) => state.actions.setCommentInput((e.target as HTMLTextAreaElement).value)}
            on:keydown={handleKeyDown}
            rows="1"
          ></textarea>
        {/if}
      </div>
      {#if renderSendButton}
        {@render renderSendButton({ disabled: !commentCanSend, onSend: () => void state.actions.sendComment() })}
      {:else}
        <button
          class="rounded bg-primary hover:bg-primary/90 text-white w-8 h-8 flex items-center justify-center disabled:opacity-60"
          on:click={() => void state.actions.sendComment()}
          disabled={!commentCanSend}
          type="button"
          aria-label={labels('common.send')}
          title={labels('common.send')}
          data-testid="chat-composer-send-button"
        >
          →
        </button>
      {/if}
    </div>
  </div>
</div>
