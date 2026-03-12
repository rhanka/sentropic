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
  import type { ViewTemplateDescriptor } from '$lib/types/view-template';

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
