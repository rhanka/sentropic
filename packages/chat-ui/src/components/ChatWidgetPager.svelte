<script lang="ts">
  import type { Snippet } from 'svelte';
  import AgentsList from './AgentsList.svelte';
  import type { AgentsListProps } from './AgentsList.svelte';
  export let agentsView: 'list' | 'conversation' = 'conversation';
  export let canAgentsListBeDefaultView = false;
  export let agentsList: AgentsListProps | undefined = undefined;
  export let renderAgentsListHeader: Snippet<[]> | undefined = undefined;
  export let renderConversationHeader: Snippet<[]> | undefined = undefined;
  export let renderChatPanel: Snippet<[]> | undefined = undefined;
  export let agentsViewAnnouncement = '';
</script>

{#if canAgentsListBeDefaultView && agentsView === 'list'}
  <section class="h-full min-h-0 flex flex-col chat-agents-view-slide-from-inline-start">
    <div class="shrink-0 p-3">
      {#if renderAgentsListHeader}{@render renderAgentsListHeader()}{/if}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      {#if agentsList}<AgentsList {...agentsList} />{/if}
    </div>
  </section>
{/if}
<div
  class="h-full min-h-0 flex flex-col"
  class:hidden={canAgentsListBeDefaultView && agentsView === 'list'}
  class:chat-agents-view-slide-from-inline-end={canAgentsListBeDefaultView && agentsView === 'conversation'}
>
  {#if renderConversationHeader}{@render renderConversationHeader()}{/if}
  {#if renderChatPanel}{@render renderChatPanel()}{/if}
</div>
<div class="sr-only" aria-live="polite" aria-atomic="true">{agentsViewAnnouncement}</div>

<style>
  .chat-agents-view-slide-from-inline-start,
  .chat-agents-view-slide-from-inline-end {
    position: relative;
    animation-duration: 180ms;
    animation-timing-function: ease-out;
  }
  .chat-agents-view-slide-from-inline-start {
    animation-name: chat-agents-view-slide-from-inline-start;
  }
  .chat-agents-view-slide-from-inline-end {
    animation-name: chat-agents-view-slide-from-inline-end;
  }
  @keyframes chat-agents-view-slide-from-inline-start {
    from { inset-inline-start: -24px; }
    to { inset-inline-start: 0; }
  }
  @keyframes chat-agents-view-slide-from-inline-end {
    from { inset-inline-end: -24px; }
    to { inset-inline-end: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .chat-agents-view-slide-from-inline-start,
    .chat-agents-view-slide-from-inline-end { animation: none; }
  }
</style>
