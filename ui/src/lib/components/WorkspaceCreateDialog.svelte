<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { apiPost } from '$lib/utils/api';
  import { addToast } from '$lib/stores/toast';
  import { loadUserWorkspaces, setWorkspaceScope } from '$lib/stores/workspaceScope';
  import { X } from '@lucide/svelte';

  export let open = false;

  type WorkspaceType = 'ai-ideas' | 'opportunity' | 'code';
  const WORKSPACE_TYPES: { value: WorkspaceType; labelKey: string }[] = [
    { value: 'ai-ideas', labelKey: 'workspaceSettings.types.aiIdeas' },
    { value: 'opportunity', labelKey: 'workspaceSettings.types.opportunity' },
    { value: 'code', labelKey: 'workspaceSettings.types.code' },
  ];

  let creating = false;
  let name = '';
  let type: WorkspaceType = 'ai-ideas';
  let inputRef: HTMLInputElement | null = null;

  const dispatch = createEventDispatcher<{ created: { id: string }; close: void }>();

  function close() {
    open = false;
    dispatch('close');
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    creating = true;
    try {
      const res = await apiPost<{ id: string }>('/workspaces', { name: trimmed, type });
      addToast({ type: 'success', message: $_('workspaceSettings.toasts.created') });
      name = '';
      type = 'ai-ideas';
      await loadUserWorkspaces();
      if (res?.id) setWorkspaceScope(res.id);
      open = false;
      dispatch('created', { id: res.id });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? $_('workspaceSettings.errors.create') });
    } finally {
      creating = false;
    }
  }

  $: if (open && inputRef) {
    inputRef.focus();
  }
</script>

{#if open}
  <div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" on:click|self={close}>
    <div class="bg-white rounded-lg max-w-md w-full mx-4">
      <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h3 class="text-lg font-semibold">{$_('workspaceSettings.createDialog.title')}</h3>
        <button
          class="text-slate-400 hover:text-slate-600"
          aria-label={$_('common.close')}
          type="button"
          on:click={close}
        >
          <X class="w-5 h-5" />
        </button>
      </div>
      <div class="px-5 py-4 space-y-4">
        <label class="block text-sm">
          <div class="text-slate-600">{$_('workspaceSettings.createDialog.nameLabel')}</div>
          <input
            class="mt-1 w-full rounded border border-slate-200 px-3 py-2"
            placeholder={$_('workspaceSettings.createDialog.namePlaceholder')}
            bind:value={name}
            bind:this={inputRef}
          />
        </label>
        <label class="block text-sm">
          <div class="text-slate-600">{$_('workspaceSettings.createDialog.typeLabel')}</div>
          <select
            class="mt-1 w-full rounded border border-slate-200 px-3 py-2 bg-white"
            bind:value={type}
          >
            {#each WORKSPACE_TYPES as wt}
              <option value={wt.value}>{$_(wt.labelKey)}</option>
            {/each}
          </select>
        </label>
      </div>
      <div class="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <button
          class="px-3 py-2 rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
          type="button"
          on:click={close}
        >
          {$_('common.cancel')}
        </button>
        <button
          class="px-3 py-2 rounded bg-primary text-white disabled:opacity-50"
          type="button"
          on:click={create}
          disabled={creating || !name.trim()}
        >
          {$_('common.create')}
        </button>
      </div>
    </div>
  </div>
{/if}
