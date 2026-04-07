<script lang="ts">
  /**
   * ConfigItemCard — shared card component for config items (agents, workflows, view templates).
   * Renders name, key, description, source badge, and action icons per SPEC_EVOL_CONFIG_UX_ALIGNMENT.
   *
   * Visibility rules:
   * - System (sourceLevel=code|admin): Copy only (hidden if hasCopy=true)
   * - Copied (parentId set): Edit + Reset
   * - User-created (sourceLevel=user, no parentId): Edit + Delete
   */
  import { _ } from 'svelte-i18n';
  import { Copy, Pencil, RotateCcw, Trash2, Lock, UserPen } from '@lucide/svelte';

  export let item: {
    id: string;
    name: string;
    key?: string;
    description?: string | null;
    sourceLevel: string; // 'code' | 'admin' | 'user'
    parentId: string | null;
    version?: number;
  };
  export let hasCopy: boolean = false;
  export let onCopy: ((id: string) => void) | null = null;
  export let onEdit: ((id: string) => void) | null = null;
  export let onReset: ((id: string) => void) | null = null;
  export let onDelete: ((id: string) => void) | null = null;
  export let disabled: boolean = false;
  export let testId: string | undefined = undefined;

  $: isSystem = item.sourceLevel === 'code' || item.sourceLevel === 'admin';
  $: isCopied = item.sourceLevel === 'user' && !!item.parentId;
  $: isUserCreated = item.sourceLevel === 'user' && !item.parentId;
</script>

<div
  class="rounded-lg border border-slate-200 bg-white p-4"
  data-testid={testId ?? `config-item-card-${item.key ?? item.id}`}
>
  <!-- Line 1: Name + badge -->
  <div class="flex items-center justify-between gap-2">
    <span class="font-medium text-slate-900">{item.name}</span>
    <div class="flex items-center gap-2">
      {#if isSystem}
        <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-500">
          <Lock class="w-3 h-3" />
          {$_('settings.runtime.systemDefault')}
        </span>
      {:else if isCopied}
        <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700">
          <UserPen class="w-3 h-3" />
          ({$_('settings.runtime.customized')})
        </span>
      {/if}
    </div>
  </div>

  <!-- Line 2: Key -->
  {#if item.key}
    <div class="mt-0.5 text-xs text-slate-400">{item.key}</div>
  {/if}

  <!-- Line 3: Description -->
  {#if item.description}
    <div class="mt-1 text-sm text-slate-600">{item.description}</div>
  {/if}

  <!-- Line 4: Action icons -->
  <div class="mt-3 flex items-center gap-1">
    <!-- Copy: system only, hidden if hasCopy -->
    {#if isSystem && !hasCopy && onCopy}
      <button
        type="button"
        class="p-1 text-slate-400 hover:text-blue-600 rounded disabled:opacity-50"
        title={$_('settings.runtime.copy')}
        on:click={() => onCopy?.(item.id)}
        {disabled}
      >
        <Copy class="w-4 h-4" />
      </button>
    {/if}
    <!-- Edit: copied or user-created -->
    {#if (isCopied || isUserCreated) && onEdit}
      <button
        type="button"
        class="p-1 text-slate-400 hover:text-slate-700 rounded disabled:opacity-50"
        title={$_('settings.runtime.edit')}
        on:click={() => onEdit?.(item.id)}
        {disabled}
      >
        <Pencil class="w-4 h-4" />
      </button>
    {/if}
    <!-- Reset: copied only -->
    {#if isCopied && onReset}
      <button
        type="button"
        class="p-1 text-slate-400 hover:text-amber-600 rounded disabled:opacity-50"
        title={$_('settings.runtime.resetToDefault')}
        on:click={() => onReset?.(item.id)}
        {disabled}
      >
        <RotateCcw class="w-4 h-4" />
      </button>
    {/if}
    <!-- Delete: user-created only -->
    {#if isUserCreated && onDelete}
      <button
        type="button"
        class="p-1 text-slate-400 hover:text-red-600 rounded disabled:opacity-50"
        title={$_('common.delete')}
        on:click={() => onDelete?.(item.id)}
        {disabled}
      >
        <Trash2 class="w-4 h-4" />
      </button>
    {/if}
  </div>

  <!-- Slot for extra content (e.g., edit form, task details) -->
  <slot />
</div>
