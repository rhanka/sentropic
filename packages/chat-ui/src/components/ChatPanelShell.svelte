<script lang="ts">
  /**
   * ChatPanelShell — the sentropic gold chat panel composition, extracted
   * from the app-local `AppChatPanel.svelte` (gold shell program, Lot A1).
   *
   * Headless-first contract: every domain concern is injected — comment host,
   * i18n `labels`, and host-rendered snippets (rich-text input, popover
   * menus). The shell owns the gold MARKUP; orchestration state comes from
   * the headless helpers in `state/*` so future React/Angular/Vue views can
   * mount the same logic.
   *
   * Slice status (branch feat/chatui-gold-shell):
   * - S5a1: shell root + comments mode (CommentsPanel forwarding).
   * - S5a2+: AI mode region (timeline + composer) lands next, replacing the
   *   `ai` slot seam.
   */
  import type { Snippet } from 'svelte';
  import { Streamdown } from 'svelte-streamdown';

  import CommentsPanel from '../comments/CommentsPanel.svelte';
  import type { CommentHost } from '../comments/host.js';
  import type { CommentThreadSummary } from '../comments/types.js';
  import ChatComposer from './ChatComposer.svelte';
  import ChatTimeline from './ChatTimeline.svelte';
  import ModelSelector from './ModelSelector.svelte';
  import MessageActions from './MessageActions.svelte';
  import StreamMessage from './StreamMessage.svelte';
  import AttachmentBand from '../documents/AttachmentBand.svelte';
  import GeneratedFileCardTray from '../documents/GeneratedFileCardTray.svelte';
  import ImageLightbox from '../documents/ImageLightbox.svelte';
  import MessageAttachments from '../documents/MessageAttachments.svelte';
  import type { ChatGeneratedFileCard } from '../documents/generated-file-cards.js';
  import type { ChatProjectedTimelineItem } from '../state/chatProjection.js';

  type TimelineItem = ChatProjectedTimelineItem<any, any>;

  export let mode: 'ai' | 'comments' = 'ai';

  /** Root panel element, bindable so the host can measure (hydration flush). */
  export let panelEl: HTMLDivElement | null = null;

  // --- comments mode (forwarded to CommentsPanel, same contract) ---
  export let commentHost: CommentHost | null = null;
  export let commentContextType: string | null = null;
  export let commentContextId: string | null = null;
  export let commentSectionKey: string | null = null;
  export let commentSectionLabel: string | null = null;
  export let commentThreadId: string | null = null;
  export let commentLoading = false;

  /** i18n — host-injected translator, zero domain strings in the module. */
  export let labels: (key: string, opts?: Record<string, unknown>) => string = (
    k,
  ) => k;

  /**
   * AI composer surface input — host renders its bare rich-text editor
   * (no aria-textbox wrapper: the ChatComposer shell provides the textbox
   * role itself; a wrapper here would duplicate it).
   */
  export let renderComposerSurfaceInput: Snippet | undefined = undefined;

  /** Host-rendered rich-text composer input (e.g. TipTap contenteditable). */
  export let renderComposerInput:
    | Snippet<
        [
          {
            value: string;
            disabled: boolean;
            placeholder: string;
            onChange: (v: string) => void;
            onKeyDown: (e: KeyboardEvent) => void;
          },
        ]
      >
    | undefined = undefined;

  /** Host-rendered thread picker popover (menu component stays host-side). */
  export let renderThreadMenuPopover:
    | Snippet<
        [
          {
            threads: CommentThreadSummary[];
            currentThreadId: string | null;
            resolvedCount: number;
            showResolvedComments: boolean;
            onSelect: (t: CommentThreadSummary) => void;
            onNew: () => void;
            onToggleShowResolved: () => void;
            getThreadSectionLabel: (sectionKey: string | null) => string;
          },
        ]
      >
    | undefined = undefined;

  /**
   * Stream client for live StreamMessage subscriptions (the app's streamHub).
   * Host-injected — was silently dropped in the first extraction pass (UAT-1/2:
   * raw label keys + broken stream presentation).
   */
  export let streamClient: unknown = undefined;

  // --- AI mode: timeline (gold shell S5a2a) ---
  /** Scrollable message list element, bindable for host scroll orchestration. */
  export let listEl: HTMLDivElement | null = null;
  /** Invisible staging block used to measure the first hydration batch. */
  export let historyStageMeasureEl: HTMLDivElement | null = null;
  export let onListScroll: (event: Event) => void = () => {};

  export let projectedTimelineItems: readonly TimelineItem[] = [];
  export let stagedHistoryTimelineItems: readonly TimelineItem[] = [];
  export let messagesCount = 0;
  export let historyHydrationInFlight = false;
  export let historyHydrationSwapPending = false;
  export let sessionId: string | null = null;

  /** Inline user-message edit: host-rendered form (CommentsPanel precedent). */
  export let editingMessageId: string | null = null;
  export let renderEditForm: Snippet<[{ messageId: string }]> | undefined =
    undefined;
  export let onStartEditMessage: (message: { id: string }) => void = () => {};

  /** Clipboard + markdown (host owns clipboard + ref-aware markdown render). */
  export let copyToClipboard: (
    text: string,
    html?: string,
  ) => Promise<boolean> = async () => false;
  export let renderMarkdownWithRefs: (text: string) => string = (t) => t;
  export let isCopied: (key: string) => boolean = () => false;
  export let markCopied: (key: string) => void = () => {};

  /** Checkpoint restore affordance on user messages (host-composed). */
  export let showCheckpointRestoreForMessage: (messageId: string) => boolean =
    () => false;
  export let openCheckpointPromptForMessage: (messageId: string) => void =
    () => {};
  export let getCheckpointPreviewTitle: (messageId: string) => string = () =>
    '';

  /** Generated-file cards (documents suite). */
  export let getGeneratedFileCards: (
    messageId: string,
  ) => ChatGeneratedFileCard[] = () => [];
  export let onGeneratedFileCard: (
    messageId: string,
    card: ChatGeneratedFileCard,
  ) => void = () => {};
  export let downloadGeneratedFile: (card: ChatGeneratedFileCard) => void =
    () => {};

  /** Runtime presentation hooks (host policy). */
  export let useUnifiedActiveRunPresentation: (message: unknown) => boolean =
    () => false;
  export let isSmoothStreamingModel: (
    modelId: string | null | undefined,
  ) => boolean = () => false;
  export let loadRuntimeDetails: (
    sessionId: string,
    messageId: string,
  ) => Promise<void> = async () => {};
  export let onTodoRuntime: ((payload: never) => void) | undefined = undefined;

  /** Message actions. */
  export let retryFromAssistant: (messageId: string) => void = () => {};
  export let setFeedback: (
    messageId: string,
    action: 'up' | 'down' | 'clear',
  ) => void = () => {};

  /** Attachments rendering (host resolves sources + lightbox). */
  export let getAttachmentImageSrc:
    | ((attachment: unknown) => string | Promise<string>)
    | undefined = undefined;
  export let openLightbox: (src: string, alt: string) => void = () => {};

  /** Checkpoint-restore icon (host-injected to keep icon set host-side). */
  export let renderRestoreIcon: Snippet | undefined = undefined;

  // --- AI mode: banners + confirms (gold shell S5a2b) ---
  export type LocalToolPermissionPromptLike = {
    toolCallId: string;
    request: { toolName: string };
  };
  export let pendingLocalToolPermissionPrompts: readonly LocalToolPermissionPromptLike[] =
    [];
  export let onLocalToolPermissionDecision: (
    prompt: LocalToolPermissionPromptLike,
    decision: 'allow_once' | 'deny_once' | 'allow_always' | 'deny_always',
  ) => void | Promise<void> = () => {};
  export let resolvePermissionPromptDetails: (
    prompt: LocalToolPermissionPromptLike,
  ) => Array<{ label: string; value: string }> = () => [];

  export let pendingCheckpointPrompt: { kind: string } | null = null;
  export let checkpointActionInFlight = false;
  export let confirmCheckpointPrompt: () => void | Promise<void> = () => {};
  export let cancelCheckpointPrompt: () => void | Promise<void> = () => {};

  export let errorMsg: string | null = null;

  // --- AI mode: todo-runtime bottom panel + lightbox (gold shell S5a2c1) ---
  export type TodoRuntimeTaskLike = {
    id?: string;
    title: string;
    status?: string;
  };
  export type TodoRuntimePanelLike = {
    todoId: string;
    title: string;
    conflictMessage: string | null;
    tasks: TodoRuntimeTaskLike[];
  };
  export let todoRuntimePanel: TodoRuntimePanelLike | null = null;
  export let todoRuntimeCollapsed = false;
  export let todoRuntimeDeleteInFlight = false;
  export let pendingTodoRuntimeDeleteConfirm = false;
  export let onDeleteTodoRuntime: () => void | Promise<void> = () => {};
  export let isRuntimeTaskDone: (status: string | undefined) => boolean = () =>
    false;
  /** Icons stay host-side (lucide): trash + collapse chevron. */
  export let renderTrashIcon: Snippet | undefined = undefined;
  export let renderChevronIcon: Snippet<[{ collapsed: boolean }]> | undefined =
    undefined;

  export let lightboxImage: { src: string; alt: string } | null = null;
  export let onCloseLightbox: () => void = () => {};

  // --- AI mode: composer region (gold shell S5a2c2) ---
  export let input = '';
  export let composerIsMultiline = false;
  export let composerMaxHeight = 40;
  export let composerEl: HTMLDivElement | null = null;
  export let onComposerKeyDown: (event: KeyboardEvent) => void = () => {};
  export let onComposerPaste: ((event: ClipboardEvent) => void) | undefined =
    undefined;
  export let onComposerChange: (event: CustomEvent<{ value: string }>) => void =
    () => {};

  /** Composer surface banners (host-domain errors, gold markup module-side). */
  export let sessionDocsError: string | null = null;
  export let googleDriveConnectionError: string | null = null;

  /** Attachment band above the input (documents suite). */
  export let attachmentBand: readonly unknown[] = [];
  export let getBandItemImageSrc:
    | ((item: unknown) => string | Promise<string>)
    | undefined = undefined;
  export let removeBandItem: (item: unknown) => void | Promise<void> = () => {};

  /**
   * Left controls: the "+" documents/contexts/tools popover is host domain
   * (drive wiring, tool registry) — injected as a snippet; the module renders
   * the gold ModelSelector next to it.
   */
  export let renderComposerMenu: Snippet | undefined = undefined;
  export let selectedModelSelectionKey = '';
  export let modelCatalogGroups: readonly unknown[] = [];
  export let modelCatalogModels: readonly unknown[] = [];
  export let selectedModelWidthCh = 18;
  export let onModelChange: (selection: {
    providerId: string;
    modelId: string;
  }) => void = () => {};

  /** Right actions: stop (while steering) + primary send/steer button. */
  export let showStopButton = false;
  export let stopInFlight = false;
  export let onStopAssistant: () => void = () => {};
  export let primaryDisabled = true;
  export let primaryShowsSteer = false;
  export let onPrimaryAction: () => void = () => {};
  export let renderStopIcon: Snippet | undefined = undefined;
  export let renderSteerIcon: Snippet | undefined = undefined;
  export let renderSendIcon: Snippet | undefined = undefined;
</script>

<div class="topai-chat-panel-shell flex flex-col h-full" bind:this={panelEl}>
  {#if mode === 'comments'}
    {#if commentHost}
      <CommentsPanel
        host={commentHost}
        contextType={commentContextType}
        contextId={commentContextId}
        sectionKey={commentSectionKey}
        sectionLabel={commentSectionLabel}
        bind:commentThreadId
        bind:commentLoading
        {labels}
        {renderComposerInput}
        {renderThreadMenuPopover}
      />
    {/if}
  {:else}
    <!-- AI mode: full chat panel with timeline, composer, etc. -->
    <div
      class="flex-1 min-h-0 relative"
    >
      <div
        class="h-full overflow-y-auto p-3 space-y-3 slim-scroll"
        style="scrollbar-gutter: stable;"
        bind:this={listEl}
        on:scroll={onListScroll}
      >
        {#snippet renderTimelineUserMessage(item: TimelineItem)}
            {#if item.kind === 'message' && item.message.role === 'user'}
              {@const m = item.message}
              <div class="flex flex-col items-end group">
                <div
                  class="chat-user-bubble max-w-[85%] rounded bg-primary text-white text-xs px-3 py-2 break-words w-full userMarkdown"
                >
                  {#if editingMessageId === m.id && renderEditForm}
                    {@render renderEditForm({ messageId: m.id })}
                  {:else}
                    {#if (m.content ?? '').trim().length > 0}
                      <Streamdown content={m.content ?? ''} />
                    {/if}
                  {/if}
                </div>
                <MessageAttachments
                  attachments={m.attachments ?? []}
                  onResolveSrc={getAttachmentImageSrc}
                  onEnlarge={(src: string, alt: string) => openLightbox(src, alt)}
                  enlargeLabel={labels('chat.attachments.enlarge')}
                />
                <div
                  class="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {#if showCheckpointRestoreForMessage(m.id)}
                    <button
                      class="chat-message-action-button inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
                      on:click={() => openCheckpointPromptForMessage(m.id)}
                      type="button"
                      aria-label={labels('chat.checkpoints.restoreFromMessage')}
                      title={getCheckpointPreviewTitle(m.id)}
                    >
                      {#if renderRestoreIcon}{@render renderRestoreIcon()}{/if}
                    </button>
                  {/if}
                  <MessageActions
                    role="user"
                    streamStatus="completed"
                    isCopied={isCopied(m.id)}
                    {labels}
                    onCopy={async () => {
                      const text = m.content ?? '';
                      const ok = await copyToClipboard(text, renderMarkdownWithRefs(text));
                      if (ok) markCopied(m.id);
                    }}
                    onEdit={() => onStartEditMessage(m)}
                  />
                </div>
              </div>
            {/if}
        {/snippet}

        {#snippet renderTimelineAssistantSegment(item: TimelineItem)}
              {@const m = item.message}
              <div class="flex justify-start group">
                <div class="max-w-[85%] w-full">
                  <StreamMessage
                    streamClient={streamClient as never}
                    {labels}
                    variant="chat"
                    streamId={item.key}
                    status={item.isTerminal ? 'completed' : 'processing'}
                    finalContent={item.segment.content}
                    smoothContentStreaming={isSmoothStreamingModel(m.model)}
                    subscriptionMode="passive"
                    initialEvents={item.segment.events}
                    initiallyExpanded={false}
                    deferCollapsedDetails={!useUnifiedActiveRunPresentation(item.message)}
                    onGeneratedFile={(card) => onGeneratedFileCard(m.id, card)}
                  />
                  {#if item.isTerminal && item.isLastAssistantSegment}
                    <GeneratedFileCardTray
                      cards={getGeneratedFileCards(m.id)}
                      onDownload={(card: ChatGeneratedFileCard) => void downloadGeneratedFile(card)}
                      downloadLabel={labels('common.download')}
                    />
                  {/if}
                  <MessageActions
                    role="assistant"
                    streamStatus={item.isTerminal ? 'completed' : 'processing'}
                    isLastAssistantSegment={item.isLastAssistantSegment}
                    isCopied={isCopied(item.key)}
                    feedbackVote={m.feedbackVote ?? null}
                    {labels}
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

        {#snippet renderTimelineRuntimeSegment(item: TimelineItem)}
              <div class="flex justify-start">
                <div class="max-w-[85%] w-full">
                  <StreamMessage
                    streamClient={streamClient as never}
                    {labels}
                    variant="chat"
                    streamId={item.key}
                    status={item.message._localStatus ??
                      (item.message.content ? 'completed' : 'processing')}
                    subscriptionMode="passive"
                    initialEvents={item.segment.events}
                    runtimeSummary={item.segment.runtimeSummary}
                    initiallyExpanded={false}
                    deferCollapsedDetails={!useUnifiedActiveRunPresentation(item.message)}
                    requestDeferredDetails={sessionId ? (() => { const sid = sessionId; return sid ? loadRuntimeDetails(sid, item.message.id) : Promise.resolve(); }) : undefined}
                    showRuntimeInlinePreview={item.isActiveRuntimeSegment}
                    acknowledgementText={item.acknowledgementText}
                    onTodoRuntime={onTodoRuntime}
                    onGeneratedFile={(card) => onGeneratedFileCard(item.message.id, card)}
                  />
                </div>
              </div>
        {/snippet}

        {#snippet renderTimelineItems(items: readonly TimelineItem[])}
          <ChatTimeline
            {items}
            renderUserMessage={renderTimelineUserMessage}
            renderAssistantSegment={renderTimelineAssistantSegment}
            renderRuntimeSegment={renderTimelineRuntimeSegment}
          />
        {/snippet}

        {#if stagedHistoryTimelineItems.length > 0}
          <div
            class="pointer-events-none invisible absolute inset-x-0 top-0 z-[-1] p-3 space-y-3"
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
          <div class="text-xs text-slate-500">{labels('common.loading')}</div>
        {:else if messagesCount === 0}
          <div class="text-xs text-slate-500">{labels('chat.chat.empty')}</div>
        {:else}
          <div class:invisible={historyHydrationSwapPending}>
            {@render renderTimelineItems(projectedTimelineItems)}
          </div>
        {/if}
        {#if pendingLocalToolPermissionPrompts.length > 0}
          {#each pendingLocalToolPermissionPrompts as prompt (prompt.toolCallId)}
            <div class="rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
              <div class="text-xs font-semibold text-slate-700">
                {labels('chat.tools.permissions.promptTitle')}
              </div>
              <div class="text-[11px] text-slate-600">
                {labels('chat.tools.permissions.promptDescription', {
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
                    void onLocalToolPermissionDecision(
                      prompt,
                      'allow_once',
                    )}
                >
                  {labels('chat.tools.permissions.allowOnce')}
                </button>
                <button
                  type="button"
                  class="chat-tool-permission-choice rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                  on:click={() =>
                    void onLocalToolPermissionDecision(
                      prompt,
                      'deny_once',
                    )}
                >
                  {labels('chat.tools.permissions.denyOnce')}
                </button>
                <button
                  type="button"
                  class="chat-tool-permission-choice rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100"
                  on:click={() =>
                    void onLocalToolPermissionDecision(
                      prompt,
                      'allow_always',
                    )}
                >
                  {labels('chat.tools.permissions.allowAlways')}
                </button>
                <button
                  type="button"
                  class="chat-tool-permission-choice rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:bg-red-100"
                  on:click={() =>
                    void onLocalToolPermissionDecision(
                      prompt,
                      'deny_always',
                    )}
                >
                  {labels('chat.tools.permissions.denyAlways')}
                </button>
              </div>
            </div>
          {/each}
        {/if}
        {#if pendingCheckpointPrompt}
          <div class="rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
            <div class="text-xs font-semibold text-slate-700">
              {pendingCheckpointPrompt.kind === 'retry'
                ? labels('chat.checkpoints.confirmRestoreBeforeRetry')
                : labels('chat.checkpoints.confirmRestoreBeforeAction')}
            </div>
            <div class="text-[11px] text-slate-600">
              {labels('chat.checkpoints.confirmRestoreDetails')}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="chat-checkpoint-choice rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                on:click={() => void confirmCheckpointPrompt()}
                disabled={checkpointActionInFlight}
              >
                {labels('chat.checkpoints.restoreCta')}
              </button>
              <button
                type="button"
                class="chat-checkpoint-choice rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                on:click={() => void cancelCheckpointPrompt()}
                disabled={checkpointActionInFlight}
              >
                {pendingCheckpointPrompt.kind === 'retry'
                  ? labels('chat.checkpoints.retryWithoutRestore')
                  : labels('chat.checkpoints.continueWithoutRestore')}
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
      </div>
    </div>
    {#if todoRuntimePanel}
      <div class="w-full border-t border-slate-200 bg-slate-50/70" data-testid="todo-runtime-panel">
        <div class="px-3 py-2">
          <div class="w-full flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xs font-semibold text-slate-700">
                {labels('chat.todoRuntimePanel.title')}
              </div>
              <div class="text-[11px] text-slate-500 truncate">
                {todoRuntimePanel.title || labels('chat.todoRuntimePanel.subtitle')}
              </div>
            </div>
            <div class="flex items-center gap-1">
              <button
                class="chat-danger-action-button text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
                type="button"
                disabled={todoRuntimeDeleteInFlight}
                on:click={() => (pendingTodoRuntimeDeleteConfirm = true)}
                aria-label={labels('chat.todoRuntimePanel.delete')}
                title={labels('chat.todoRuntimePanel.delete')}
                data-testid="todo-runtime-delete-button"
              >
                {#if renderTrashIcon}{@render renderTrashIcon()}{/if}
              </button>
              <button
                type="button"
                class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
                on:click={() => (todoRuntimeCollapsed = !todoRuntimeCollapsed)}
                aria-label={todoRuntimeCollapsed
                  ? labels('chat.todoRuntimePanel.expand')
                  : labels('chat.todoRuntimePanel.collapse')}
                title={todoRuntimeCollapsed
                  ? labels('chat.todoRuntimePanel.expand')
                  : labels('chat.todoRuntimePanel.collapse')}
                data-testid="todo-runtime-toggle-button"
              >
                {#if renderChevronIcon}{@render renderChevronIcon({ collapsed: todoRuntimeCollapsed })}{/if}
              </button>
            </div>
          </div>
          {#if !todoRuntimeCollapsed}
            <div class="mt-2 max-h-28 overflow-y-auto slim-scroll space-y-2 text-[11px] text-slate-700">
              {#if pendingTodoRuntimeDeleteConfirm}
                <div class="chat-delete-confirm-surface rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
                  <div class="text-xs font-semibold text-slate-700">
                    {labels('chat.todoRuntimePanel.confirmDelete')}
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="chat-delete-confirm-choice rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                      on:click={() => void onDeleteTodoRuntime()}
                      disabled={todoRuntimeDeleteInFlight}
                    >
                      {labels('common.delete')}
                    </button>
                    <button
                      type="button"
                      class="chat-delete-confirm-choice rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      on:click={() => (pendingTodoRuntimeDeleteConfirm = false)}
                      disabled={todoRuntimeDeleteInFlight}
                    >
                      {labels('common.cancel')}
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
                  {labels('chat.todoRuntimePanel.tasksLabel')} ({todoRuntimePanel.tasks.length})
                </div>
                {#if todoRuntimePanel.tasks.length === 0}
                  <div class="mt-1 text-[11px] text-slate-500">
                    {labels('chat.todoRuntimePanel.noTasks')}
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
                            ? labels('chat.todoRuntimePanel.completedTaskLabel')
                            : labels('chat.todoRuntimePanel.pendingTaskLabel')}
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
              <AttachmentBand
                items={attachmentBand as never}
                onResolveSrc={getBandItemImageSrc as never}
                onEnlarge={((item: { fileName: string }, src: string) => openLightbox(src, item.fileName)) as never}
                onRemove={((item: unknown) => void removeBandItem(item)) as never}
                removeLabel={labels('chat.documents.delete.ariaLabel')}
                enlargeLabel={labels('chat.attachments.enlarge')}
                loadingLabel={labels('common.loading')}
                errorLabel={labels('common.error')}
              />
              {#if renderComposerSurfaceInput}
                {@render renderComposerSurfaceInput()}
              {/if}
    {/snippet}

    {#snippet renderFloatingLayer()}
          <!-- floating layer: checkpoints panel and other overlays (mention menu moved to CommentsPanel) -->
    {/snippet}

    {#snippet renderLeftControls()}
          {#if renderComposerMenu}{@render renderComposerMenu()}{/if}
          <ModelSelector
            bind:value={selectedModelSelectionKey}
            groups={modelCatalogGroups as never}
            models={modelCatalogModels as never}
            widthCh={selectedModelWidthCh}
            {labels}
            onChange={onModelChange as never}
          />
    {/snippet}

    {#snippet renderRightActions()}
          {#if showStopButton}
            <button
              class="chat-composer-stop-button rounded text-slate-600 w-8 h-8 flex items-center justify-center hover:bg-slate-100 disabled:opacity-60"
              on:click={onStopAssistant}
              disabled={stopInFlight}
              type="button"
              aria-label="Stopper"
              title="Stopper"
            >
              {#if renderStopIcon}{@render renderStopIcon()}{/if}
            </button>
          {/if}
          <button
            class="rounded bg-primary hover:bg-primary/90 text-white w-8 h-8 flex items-center justify-center disabled:opacity-60"
            on:click={onPrimaryAction}
            disabled={primaryDisabled}
            type="button"
            aria-label={primaryShowsSteer
              ? labels('chat.steer.submit')
              : labels('common.send')}
            title={primaryShowsSteer
              ? labels('chat.steer.submit')
              : labels('common.send')}
            data-testid={primaryShowsSteer
              ? 'chat-composer-steer-button'
              : 'chat-composer-send-button'}
          >
            {#if primaryShowsSteer}
              {#if renderSteerIcon}{@render renderSteerIcon()}{/if}
            {:else}
              {#if renderSendIcon}{@render renderSendIcon()}{/if}
            {/if}
          </button>
    {/snippet}

    <ChatComposer
      mode="ai"
      value={input}
      disabled={false}
      isMultiline={composerIsMultiline}
      maxHeight={composerMaxHeight}
      surfaceEnabled={true}
      surfaceDisabled={false}
      ariaLabel={labels('chat.composer.ariaLabel')}
      tabIndex={0}
      bind:composerElement={composerEl}
      onKeyDown={onComposerKeyDown}
      onPaste={onComposerPaste}
      {renderComposerSurface}
      {renderFloatingLayer}
      {renderLeftControls}
      {renderRightActions}
    />
  {/if}
</div>

<ImageLightbox
  image={lightboxImage}
  onClose={onCloseLightbox}
  closeLabel={labels('chat.attachments.lightbox.close')}
  downloadLabel={labels('chat.attachments.lightbox.download')}
/>

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
