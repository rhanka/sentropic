<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ChatProjectedTimelineItem } from '../state/chatProjection.js';

  type TimelineItem = ChatProjectedTimelineItem<any, any>;

  export let items: readonly TimelineItem[] = [];
  export let renderUserMessage: Snippet<[TimelineItem]>;
  export let renderMessageAttachments: Snippet<[TimelineItem]> | undefined = undefined;
  export let renderAssistantSegment: Snippet<[TimelineItem]>;
  export let renderRuntimeSegment: Snippet<[TimelineItem]>;
</script>

{#each items as item (item.key)}
  {#if item.kind === 'message' && item.message.role === 'user'}
    {@render renderUserMessage(item)}
    {#if renderMessageAttachments}
      {@render renderMessageAttachments(item)}
    {/if}
  {:else if item.kind === 'assistant-segment'}
    {@render renderAssistantSegment(item)}
  {:else if item.kind === 'runtime-segment'}
    {@render renderRuntimeSegment(item)}
  {/if}
{/each}
