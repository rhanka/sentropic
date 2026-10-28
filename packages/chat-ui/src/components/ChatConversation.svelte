<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ChatConversationSnapshots, ChatConversationCommands } from '../conversation.js';
  import type { ChatUiLabelResolver } from '@sentropic/chat-runtime/hosts/createWebHost';
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
  $: composerText = state.draft;
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
                      feedbackVote={item.message.feedbackVote === 1 ? 1 : item.message.feedbackVote === -1 ? -1 : null}
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
                <div class="chat-conversation-runtime-segment px-4 py-2" data-stream-id={item.streamId} data-active={item.isActiveRuntimeSegment}>
                  <StreamMessage streamId={item.streamId} status={item.isActiveRuntimeSegment ? 'processing' : 'completed'}
                    {labels} variant="chat" subscriptionMode="passive" initialEvents={[...item.segment.events]} />
                </div>
              {/if}
            {/snippet}
          </ChatTimeline>
        {/if}
        {#each state.permissions as permission (permission.id)}
          <div role="status" data-permission-status={permission.status}>
            {permission.name}: {labels(`chat.permission.${permission.status}`)}
            {#if permission.status === 'pending'}
              <button type="button" on:click={() => void commands.decidePermission(permission.id, true)}>{labels('chat.permission.allow')}</button>
              <button type="button" on:click={() => void commands.decidePermission(permission.id, false)}>{labels('chat.permission.deny')}</button>
            {/if}
          </div>
        {/each}
        {#if state.error}<div role="alert">{state.error}</div>{/if}
      </div>
    {/snippet}
    {#snippet renderComposer()}
      {#if flags.attachments}
        <AttachmentBand items={state.attachments} onRemove={(item) => void commands.removeAttachment(item.composerAttachmentId)}
          removeLabel={labels('common.remove')} enlargeLabel={labels('common.enlarge')}
          loadingLabel={labels('common.loading')} errorLabel={labels('common.error')} />
      {/if}
      <ChatComposer value={state.draft} disabled={state.sending || !state.sessionId}
        ariaLabel={labels('chat.composer.placeholder.chat')} surfaceRole="group" tabIndex={-1} onKeyDown={keydown}>
        {#snippet renderComposerSurface()}
          <div class="w-full text-sm text-slate-900 outline-none" contenteditable="plaintext-only" role="textbox"
            aria-label={labels('chat.composer.placeholder.chat')} aria-multiline="false"
            bind:textContent={composerText} on:input={(event) => commands.setDraft(event.currentTarget.textContent ?? '')}></div>
        {/snippet}
        {#snippet renderFloatingLayer()}<span></span>{/snippet}
        {#snippet renderLeftControls()}
          {#if flags.attachments}
            <input type="file" multiple aria-label={labels('chat.attachments.add')}
              on:change={(event) => void commands.attachFiles(Array.from(event.currentTarget.files ?? []))} />
          {:else}<span class="text-xs text-slate-400">{labels('chat.composer.hint')}</span>{/if}
        {/snippet}
        {#snippet renderRightActions()}
          {#if flags.stop && state.activeMessageId}
            <button type="button" aria-label={labels('chat.composer.stop')}
              on:click={() => state.activeMessageId && void commands.stop(state.activeMessageId)}>{labels('chat.composer.stop')}</button>
          {/if}
          <button type="button" class="chat-conversation-send-btn rounded px-3 py-1 text-xs font-medium text-white transition"
            class:bg-slate-800={!state.sending && Boolean(state.sessionId)} class:bg-slate-300={state.sending || !state.sessionId}
            disabled={state.sending || !state.sessionId} aria-label={labels(state.activeStreamId && flags.steer ? 'chat.composer.steer' : 'chat.composer.send')}
            on:click={() => void send()}>{labels(state.activeStreamId && flags.steer ? 'chat.composer.steer' : 'chat.composer.send')}</button>
        {/snippet}
      </ChatComposer>
    {/snippet}
  </ChatPanel>
</div>
