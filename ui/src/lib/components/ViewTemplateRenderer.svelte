<script lang="ts">
  /**
   * ViewTemplateRenderer — resolves a view template descriptor and dispatches
   * to the appropriate layout / widget renderer.
   *
   * Currently supports:
   *  - 'container' mode → delegates to ContainerView
   *  - 'detail' mode   → renders a detail slot (future extension point)
   *
   * The descriptor is a plain object describing *what* to render; this component
   * decides *how* to render it by picking the right sub-component.
   */

  import ContainerView from './ContainerView.svelte';

  /** Supported view modes */
  export type ViewMode = 'container' | 'detail';

  /** A single action button descriptor */
  export type ViewAction = {
    label: string;
    href?: string;
    onClick?: () => void;
    variant?: 'primary' | 'secondary' | 'ghost';
    icon?: any; // Lucide icon component
  };

  /** Column descriptor for container list/card views */
  export type ViewColumn = {
    key: string;
    label: string;
    sortable?: boolean;
  };

  /** View template descriptor */
  export type ViewTemplateDescriptor = {
    mode: ViewMode;
    title?: string;
    subtitle?: string;
    columns?: ViewColumn[];
    items?: any[];
    actions?: ViewAction[];
    sortKey?: string;
    sortDirection?: 'asc' | 'desc';
    groupKey?: string;
    emptyMessage?: string;
    loading?: boolean;
    /** Card renderer: maps each item to card props */
    cardRenderer?: (item: any) => {
      title: string;
      subtitle?: string;
      icon?: any;
      iconColorClass?: string;
      badges?: Array<{ label: string; colorClass?: string }>;
      href?: string;
      onClick?: () => void;
    };
  };

  export let descriptor: ViewTemplateDescriptor;
</script>

{#if descriptor.mode === 'container'}
  <ContainerView
    title={descriptor.title}
    subtitle={descriptor.subtitle}
    items={descriptor.items ?? []}
    columns={descriptor.columns ?? []}
    actions={descriptor.actions ?? []}
    sortKey={descriptor.sortKey}
    sortDirection={descriptor.sortDirection}
    groupKey={descriptor.groupKey}
    emptyMessage={descriptor.emptyMessage}
    loading={descriptor.loading ?? false}
    cardRenderer={descriptor.cardRenderer}
  />
{:else if descriptor.mode === 'detail'}
  <!-- Detail mode: extensible slot for future detail renderers -->
  <div class="rounded border border-slate-200 bg-white p-6 shadow-sm">
    {#if descriptor.title}
      <h2 class="text-xl font-semibold text-slate-900">{descriptor.title}</h2>
    {/if}
    <slot />
  </div>
{/if}
