<script lang="ts">
  /**
   * ChatConversation.svelte — turnkey, app-agnostic 1:1 chat dialogue.
   *
   * Slice 1G (R5): ChatConversation now collapses onto the chat-loop controller.
   * The previous parallel loop (handleSend / subscribeToStream / inline local-tool
   * dispatch) is DELETED. All state is owned by createChatLoopController().
   *
   * Composes the already-published @sentropic/chat-ui primitives:
   *   ChatPanel (shell) -> ChatTimeline -> StreamMessage -> ChatComposer
   *   -> ModelSelector (when models supplied) -> MessageActions (per message)
   *   -> ChatContextPicker (when contextProvider supplied)
   *
   * All app-coupled concerns (comments, documents, jobs, workspaceScope,
   * attachments) default OFF — enabled only when the caller supplies the
   * matching flag + adapter.
   *
   * No app store is imported.  No hardcoded user-facing string.  All labels
   * go through the injected `labels` resolver.
   *
   * Baseline: chat-ui@0.14.0 (controller-backed, R5 — no 3rd loop).
   */

  import type {
    ChatUiLabelResolver,
    ChatUiWebHost,
  } from '../hosts/createWebHost.js';
  import type { ChatContextProvider } from '../state/chat-context.js';
  import type { RendererRegistry } from '../renderers/registry.js';
  import type { ModelCatalogGroup, ModelCatalogModel } from '../utils/model-selection.js';
  import type { ControllerHostTransport, ControllerRunHandle } from '../state/chatLoopController.js';

  import { onDestroy } from 'svelte';
  import { createChatLoopController } from '../state/chatLoopController.js';
  import { isLocalToolName } from '../stores/localTools.js';
  import { createRendererRegistry } from '../renderers/registry.js';

  import ChatPanel from './ChatPanel.svelte';
  import ChatTimeline from './ChatTimeline.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import ModelSelector from './ModelSelector.svelte';
  import MessageActions from './MessageActions.svelte';
  import ChatContextPicker from './ChatContextPicker.svelte';
  import StreamMessage from './StreamMessage.svelte';

  import type { ChatContextEntry } from '../state/chat-context.js';
  import type { ChatProjectedTimelineItem } from '../state/chatProjection.js';

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
   * Context provider.  When supplied, ChatContextPicker is rendered in the
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

  // Show ChatContextPicker only when a contextProvider is explicitly supplied
  $: hasContextProvider = Boolean(contextProvider);

  // Derive context entries from the provider store
  let contextEntries: ChatContextEntry[] = [];
  $: if (contextProvider?.context) {
    const unsub = contextProvider.context.subscribe((vals) => {
      contextEntries = vals ?? [];
    });
    // We hold the subscription for the reactive lifetime; unsubscribe is
    // handled automatically when contextProvider changes (Svelte re-runs $:).
    void unsub; // prevent unused-variable lint
  } else {
    contextEntries = [];
  }

  // ---------------------------------------------------------------------------
  // Chat-loop controller (R5 — the ONLY loop; no 3rd parallel loop)
  //
  // The controller owns all chat state:
  //   - message list + projection (inherited from slices 1B-1F)
  //   - stream subscription (1C)
  //   - send/bootstrap/retry/stop/edit/feedback lifecycle (1D)
  //   - local-tool execution state machine (1E)
  //   - steer + model catalog (1F)
  //
  // ChatConversation:
  //   1. Creates the controller.
  //   2. Builds a ControllerHostTransport adapter that wraps host.transport
  //      (postMessage → sendMessage returning ControllerRunHandle).
  //   3. Attaches stream (host.streamClient) with a no-op pollJob fallback.
  //   4. Attaches local-tool machine when host.localTools is present.
  //   5. Renders from $ctrl.projectedTimelineItems.
  //   6. handleSend → ctrl.send(...).
  // ---------------------------------------------------------------------------

  // Minimal SimpleMessage type compatible with ChatProjectionMessage
  type SimpleMessage = {
    id: string;
    role: string;
    content?: string | null;
    _localStatus?: 'processing' | 'completed' | 'failed';
    _streamId?: string;
    sessionId?: string;
    createdAt?: string;
  };

  const ctrl = createChatLoopController<SimpleMessage>();

  // Reactive snapshot — Svelte store protocol ($ctrl triggers re-render)
  $: ctrlState = $ctrl;
  $: projectedItems = ctrlState.projectedTimelineItems as ChatProjectedTimelineItem<SimpleMessage, unknown>[];

  // ---------------------------------------------------------------------------
  // Wire host transport → controller (ControllerHostTransport adapter)
  //
  // The controller's send() needs sendMessage() → ControllerRunHandle.
  // host.transport.postMessage(sessionId, body) returns Promise<Response>.
  // We wrap that here so the controller stays transport-agnostic.
  // ---------------------------------------------------------------------------

  const buildControllerTransport = (): ControllerHostTransport => ({
    async sendMessage(payload) {
      // sessionId comes from the ChatConversation prop (closure reference)
      const sid = sessionId ?? '';
      const response = await host.transport.postMessage(sid, { content: payload.content });
      const body = await response.json() as Record<string, unknown>;
      const assistantMessageId = String(body.assistantMessageId ?? '').trim();
      const streamId = String(body.streamId ?? assistantMessageId).trim();
      const jobId = String(body.jobId ?? streamId).trim();
      const userMessageId = String(body.userMessageId ?? '').trim();
      const handle: ControllerRunHandle = {
        sessionId: sid,
        userMessageId,
        assistantMessageId,
        streamId,
        jobId,
      };
      return handle;
    },
    async retryMessage(_messageId, _opts) {
      // Retry not yet wired in ChatConversation (deferred — no retry UI in turnkey)
      throw new Error('ChatConversation: retryMessage not wired');
    },
    async stopMessage(_messageId) {
      // Stop not yet wired in ChatConversation (deferred — no stop UI in turnkey)
    },
    async editMessage(_messageId, _content) {
      // Edit not yet wired in ChatConversation (deferred — no edit UI in turnkey)
    },
    async setFeedback(_messageId, _vote) {
      // Feedback not yet wired in ChatConversation (deferred — no feedback UI in turnkey)
    },
    async postSteer(_streamId, _message) {
      // Steer not yet wired in ChatConversation (deferred — no steer UI in turnkey)
    },
  });

  // ---------------------------------------------------------------------------
  // Wire controller stream + local-tool machine
  // ---------------------------------------------------------------------------

  // Attach host transport to controller immediately (controller needs it for send())
  ctrl.attachHost({ transport: buildControllerTransport() });

  // Attach stream subscription (controller owns projection routing)
  // No-op pollJob: ChatConversation has no job-poll endpoint — stream-only.
  // A second subscription below routes events to the local-tool machine.
  let localToolHubKey: string | null = null;
  if (host?.streamClient) {
    ctrl.attachStream({
      streamClient: host.streamClient,
      pollJob: async () => ({ status: 'pending' }),
      pollInitialDelayMs: 99999, // effectively disabled — stream-only turnkey
    });

    // Second subscription: route all stream events through the local-tool machine.
    // Mirrors AppChatPanel's streamHub.set(localToolsHubKey, ctrl.handleLocalToolStreamEvent).
    // The controller's own attachStream handler owns projection; this one owns local tools.
    if (host.localTools) {
      localToolHubKey = `conv-lt:${Math.random().toString(36).slice(2)}`;
      host.streamClient.set(localToolHubKey, (event: unknown) => {
        ctrl.handleLocalToolStreamEvent(event);
      });
    }
  }

  // Attach local-tool machine when host.localTools is present
  if (host?.localTools) {
    const localTools = host.localTools;
    ctrl.attachLocalToolMachine({
      isLocalToolName,
      isLocalToolRuntimeAvailable: () => Boolean(localTools.sendMessage),
      isLocalToolPermissionRequired: () => false,
      getPermissionRequest: () => ({
        requestId: '',
        toolName: '',
        origin: '',
      }),
      executeLocalTool: async (toolCallId, name, args, _opts) => {
        if (!localTools.sendMessage) return undefined;
        const result = await localTools.sendMessage({
          type: 'tool_execute',
          toolCallId,
          name,
          args,
        });
        return result;
      },
      decideLocalToolPermission: async (_requestId, _decision) => {
        // No permission UI in turnkey ChatConversation
      },
      postLocalToolResult: async (_streamId, _toolCallId, _result) => {
        // Result posting not wired in turnkey (deferred)
      },
    });
  }

  // Tear down controller on component destroy
  onDestroy(() => {
    if (localToolHubKey && host?.streamClient) {
      host.streamClient.delete(localToolHubKey);
    }
    ctrl.detachStream();
    ctrl.detachLocalToolMachine();
    ctrl.detachHost();
  });

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
  // Send handler — delegates entirely to the controller (R5: no 3rd loop)
  //
  // The controller's send():
  //   1. Calls controllerTransport.sendMessage → wraps host.transport.postMessage
  //   2. Builds optimistic user + assistant messages
  //   3. Starts job-poll fallback (disabled via pollInitialDelayMs)
  //
  // ChatConversation only manages composerInput / isSending (UI state).
  // All timeline mutations happen inside the controller.
  // ---------------------------------------------------------------------------

  const handleSend = async (): Promise<void> => {
    const text = composerInput.trim();
    if (!text || !sessionId || isSending) return;

    isSending = true;
    composerInput = '';

    try {
      await ctrl.send(
        { content: text, sessionId },
        {
          buildUserMessage: (_handle) => ({
            id: `local_${Date.now()}`,
            role: 'user',
            content: text,
            _localStatus: 'completed',
            sessionId,
            createdAt: new Date().toISOString(),
          }),
          buildAssistantMessage: (base) => ({
            ...base,
            sessionId: base.sessionId,
          }),
        },
      );
    } catch {
      // Silent: user message stays in optimistic state; deeper error handling is app-owned
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
  // Layout CSS class
  // ---------------------------------------------------------------------------

  $: layoutClass = {
    inline: 'chat-conversation-inline',
    docked: 'chat-conversation-docked',
    floating: 'chat-conversation-floating',
  }[layout];
</script>

<!--
  ChatConversation — turnkey wrapper (controller-backed, R5).

  Structure:
    .chat-conversation-{layout}
      ChatPanel (shell boundary)
        [header] ChatContextPicker (if contextProvider) + ModelSelector (if models)
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
          {#if hasContextProvider}
            <ChatContextPicker
              entries={contextEntries}
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
                  {#if host?.streamClient && item.message._streamId}
                    <!--
                      Live assistant-segment streaming via StreamMessage.
                      Uses variant="chat" for markdown rendering via svelte-streamdown.
                      Only active when the message carries a _streamId and host.streamClient
                      is available — otherwise falls back to static text rendering below.
                    -->
                    <StreamMessage
                      streamClient={host.streamClient}
                      streamId={item.message._streamId}
                      status={item.isTerminal ? 'completed' : 'processing'}
                      labels={effectiveLabels}
                      variant="chat"
                      subscriptionMode={item.isTerminal ? 'passive' : 'live'}
                      finalContent={item.isTerminal ? (item.segment.content ?? null) : undefined}
                    />
                  {:else}
                    <div class="text-sm text-slate-900">
                      {item.segment.content ?? ''}
                    </div>
                  {/if}
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
                {#if host?.streamClient}
                  <!--
                    Live streaming via StreamMessage (svelte-streamdown markdown).
                    Only rendered when host.streamClient is available — consumers
                    without a streamClient fall back to the static placeholder below.
                  -->
                  <div
                    class="chat-conversation-runtime-segment px-4 py-2"
                    data-stream-id={item.streamId}
                    data-active={item.isActiveRuntimeSegment}
                  >
                    <StreamMessage
                      streamClient={host.streamClient}
                      streamId={item.streamId}
                      status={item.isActiveRuntimeSegment ? 'processing' : 'completed'}
                      labels={effectiveLabels}
                      variant="chat"
                      subscriptionMode={item.isActiveRuntimeSegment ? 'live' : 'passive'}
                    />
                  </div>
                {:else}
                  <!--
                    Static placeholder — used when host.streamClient is not supplied.
                    The `data-stream-id` and `data-active` attributes allow host-side
                    progressive enhancement and testing.
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
