<script lang="ts">
  /**
   * ChatWidgetTabBar — the chat widget's primary tab bar (comments | chat | jobs).
   * Extracted so the package owns the live tab bar (L-C-shell S1, D1c). No rename here (that is L-A').
   * Two faithful looks via `variant`: 'extension' reproduces the app's extension-main-tab styling
   * (no jobs badge), 'default' the package's plain styling (jobs badge). Callbacks are props, not
   * dispatched events, so hosts wire behaviour without a second grammar.
   */
  type ChatWidgetTab = 'chat' | 'queue' | 'comments';

  export let activeTab: ChatWidgetTab;
  export let showCommentsTab = true;
  export let chatTabLabel = 'Chat';
  export let commentsTabLabel = 'Comments';
  export let queueTabLabel = 'Jobs';
  export let onSelect: (tab: ChatWidgetTab) => void = () => {};
  export let showJobsBadge = true;
  export let jobsBadgeCount = 0;
  export let variant: 'default' | 'extension' = 'default';
  export let ariaLabel = 'Chat';

  $: isExtension = variant === 'extension';
  $: containerClass = `${
    isExtension ? 'extension-main-tabs ' : ''
  }flex items-center gap-1 rounded bg-slate-50 p-1`;

  const tabClass = (active: boolean, extension: boolean): string => {
    const activeCls = extension
      ? 'extension-main-tab-active bg-white text-slate-900 shadow-sm'
      : 'bg-white font-semibold text-slate-900 shadow-sm';
    return `${
      extension ? 'extension-main-tab ' : ''
    }rounded px-2 py-1 text-xs transition ${
      active ? activeCls : 'text-slate-500 hover:text-slate-700'
    }`;
  };
</script>

<svelte:element
  this={isExtension ? 'div' : 'nav'}
  class={containerClass}
  aria-label={isExtension ? undefined : ariaLabel}
  data-chat-widget-tab-bar
>
  {#if showCommentsTab}
    <button
      class={tabClass(activeTab === 'comments', isExtension)}
      type="button"
      aria-pressed={isExtension ? undefined : activeTab === 'comments'}
      on:click={() => onSelect('comments')}
    >
      {commentsTabLabel}
    </button>
  {/if}
  <button
    class={tabClass(activeTab === 'chat', isExtension)}
    type="button"
    aria-pressed={isExtension ? undefined : activeTab === 'chat'}
    on:click={() => onSelect('chat')}
  >
    {chatTabLabel}
  </button>
  <button
    class={tabClass(activeTab === 'queue', isExtension)}
    type="button"
    aria-pressed={isExtension ? undefined : activeTab === 'queue'}
    on:click={() => onSelect('queue')}
  >
    {#if isExtension}
      {queueTabLabel}
    {:else}
      <span>{queueTabLabel}</span>
      {#if showJobsBadge && jobsBadgeCount > 0}
        <span
          class="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-slate-200 px-1 text-[10px] text-slate-700"
          aria-label={`${jobsBadgeCount} jobs`}
        >
          {jobsBadgeCount}
        </span>
      {/if}
    {/if}
  </button>
</svelte:element>
