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
  import ChatTimeline from './ChatTimeline.svelte';
  import MessageActions from './MessageActions.svelte';
  import StreamMessage from './StreamMessage.svelte';
  import GeneratedFileCardTray from '../documents/GeneratedFileCardTray.svelte';
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
        class="h-full overflow-y-auto p-3 space-y-2 slim-scroll"
        style="scrollbar-gutter: stable;"
        bind:this={listEl}
        on:scroll={onListScroll}
      >
        {#snippet renderTimelineMessageAttachments(item: TimelineItem)}
          {#if item.kind === 'message' && item.message.role === 'user'}
            <MessageAttachments
              attachments={item.message.attachments ?? []}
              onResolveSrc={getAttachmentImageSrc}
              onEnlarge={(src: string, alt: string) => openLightbox(src, alt)}
              enlargeLabel={labels('chat.attachments.enlarge')}
            />
          {/if}
        {/snippet}

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
          <div class="text-xs text-slate-500">{labels('common.loading')}</div>
        {:else if messagesCount === 0}
          <div class="text-xs text-slate-500">{labels('chat.chat.empty')}</div>
        {:else}
          <div class:invisible={historyHydrationSwapPending}>
            {@render renderTimelineItems(projectedTimelineItems)}
          </div>
        {/if}
        <!-- S5a2b seam: permission prompts, checkpoint confirm, error banner,
             todo-runtime confirm land next. -->
        <slot name="ai-rest" />
      </div>
    </div>
    <!-- S5a2c seam: composer region (attachment band, composer, model selector). -->
    <slot name="ai-composer" />
  {/if}
</div>
