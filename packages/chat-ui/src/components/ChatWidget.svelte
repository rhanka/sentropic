<script lang="ts">
  import type { Snippet } from 'svelte';
  import ChatWidgetTabBar from './ChatWidgetTabBar.svelte';

  type ChatWidgetTab = 'chat' | 'queue' | 'comments';

  export let activeTab: ChatWidgetTab = 'chat';
  export let activeJobsCount = 0;
  export let failedJobsCount = 0;
  export let chatTabLabel = 'Chat';
  export let commentsTabLabel = 'Comments';
  export let queueTabLabel = 'Jobs';
  export let widgetLabel = 'Chat';
  export let showCommentsTab = true;
  export let tabBarVariant: 'default' | 'extension' = 'default';
  export let showJobsBadge = true;
  export let onActiveTabChange:
    | ((tab: ChatWidgetTab) => void)
    | undefined = undefined;
  export let onPurgeJobs: (() => void | Promise<void>) | undefined = undefined;
  export let renderShell: Snippet<[]> | undefined = undefined;
  export let renderJobsPanel: Snippet<[]> | undefined = undefined;
  export let renderCommentsPanel: Snippet<[]> | undefined = undefined;
  export let renderChatPanel: Snippet<[]> | undefined = undefined;
  export let renderHeaderLeading: Snippet<[]> | undefined = undefined;
  export let renderHeaderActions: Snippet<[]> | undefined = undefined;
  export let headerGrip:
    | { enabled?: boolean; dragging?: boolean; onPointerDown?: (event: PointerEvent) => void }
    | undefined = undefined;

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
    class="chat-widget-shell flex h-full min-h-0 flex-col"
    aria-label={widgetLabel}
  >
    <header
      class="chat-widget-header flex h-14 shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4"
      class:cursor-grab={headerGrip?.enabled && !headerGrip?.dragging}
      class:cursor-grabbing={headerGrip?.dragging}
      data-chat-header-grip={headerGrip?.enabled ? 'true' : undefined}
      data-dragging={headerGrip?.dragging ? 'true' : undefined}
      on:pointerdown={headerGrip?.onPointerDown}
    >
      <div class="flex items-center gap-2">
        {#if renderHeaderLeading}{@render renderHeaderLeading()}{/if}
        <ChatWidgetTabBar
          {activeTab}
          {showCommentsTab}
          {chatTabLabel}
          {commentsTabLabel}
          {queueTabLabel}
          variant={tabBarVariant}
          {showJobsBadge}
          jobsBadgeCount={totalJobsCount}
          ariaLabel={widgetLabel}
          onSelect={setActiveTab}
        />
      </div>

      <div class="flex items-center gap-2">
        {#if renderHeaderActions}
          {@render renderHeaderActions()}
        {:else if activeTab === 'queue' && onPurgeJobs}
        <button
          class="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
          type="button"
          on:click={purgeJobs}
        >
          Purge
        </button>
        {/if}
      </div>
    </header>

    <div class="min-h-0 flex-1">
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
