<script lang="ts">
  import type { createConversationRuntime } from '@sentropic/chat-runtime/state/conversationRuntime';
  import ChatConversation from '../../src/components/ChatConversation.svelte';
  import type { ChatConversationFeatures } from '../../src/components/ChatConversation.svelte';
  import CommentsPanel from '../../src/comments/CommentsPanel.svelte';
  import type { CommentHost, CommentState } from '@sentropic/chat-runtime/comments';
  export let runtime: ReturnType<typeof createConversationRuntime>;
  export let appShaped = false;
  export let features: ChatConversationFeatures = {};
  export let layout: 'inline' | 'docked' | 'floating' = 'inline';
  export let labels: (key: string) => string = (key) => key;
  export let commentModule: { host: CommentHost; state: CommentState } | undefined = undefined;
</script>

{#snippet conversation()}
  <ChatConversation snapshots={runtime} commands={runtime.commands} {features} {layout} {labels}>
    {#snippet renderComments()}
      {#if commentModule}
        <CommentsPanel host={commentModule.host} state={commentModule.state} {labels} contextType="folder" contextId="comments" />
      {:else}<div>Comments module</div>{/if}
    {/snippet}
    {#snippet renderDocuments()}<div>Documents module</div>{/snippet}
    {#snippet renderJobs()}<div>Jobs module</div>{/snippet}
    {#snippet renderWorkspaceScope()}<div>Workspace scope module</div>{/snippet}
  </ChatConversation>
{/snippet}
{#if appShaped}
  <section data-app-shaped="true" class="h-full"><div class="min-h-0 flex-1">{@render conversation()}</div></section>
{:else}
  {@render conversation()}
{/if}
