<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ChatConversationSnapshots, ChatConversationCommands } from '../conversation.js';
  import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
  import ChatPanel from './ChatPanel.svelte';
  import ChatTimeline from './ChatTimeline.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import ModelSelector from './ModelSelector.svelte';
  import MessageActions from './MessageActions.svelte';
  import ChatContextPicker from './ChatContextPicker.svelte';
  import StreamMessage from './StreamMessage.svelte';
  import AttachmentBand from '../documents/AttachmentBand.svelte';
  import MessageAttachments from '../documents/MessageAttachments.svelte';

  export type ChatConversationFeatures = {
    attachments?: boolean; comments?: boolean; documents?: boolean; jobs?: boolean;
    workspaceScope?: boolean; steer?: boolean; retry?: boolean; stop?: boolean;
  };
  export let snapshots: ChatConversationSnapshots;
  export let commands: ChatConversationCommands;
  export let labels: ChatUiLabelResolver = (key) => key;
  export let layout: 'inline' | 'docked' | 'floating' = 'inline';
  export let features: ChatConversationFeatures = {};
  export let renderComments: Snippet | undefined = undefined;
  export let renderDocuments: Snippet | undefined = undefined;
  export let renderJobs: Snippet | undefined = undefined;
  export let renderWorkspaceScope: Snippet | undefined = undefined;
  let editingId: string | null = null;
  let editingContent = '';
  let copiedKey: string | null = null;
  $: state = $snapshots;
  $: flags = { attachments: false, comments: false, documents: false, jobs: false,
    workspaceScope: false, steer: true, retry: true, stop: true, ...features };
  const copy = async (content: string, key: string) => {
    await navigator.clipboard?.writeText(content);
    copiedKey = key;
    setTimeout(() => { copiedKey = null; }, 1500);
  };
  const send = () => flags.steer && state.activeStreamId ? commands.steer() : commands.send();
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
  };
</script>

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
