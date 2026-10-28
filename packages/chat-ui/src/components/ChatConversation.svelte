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

<div class="chat-conversation chat-conversation-{layout} flex h-full min-h-0 flex-col"
  data-session-id={state.sessionId} data-layout={layout} data-feature-steer={flags.steer}
  data-feature-retry={flags.retry} data-feature-stop={flags.stop} role="region" aria-label={labels('chat.panel.label')}>
  <ChatPanel {labels} featureFlags={flags}>
    {#snippet renderHeader()}
      {#if state.contextEntries.length || state.models.length || state.modelGroups.length}
        <div class="chat-conversation-header flex items-center gap-2 border-b border-slate-200 px-3 py-1.5">
          {#if state.contextEntries.length}
            <ChatContextPicker entries={state.contextEntries} {labels}
              onToggle={(entry) => commands.toggleContext(`${entry.type}:${entry.id ?? ''}`, entry.active === false)} />
          {/if}
          {#if state.models.length || state.modelGroups.length}
            <div class="ml-auto"><ModelSelector value={state.selectedModel} groups={state.modelGroups} models={state.models}
              {labels} onChange={(value) => commands.selectModel(`${value.providerId}::${value.modelId}`)} /></div>
          {/if}
        </div>
      {/if}
      {#if flags.workspaceScope && renderWorkspaceScope}{@render renderWorkspaceScope()}{/if}
      {#if flags.jobs && renderJobs}{@render renderJobs()}{/if}
      {#if flags.documents && renderDocuments}{@render renderDocuments()}{/if}
    {/snippet}
    {#snippet renderTimeline()}
      <div class="chat-conversation-timeline flex min-h-0 flex-1 flex-col overflow-y-auto">
        {#if flags.comments && renderComments}
          {@render renderComments()}
        {:else if state.items.length === 0}
          <div class="flex flex-1 items-center justify-center p-6 text-xs text-slate-400">{labels('chat.sessions.none')}</div>
        {:else}
          <ChatTimeline items={[...state.items]}>
            {#snippet renderUserMessage(item)}
              <div class="chat-conversation-user-message px-4 py-2">
                {#if editingId === item.message.id}
                  <textarea aria-label={labels('chat.message.edit')} bind:value={editingContent}></textarea>
                  <button type="button" on:click={async () => { await commands.edit(item.message.id, editingContent); editingId = null; }}>{labels('common.save')}</button>
                  <button type="button" on:click={() => editingId = null}>{labels('common.cancel')}</button>
                {:else}
                  <div class="ml-auto max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900">{item.message.content ?? ''}</div>
                {/if}
                {#if item.message.attachments?.length}<MessageAttachments attachments={[...item.message.attachments]} />{/if}
                <MessageActions role="user" {labels} isCopied={copiedKey === item.key}
                  onCopy={() => void copy(item.message.content ?? '', item.key)}
                  onEdit={() => { editingId = item.message.id; editingContent = item.message.content ?? ''; }} />
              </div>
            {/snippet}
            {#snippet renderAssistantSegment(item)}
              {#if item.kind === 'assistant-segment'}
                <div class="chat-conversation-assistant-segment px-4 py-2">
                  <StreamMessage streamId={item.streamId} status={item.isTerminal ? 'completed' : 'processing'}
                    {labels} variant="chat" subscriptionMode="passive" initialEvents={[...item.segment.events]}
                    finalContent={item.isTerminal ? item.segment.content : undefined} />
                  {#if item.isLastAssistantSegment}
                    <MessageActions role="assistant" {labels} isLastAssistantSegment={true}
                      streamStatus={item.isTerminal ? 'completed' : 'processing'} isCopied={copiedKey === item.key}
                      onCopy={() => void copy(item.segment.content, item.key)}
                      onRegenerate={flags.retry ? () => void commands.retry(item.message.id) : undefined}
                      onFeedback={(vote) => void commands.setFeedback(item.message.id, vote)} />
                  {/if}
                </div>
              {/if}
            {/snippet}
            {#snippet renderRuntimeSegment(item)}
              {#if item.kind === 'runtime-segment'}
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
