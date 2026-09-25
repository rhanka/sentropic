<script lang="ts">
  import ChatWidget from '../../src/components/ChatWidget.svelte';
  import type { ChatWidgetProps } from '../../src/components/ChatWidget.svelte';
  import type { Snippet } from 'svelte';
  export let state: 'loading' | 'auth' | 'onboarding' | 'ready' = 'loading';
  export let widgetProps: ChatWidgetProps = {};
</script>
{#snippet gate(ready: Snippet<[]>)}
  {#if state === 'loading'}<p>Loading</p>
  {:else if state === 'auth'}<p>Connect</p>
  {:else if state === 'onboarding'}<p>Choose workspace</p>
  {:else}{@render ready()}{/if}
{/snippet}
<ChatWidget {...widgetProps} renderContentGate={gate} />
