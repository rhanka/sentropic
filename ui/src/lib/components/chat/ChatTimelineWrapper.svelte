<script lang="ts">
  import type { Snippet } from 'svelte';
  import PackageChatTimeline from '@sentropic/chat-ui/components/ChatTimeline.svelte';
  import type { ChatProjectedTimelineItem } from '@sentropic/chat-ui/state/chatProjection';

  type TimelineItem = ChatProjectedTimelineItem<any, any>;

  export let items: readonly TimelineItem[] = [];
  export let renderUserMessage: Snippet<[TimelineItem]>;
  export let renderAssistantSegment: Snippet<[TimelineItem]>;
  export let renderRuntimeSegment: Snippet<[TimelineItem]>;
</script>

<PackageChatTimeline
  {items}
  {renderUserMessage}
  {renderAssistantSegment}
  {renderRuntimeSegment}
/>
