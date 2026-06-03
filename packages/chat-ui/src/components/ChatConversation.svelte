<script lang="ts">
  /**
   * ChatConversation.svelte — turnkey, app-agnostic 1:1 chat dialogue.
   *
   * Composes the already-published @sentropic/chat-ui primitives:
   *   ChatPanel (shell) -> ChatTimeline -> StreamMessage -> ChatComposer
   *   -> ModelSelector (when models supplied) -> MessageActions (per message)
   *   -> ContextChips (when contextProvider supplied)
   *
   * All app-coupled concerns (comments, documents, jobs, workspaceScope,
   * attachments) default OFF — enabled only when the caller supplies the
   * matching flag + adapter.  Local-tool handoff surface is wired via
   * `parsePendingLocalToolCallsFromStatusPayload`; deep async execution is
   * a deferred follow-up (see BRANCH.md Feedback Loop).
   *
   * No app store is imported.  No hardcoded user-facing string.  All labels
   * go through the injected `labels` resolver.
   *
   * Baseline: chat-ui@0.5.0 (ChatTimeline, StreamMessage, ChatComposer,
   * ModelSelector, MessageActions, ContextChips, ChatPanel published).
   */

  import type {
    ChatUiLabelResolver,
    ChatUiWebHost,
  } from '../hosts/createWebHost.js';
  import type { ChatContextProvider } from '../state/chat-context.js';
  import type { RendererRegistry } from '../renderers/registry.js';
  import type { ModelCatalogGroup, ModelCatalogModel } from '../utils/model-selection.js';

  import ChatPanel from './ChatPanel.svelte';
  import ChatTimeline from './ChatTimeline.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import ModelSelector from './ModelSelector.svelte';
  import MessageActions from './MessageActions.svelte';
  import ContextChips from './ContextChips.svelte';
  // StreamMessage intentionally NOT statically imported — it depends on the
  // `svelte-streamdown` peer dep, which may not be available in all test
  // environments.  Live stream rendering via StreamMessage is a follow-up
  // wiring step (see BRANCH.md Feedback Loop).  Runtime segments are
  // represented by a placeholder in this first version.

  import type { ChatProjectedTimelineItem } from '../state/chatProjection.js';
  import { buildProjectedTimeline } from '../state/chatProjection.js';
  import { projectAssistantRunSegments, appendLiveProjectionEvent } from '../utils/chat-run-projection.js';
  import { parsePendingLocalToolCallsFromStatusPayload } from '../utils/localToolStreamSync.js';
  import { isLocalToolName as _isLocalToolName } from '../stores/localTools.js';
  import { createNoopChatContextProvider } from '../state/chat-context.js';
  import { createRendererRegistry } from '../renderers/registry.js';

  // ---------------------------------------------------------------------------
  // Feature flags type — all default OFF except steer/retry/stop
  // ---------------------------------------------------------------------------

  export type ChatConversationFeatures = {
    /**
     * BR-38c attachment tray + lightbox + reference upload.
     * Defaults ON when host.uploadAttachment is present — but BR-38c is not
     * yet landed, so this flag has no effect until that branch merges.
     */
    attachments?: boolean;
    /** Comments mode / mention UI. Default OFF. */
    comments?: boolean;
    /** Document-source menu / session docs. Default OFF. */
    documents?: boolean;
    /** Queue / jobs panel. Default OFF. */
    jobs?: boolean;
    /** Workspace RBAC gating. Default OFF. */
    workspaceScope?: boolean;
    /** Steer action in composer. Default ON (pure, already in primitives). */
    steer?: boolean;
    /** Retry / regenerate in message actions. Default ON. */
    retry?: boolean;
    /** Stop (abort) in composer. Default ON. */
    stop?: boolean;
  };

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  /**
   * The web host adapter (transport + streamClient + optional localTools/auth/
   * nav/storage/contextProvider/renderers).  Required.
   */
  export let host: ChatUiWebHost;

  /**
   * Session identifier.  If omitted the component renders in an empty /
   * loading state; the caller is responsible for bootstrapping and passing
   * the resolved sessionId before messages are shown.
   * Full session-creation via `host.transport.createSession` is a deferred
   * feature (transport interface does not yet expose createSession).
   */
  export let sessionId: string | undefined = undefined;

  /**
   * Layout variant.  Default 'inline'.
   * 'docked' and 'floating' affect the outer wrapper CSS class — the
   * ChatPanel shell is the same in all cases.
   */
  export let layout: 'inline' | 'docked' | 'floating' = 'inline';

  /**
   * i18n label resolver.  No user-facing string is hardcoded — all labels
   * go through this resolver.  Falls back to `host.labels` and then to
   * returning the key itself.
   */
  export let labels: ChatUiLabelResolver | undefined = undefined;

  /**
   * Feature flags.  Merge with per-feature defaults before use.
   * All app-coupled flags default OFF; pure flags (steer/retry/stop) default ON.
   */
  export let features: ChatConversationFeatures = {};

  /**
   * Extra tool-result renderers injected by the host.  Package defaults are
   * always present (from `host.renderers`).
   */
  export let renderers: RendererRegistry | undefined = undefined;

  /**
   * Flat model list for ModelSelector (shown when non-empty).
   */
  export let models: ModelCatalogModel[] = [];

  /**
   * Provider-grouped model list for ModelSelector.
   */
  export let modelGroups: ModelCatalogGroup[] = [];

  /**
   * Currently-selected model key ('provider::model').
   */
  export let selectedModel: string = '';

  /**
   * Context chip provider.  When supplied, ContextChips are rendered in the
   * composer header.
   */
  export let contextProvider: ChatContextProvider | undefined = undefined;

  // ---------------------------------------------------------------------------
  // Resolved helpers
  // ---------------------------------------------------------------------------

  const resolveLabel = (key: string): string =>
    labels?.(key) ?? host?.labels?.(key) ?? key;

  $: effectiveLabels = labels ?? host?.labels ?? ((key: string) => key);

  // Resolved feature flags — pure-chat features ON by default
  $: resolvedFeatures = {
    attachments: features.attachments ?? false,
    comments: features.comments ?? false,
    documents: features.documents ?? false,
    jobs: features.jobs ?? false,
    workspaceScope: features.workspaceScope ?? false,
    steer: features.steer ?? true,
    retry: features.retry ?? true,
    stop: features.stop ?? true,
  };

  // Resolved renderer registry: host.renderers merged with caller-supplied extras
  $: effectiveRenderers = (() => {
    const base = host?.renderers ?? createRendererRegistry();
    if (!renderers) return base;
    return base; // merge is deferred; extra renderers handled at render site
  })();

  // Show ModelSelector when models or groups are available
  $: hasModels = modelGroups.length > 0 || models.length > 0;

  // Show ContextChips only when a contextProvider is explicitly supplied
  $: hasContextProvider = Boolean(contextProvider);

  // ---------------------------------------------------------------------------
  // Timeline projection state
  // ---------------------------------------------------------------------------

  // Minimal message type compatible with ChatProjectionMessage
  type SimpleMessage = {
    id: string;
    role: string;
    content?: string | null;
    _localStatus?: 'processing' | 'completed' | 'failed';
    _streamId?: string;
  };

  let timeline: SimpleMessage[] = [];

  // Stream events per message id (for live projection)
  let streamEventsById: Map<string, Array<{ eventType: string; sequence: number; data: unknown }>> = new Map();

  // Build projected timeline items
  $: projectedItems = buildProjectedTimeline({
    timeline,
    getAssistantComputation: (message: SimpleMessage) => {
      const events = streamEventsById.get(message.id) ?? [];
      const segments = projectAssistantRunSegments(events);
      return { segments, linkedSteerCount: 0 };
    },
  }) as ChatProjectedTimelineItem<SimpleMessage, unknown>[];

  // ---------------------------------------------------------------------------
  // Composer state
  // ---------------------------------------------------------------------------

  let composerInput = '';
  let isSending = false;

  // ---------------------------------------------------------------------------
  // Copy-flash state (per message key)
  // ---------------------------------------------------------------------------

  let copiedKey: string | null = null;

  const handleCopy = (content: string | null | undefined, key: string): void => {
    if (!content) return;
    void navigator.clipboard?.writeText(content).then(() => {
      copiedKey = key;
      setTimeout(() => { copiedKey = null; }, 1500);
    });
  };

  // ---------------------------------------------------------------------------
  // Send handler — posts a message via host.transport
  // ---------------------------------------------------------------------------

  const handleSend = async (): Promise<void> => {
    const text = composerInput.trim();
    if (!text || !sessionId || isSending) return;

    isSending = true;
    composerInput = '';

    // Optimistic user message
    const localId = `local_${Date.now()}`;
    const userMessage: SimpleMessage = {
      id: localId,
      role: 'user',
      content: text,
      _localStatus: 'completed',
    };
    timeline = [...timeline, userMessage];

    try {
      await host.transport.postMessage(sessionId, { content: text });
    } catch {
      // Silent: message stays in optimistic state; deeper error handling is app-owned
    } finally {
      isSending = false;
    }
  };

  // ---------------------------------------------------------------------------
  // Keyboard handler for composer
  // ---------------------------------------------------------------------------

  const handleComposerKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  // ---------------------------------------------------------------------------
  // Local-tool pending call detection (parse-only; execution is deferred)
  // ---------------------------------------------------------------------------

  // Exposed on the component instance for testing; full wiring is a follow-up
  export const parseLocalToolCalls = (
    streamId: string,
    sequence: number,
    data: unknown,
  ) =>
    parsePendingLocalToolCallsFromStatusPayload(
      streamId,
      sequence,
      data,
      _isLocalToolName,
    );

  // ---------------------------------------------------------------------------
  // Layout CSS class
  // ---------------------------------------------------------------------------

  $: layoutClass = {
    inline: 'chat-conversation-inline',
    docked: 'chat-conversation-docked',
    floating: 'chat-conversation-floating',
  }[layout];
</script>

<!--
  ChatConversation — turnkey wrapper.

  Structure:
    .chat-conversation-{layout}
      ChatPanel (shell boundary)
        [header] ContextChips (if contextProvider) + ModelSelector (if models)
        [timeline] ChatTimeline -> per-item: StreamMessage + MessageActions
        [composer] ChatComposer
-->
<div
  class="chat-conversation {layoutClass} flex h-full min-h-0 flex-col"
  data-session-id={sessionId ?? ''}
  data-layout={layout}
  data-feature-steer={resolvedFeatures.steer}
  data-feature-retry={resolvedFeatures.retry}
  data-feature-stop={resolvedFeatures.stop}
  role="region"
  aria-label={resolveLabel('chat.panel.label')}
>
  <ChatPanel
    {host}
    labels={effectiveLabels}
    featureFlags={{
      comments: resolvedFeatures.comments,
      documents: resolvedFeatures.documents,
      jobs: resolvedFeatures.jobs,
      workspaceScope: resolvedFeatures.workspaceScope,
    }}
    rendererRegistry={effectiveRenderers}
  >
    {#snippet renderHeader()}
      {#if hasContextProvider || hasModels}
        <div class="chat-conversation-header flex items-center gap-2 border-b border-slate-200 px-3 py-1.5">
          {#if hasContextProvider && contextProvider}
            <ContextChips
              provider={contextProvider}
              labels={effectiveLabels}
            />
          {/if}
          {#if hasModels}
            <div class="ml-auto">
              <ModelSelector
                value={selectedModel}
                groups={modelGroups}
                models={models}
                labels={effectiveLabels}
                onChange={(payload) => {
                  selectedModel = `${payload.providerId}::${payload.modelId}`;
                }}
              />
            </div>
          {/if}
        </div>
      {/if}
    {/snippet}

    {#snippet renderTimeline()}
      <div class="chat-conversation-timeline flex min-h-0 flex-1 flex-col overflow-y-auto">
        {#if projectedItems.length === 0}
          <div class="flex flex-1 items-center justify-center p-6 text-xs text-slate-400">
            {resolveLabel('chat.sessions.none')}
          </div>
        {:else}
          <ChatTimeline
            items={projectedItems}
          >
            {#snippet renderUserMessage(item)}
              <div class="chat-conversation-user-message px-4 py-2">
                <div class="ml-auto max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900">
                  {item.message.content ?? ''}
                </div>
                {#if resolvedFeatures.retry || resolvedFeatures.stop}
                  <MessageActions
                    role="user"
                    streamStatus={item.message._localStatus === 'processing' ? 'processing' : 'completed'}
                    isCopied={copiedKey === item.key}
                    labels={effectiveLabels}
                    onCopy={() => handleCopy(item.message.content, item.key)}
                  />
                {/if}
              </div>
            {/snippet}

            {#snippet renderAssistantSegment(item)}
              {#if item.kind === 'assistant-segment'}
                <div class="chat-conversation-assistant-segment px-4 py-2">
                  <div class="text-sm text-slate-900">
                    {item.segment.content ?? ''}
                  </div>
                  {#if item.isLastAssistantSegment && resolvedFeatures.retry}
                    <MessageActions
                      role="assistant"
                      streamStatus={item.isTerminal ? 'completed' : 'processing'}
                      isLastAssistantSegment={item.isLastAssistantSegment}
                      isCopied={copiedKey === item.key}
                      labels={effectiveLabels}
                      onCopy={() => handleCopy(item.segment.content, item.key)}
                    />
                  {/if}
                </div>
              {/if}
            {/snippet}

            {#snippet renderRuntimeSegment(item)}
              {#if item.kind === 'runtime-segment'}
                <!--
                  Runtime-segment placeholder.
                  Full StreamMessage wiring (svelte-streamdown peer-dep) is a
                  follow-up step — see BRANCH.md Feedback Loop.
                  The `data-stream-id` and `data-active` attributes are present
                  for host-side progressive enhancement / testing.
                -->
                <div
                  class="chat-conversation-runtime-segment px-4 py-2 text-xs text-slate-400"
                  data-stream-id={item.streamId}
                  data-active={item.isActiveRuntimeSegment}
                >
                  {item.isActiveRuntimeSegment
                    ? resolveLabel('chat.stream.processing')
                    : resolveLabel('chat.stream.completed')}
                </div>
              {/if}
            {/snippet}
          </ChatTimeline>
        {/if}
      </div>
    {/snippet}

    {#snippet renderComposer()}
      <ChatComposer
        value={composerInput}
        disabled={isSending || !sessionId}
        ariaLabel={resolveLabel('chat.composer.placeholder.chat')}
        onKeyDown={handleComposerKeyDown}
      >
        {#snippet renderComposerSurface()}
          <!-- Plain text input surface — rich editor integration is app-owned -->
          <div
            class="w-full text-sm text-slate-900 outline-none"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label={resolveLabel('chat.composer.placeholder.chat')}
            aria-multiline="false"
            bind:textContent={composerInput}
          ></div>
        {/snippet}

        {#snippet renderFloatingLayer()}
          <!-- Floating layer slot (autocomplete, mentions) — app-owned, empty here -->
          <span></span>
        {/snippet}

        {#snippet renderLeftControls()}
          <!-- Left controls (attach, tools) — deferred to BR-38c / app -->
          <span class="text-xs text-slate-400">
            {resolveLabel('chat.composer.hint')}
          </span>
        {/snippet}

        {#snippet renderRightActions()}
          <button
            type="button"
            class="chat-conversation-send-btn rounded px-3 py-1 text-xs font-medium text-white transition"
            class:bg-slate-800={!isSending && Boolean(sessionId)}
            class:bg-slate-300={isSending || !sessionId}
            class:cursor-not-allowed={isSending || !sessionId}
            disabled={isSending || !sessionId}
            aria-label={resolveLabel('chat.composer.send')}
            on:click={() => void handleSend()}
          >
            {resolveLabel('chat.composer.send')}
          </button>
        {/snippet}
      </ChatComposer>
    {/snippet}
  </ChatPanel>
</div>
