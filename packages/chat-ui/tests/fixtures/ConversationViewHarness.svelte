<script lang="ts">
  import type { createConversationRuntime } from '@sentropic/chat-runtime/state/conversationRuntime';
  import ChatConversation from '../../src/components/ChatConversation.svelte';
  import type { ChatConversationFeatures } from '../../src/components/ChatConversation.svelte';
  export let runtime: ReturnType<typeof createConversationRuntime>;
  export let appShaped = false;
  export let features: ChatConversationFeatures = {};
  export let layout: 'inline' | 'docked' | 'floating' = 'inline';
</script>

{#snippet conversation()}
  <ChatConversation snapshots={runtime} commands={runtime.commands} {features} {layout}>
    {#snippet renderComments()}<div>Comments module</div>{/snippet}
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
