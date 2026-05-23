<script lang="ts">
  import type { Snippet } from 'svelte';

  type ChatWidgetTab = 'chat' | 'queue' | 'comments';

  export let activeTab: ChatWidgetTab = 'chat';
  export let activeJobsCount = 0;
  export let failedJobsCount = 0;
  export let chatTabLabel = 'Chat';
  export let commentsTabLabel = 'Comments';
  export let queueTabLabel = 'Jobs';
  export let widgetLabel = 'Chat';
  export let showCommentsTab = true;
  export let onActiveTabChange:
    | ((tab: ChatWidgetTab) => void)
    | undefined = undefined;
  export let onPurgeJobs: (() => void | Promise<void>) | undefined = undefined;
  export let renderShell: Snippet<[]> | undefined = undefined;
  export let renderJobsPanel: Snippet<[]> | undefined = undefined;
  export let renderCommentsPanel: Snippet<[]> | undefined = undefined;
  export let renderChatPanel: Snippet<[]> | undefined = undefined;

  let totalJobsCount = 0;
  $: totalJobsCount = activeJobsCount + failedJobsCount;

  const setActiveTab = (tab: ChatWidgetTab): void => {
    activeTab = tab;
    onActiveTabChange?.(tab);
  };

  const purgeJobs = (): void => {
    void onPurgeJobs?.();
  };
</script>

{#if renderShell}
  {@render renderShell()}
{:else}
  <section
    class="chat-widget-shell flex h-full min-h-0 flex-col bg-white text-slate-900"
    aria-label={widgetLabel}
  >
    <header class="flex h-14 items-center justify-between border-b border-slate-200 px-4">
      <nav class="flex items-center gap-1 rounded bg-slate-50 p-1" aria-label={widgetLabel}>
        {#if showCommentsTab}
          <button
            class="rounded px-2 py-1 text-xs transition {activeTab === 'comments'
              ? 'bg-white font-semibold text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'}"
            type="button"
            aria-pressed={activeTab === 'comments'}
            on:click={() => setActiveTab('comments')}
          >
            {commentsTabLabel}
          </button>
        {/if}
        <button
          class="rounded px-2 py-1 text-xs transition {activeTab === 'chat'
            ? 'bg-white font-semibold text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'}"
          type="button"
          aria-pressed={activeTab === 'chat'}
          on:click={() => setActiveTab('chat')}
        >
          {chatTabLabel}
        </button>
        <button
          class="rounded px-2 py-1 text-xs transition {activeTab === 'queue'
            ? 'bg-white font-semibold text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'}"
          type="button"
          aria-pressed={activeTab === 'queue'}
          on:click={() => setActiveTab('queue')}
        >
          <span>{queueTabLabel}</span>
          {#if totalJobsCount > 0}
            <span
              class="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-slate-200 px-1 text-[10px] text-slate-700"
              aria-label={`${totalJobsCount} jobs`}
            >
              {totalJobsCount}
            </span>
          {/if}
        </button>
      </nav>

      {#if activeTab === 'queue' && onPurgeJobs}
        <button
          class="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
          type="button"
          on:click={purgeJobs}
        >
          Purge
        </button>
      {/if}
    </header>

    <div class="min-h-0 flex-1 overflow-hidden">
      {#if activeTab === 'queue'}
        {#if renderJobsPanel}
          {@render renderJobsPanel()}
        {:else}
          <div class="flex h-full items-center justify-center p-4 text-xs text-slate-500">
            {queueTabLabel}
          </div>
        {/if}
      {:else if activeTab === 'comments'}
        {#if renderCommentsPanel}
          {@render renderCommentsPanel()}
        {:else}
          <div class="flex h-full items-center justify-center p-4 text-xs text-slate-500">
            {commentsTabLabel}
          </div>
        {/if}
      {:else if renderChatPanel}
        {@render renderChatPanel()}
      {:else}
        <div class="flex h-full items-center justify-center p-4 text-xs text-slate-500">
          {chatTabLabel}
        </div>
      {/if}
    </div>
  </section>
{/if}
