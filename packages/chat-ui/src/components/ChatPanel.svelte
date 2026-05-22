<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ChatCoreTransport } from '../client/transport.js';
  import type { StreamHubClient } from '../client/streamTypes.js';
  import type { RendererRegistry } from '../renderers/registry.js';
  import type {
    ChatUiLabelResolver,
    ChatUiWebHost,
  } from '../hosts/createWebHost.js';

  export let host: ChatUiWebHost | undefined = undefined;
  export let transport: ChatCoreTransport | undefined = undefined;
  export let streamClient: StreamHubClient | undefined = undefined;
  export let contextProvider: unknown = undefined;
  export let rendererRegistry: RendererRegistry | undefined = undefined;
  export let labels: ChatUiLabelResolver | undefined = undefined;
  export let featureFlags: Record<string, boolean> = {};
  export let renderShell: Snippet<[]> | undefined = undefined;
  export let renderHeader: Snippet<[]> | undefined = undefined;
  export let renderTimeline: Snippet<[]> | undefined = undefined;
  export let renderComposer: Snippet<[]> | undefined = undefined;

  let hasTransport = false;
  let hasStreamClient = false;
  let hasContextProvider = false;
  let hasRendererRegistry = false;
  let enabledFeatureCount = 0;

  $: hasTransport = Boolean(transport ?? host?.transport);
  $: hasStreamClient = Boolean(streamClient ?? host?.streamClient);
  $: hasContextProvider = Boolean(contextProvider ?? host?.contextProvider);
  $: hasRendererRegistry = Boolean(rendererRegistry ?? host?.renderers);
  $: enabledFeatureCount = Object.values(featureFlags).filter(Boolean).length;

  const resolveLabel = (key: string): string =>
    labels?.(key) ?? host?.labels?.(key) ?? key;
</script>

{#if renderShell}
  {@render renderShell()}
{:else}
  <section
    class="chat-panel-shell flex h-full min-h-0 flex-col bg-white text-slate-900"
    data-has-transport={hasTransport}
    data-has-stream-client={hasStreamClient}
    data-has-context-provider={hasContextProvider}
    data-has-renderer-registry={hasRendererRegistry}
    data-enabled-feature-count={enabledFeatureCount}
    aria-label={resolveLabel('chat.tabs.chat')}
  >
    {#if renderHeader}
      {@render renderHeader()}
    {:else}
      <header class="border-b border-slate-200 px-3 py-2 text-xs text-slate-500">
        {resolveLabel('chat.tabs.chat')}
      </header>
    {/if}

    <div class="min-h-0 flex-1 overflow-hidden">
      {#if renderTimeline}
        {@render renderTimeline()}
      {:else}
        <div class="flex h-full items-center justify-center p-4 text-xs text-slate-500">
          {resolveLabel('chat.sessions.none')}
        </div>
      {/if}
    </div>

    {#if renderComposer}
      {@render renderComposer()}
    {:else}
      <footer class="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
        {resolveLabel('chat.composer.placeholder.chat')}
      </footer>
    {/if}
  </section>
{/if}
