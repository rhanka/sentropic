<script lang="ts">
  /**
   * ContainerView — renders a card/row list of children with sort/group options,
   * a container header, and action buttons.
   *
   * Used by ViewTemplateRenderer in 'container' mode. Supports:
   *  - Card grid layout (default)
   *  - Sortable columns
   *  - Grouping by a key
   *  - Header with title, subtitle, and action buttons
   *  - Empty state
   *  - Loading skeleton
   */

  import { ArrowUpDown } from '@lucide/svelte';
  import type { CardProps, ViewAction, ViewColumn } from '$lib/types/view-template';

  export let title: string | undefined = undefined;
  export let subtitle: string | undefined = undefined;
  export let items: any[] = [];
  export let columns: ViewColumn[] = [];
  export let actions: ViewAction[] = [];
  export let sortKey: string | undefined = undefined;
  export let sortDirection: 'asc' | 'desc' | undefined = undefined;
  export let groupKey: string | undefined = undefined;
  export let emptyMessage: string | undefined = undefined;
  export let loading = false;
  export let cardRenderer: ((item: any) => CardProps) | undefined = undefined;

  // Internal sort state (overrides props when user clicks)
  let internalSortKey = sortKey;
  let internalSortDirection = sortDirection ?? 'asc';

  $: if (sortKey !== undefined) internalSortKey = sortKey;
  $: if (sortDirection !== undefined) internalSortDirection = sortDirection;

  function toggleSort(key: string) {
    if (internalSortKey === key) {
      internalSortDirection = internalSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      internalSortKey = key;
      internalSortDirection = 'asc';
    }
  }

  // Sort items
  $: sortedItems = (() => {
    if (!internalSortKey) return items;
    const key = internalSortKey;
    const dir = internalSortDirection === 'desc' ? -1 : 1;
    return [...items].sort((a, b) => {
      const va = a[key] ?? '';
      const vb = b[key] ?? '';
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  })();

  // Group items
  type GroupedItems = Array<{ group: string; items: any[] }>;
  $: grouped = (() => {
    if (!groupKey) return [{ group: '', items: sortedItems }] as GroupedItems;
    const map = new Map<string, any[]>();
    for (const item of sortedItems) {
      const gk = String(item[groupKey] ?? 'Other');
      if (!map.has(gk)) map.set(gk, []);
      map.get(gk)!.push(item);
    }
    return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
  })();

  // Render card props from item
  function getCardProps(item: any): CardProps {
    if (cardRenderer) return cardRenderer(item);
    return {
      title: item.name ?? item.title ?? 'Untitled',
      subtitle: item.description ?? item.subtitle ?? undefined,
    };
  }

  const variantClasses: Record<string, string> = {
    primary: 'bg-primary text-white hover:opacity-90',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
  };
</script>

<div class="space-y-4">
  <!-- Header -->
  {#if title || actions.length > 0}
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {#if title}
          <h2 class="text-2xl font-bold text-slate-900">{title}</h2>
        {/if}
        {#if subtitle}
          <p class="mt-1 text-sm text-slate-500">{subtitle}</p>
        {/if}
      </div>
      {#if actions.length > 0}
        <div class="flex gap-2">
          {#each actions as action}
            {#if action.href}
              <a
                href={action.href}
                class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium shadow-sm transition {variantClasses[action.variant ?? 'secondary']}"
              >
                {#if action.icon}
                  <svelte:component this={action.icon} class="h-4 w-4" />
                {/if}
                {action.label}
              </a>
            {:else}
              <button
                on:click={action.onClick}
                class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium shadow-sm transition {variantClasses[action.variant ?? 'secondary']}"
              >
                {#if action.icon}
                  <svelte:component this={action.icon} class="h-4 w-4" />
                {/if}
                {action.label}
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Sort controls -->
  {#if columns.some((c) => c.sortable)}
    <div class="flex flex-wrap gap-2 text-xs text-slate-500">
      {#each columns.filter((c) => c.sortable) as col}
        <button
          class="inline-flex items-center gap-1 rounded px-2 py-1 transition hover:bg-slate-100 {internalSortKey === col.key ? 'bg-slate-100 font-semibold text-slate-700' : ''}"
          on:click={() => toggleSort(col.key)}
        >
          {col.label}
          <ArrowUpDown class="h-3 w-3" />
          {#if internalSortKey === col.key}
            <span class="text-[10px]">{internalSortDirection === 'asc' ? '↑' : '↓'}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Loading skeleton -->
  {#if loading}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each Array(6) as _}
        <div class="animate-pulse rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-3 h-5 w-2/3 rounded bg-slate-200"></div>
          <div class="mb-2 h-3 w-full rounded bg-slate-100"></div>
          <div class="h-3 w-1/2 rounded bg-slate-100"></div>
        </div>
      {/each}
    </div>
  {:else if sortedItems.length === 0}
    <!-- Empty state -->
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <p class="text-sm text-slate-500">{emptyMessage ?? 'No items to display.'}</p>
    </div>
  {:else}
    <!-- Card grid -->
    {#each grouped as group}
      {#if group.group}
        <h3 class="mt-4 text-sm font-semibold uppercase tracking-wider text-slate-400">{group.group}</h3>
      {/if}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each group.items as item (item.id ?? item)}
          {@const card = getCardProps(item)}
          {#if card.href}
            <a
              href={card.href}
              class="group flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
            >
              <div class="flex items-start gap-3">
                {#if card.icon}
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg {card.iconColorClass ?? 'bg-slate-100 text-slate-500'}">
                    <svelte:component this={card.icon} class="h-5 w-5" />
                  </span>
                {/if}
                <div class="min-w-0 flex-1">
                  <h4 class="truncate text-sm font-semibold text-slate-900 group-hover:text-primary">{card.title}</h4>
                  {#if card.subtitle}
                    <p class="mt-0.5 truncate text-xs text-slate-500">{card.subtitle}</p>
                  {/if}
                </div>
              </div>
              {#if card.badges && card.badges.length > 0}
                <div class="mt-3 flex flex-wrap gap-1.5">
                  {#each card.badges as badge}
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium {badge.colorClass ?? 'bg-slate-100 text-slate-600'}">
                      {badge.label}
                    </span>
                  {/each}
                </div>
              {/if}
            </a>
          {:else}
            <button
              on:click={card.onClick}
              class="group flex flex-col rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md"
            >
              <div class="flex items-start gap-3">
                {#if card.icon}
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg {card.iconColorClass ?? 'bg-slate-100 text-slate-500'}">
                    <svelte:component this={card.icon} class="h-5 w-5" />
                  </span>
                {/if}
                <div class="min-w-0 flex-1">
                  <h4 class="truncate text-sm font-semibold text-slate-900 group-hover:text-primary">{card.title}</h4>
                  {#if card.subtitle}
                    <p class="mt-0.5 truncate text-xs text-slate-500">{card.subtitle}</p>
                  {/if}
                </div>
              </div>
              {#if card.badges && card.badges.length > 0}
                <div class="mt-3 flex flex-wrap gap-1.5">
                  {#each card.badges as badge}
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium {badge.colorClass ?? 'bg-slate-100 text-slate-600'}">
                      {badge.label}
                    </span>
                  {/each}
                </div>
              {/if}
            </button>
          {/if}
        {/each}
      </div>
    {/each}
  {/if}
</div>
