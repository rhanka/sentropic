<script lang="ts">
  /**
   * ViewTemplateCatalog — template catalog UI for settings.
   * Shows all view templates for the current workspace, grouped by object type.
   * Aligned UX: Copy / Edit / Reset / Delete per SPEC_EVOL_CONFIG_UX_ALIGNMENT.
   */
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { selectedWorkspace } from '$lib/stores/workspaceScope';
  import { listViewTemplates } from '$lib/stores/viewTemplates';
  import { apiPost, apiPut, apiDelete } from '$lib/utils/api';
  import { addToast } from '$lib/stores/toast';
  import type { ViewTemplateRecord } from '$lib/types/view-template';
  import { ChevronDown, ChevronRight, Copy, Trash2, RotateCcw, Pencil, Lock, UserPen } from '@lucide/svelte';

  let templates: ViewTemplateRecord[] = [];
  let loading = true;
  let expandedType: string | null = null;
  let editingId: string | null = null;
  let editDescriptor: string = '';

  $: workspaceType = $selectedWorkspace?.type ?? 'ai-ideas';

  const OBJECT_TYPE_LABELS: Record<string, string> = {
    container: 'Container views',
    initiative: 'Initiative detail',
    solution: 'Solution editor',
    product: 'Product editor',
    proposal: 'Proposal editor',
    bid: 'Proposal editor',
    organization: 'Organization detail',
    dashboard: 'Dashboard',
    workflow_launch: 'Workflow launch',
  };

  // Group templates by object type
  $: grouped = (() => {
    const map = new Map<string, ViewTemplateRecord[]>();
    for (const t of templates) {
      const key = t.objectType;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([type, items]) => ({
      type,
      label: OBJECT_TYPE_LABELS[type] ?? type,
      items,
    }));
  })();

  // Check if a copy already exists for a given parent template in this workspace
  function hasCopyInWorkspace(parentId: string): boolean {
    return templates.some(t => t.parentId === parentId && t.sourceLevel === 'user');
  }

  // Determine if template is a system/admin config (read-only, copyable)
  function isSystemConfig(t: ViewTemplateRecord): boolean {
    return t.sourceLevel === 'code' || t.sourceLevel === 'admin';
  }

  // Determine if template is a copied config (has parentId)
  function isCopiedConfig(t: ViewTemplateRecord): boolean {
    return t.sourceLevel === 'user' && !!t.parentId;
  }

  // Determine if template is user-created (no parent)
  function isUserCreated(t: ViewTemplateRecord): boolean {
    return t.sourceLevel === 'user' && !t.parentId;
  }

  async function loadTemplates() {
    loading = true;
    try {
      templates = await listViewTemplates($selectedWorkspace?.id ?? '', workspaceType);
    } catch {
      templates = [];
    } finally {
      loading = false;
    }
  }

  async function handleCopy(id: string) {
    try {
      await apiPost(`/view-templates/${id}/copy`);
      addToast({ type: 'success', message: $_('settings.runtime.toasts.copied') });
      await loadTemplates();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? $_('settings.runtime.errors.copy') });
    }
  }

  async function handleReset(id: string) {
    if (!confirm($_('settings.runtime.confirmReset'))) return;
    try {
      await apiPost(`/view-templates/${id}/reset`);
      addToast({ type: 'success', message: $_('settings.runtime.toasts.reset') });
      await loadTemplates();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? $_('settings.runtime.errors.reset') });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm($_('settings.runtime.confirmDelete'))) return;
    try {
      await apiDelete(`/view-templates/${id}`);
      addToast({ type: 'success', message: $_('settings.runtime.toasts.deleted') });
      await loadTemplates();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? $_('settings.runtime.errors.delete') });
    }
  }

  function startEdit(template: ViewTemplateRecord) {
    editingId = template.id;
    editDescriptor = JSON.stringify(template.descriptor, null, 2);
  }

  async function saveEdit() {
    if (!editingId) return;
    try {
      const descriptor = JSON.parse(editDescriptor);
      await apiPut(`/view-templates/${editingId}`, { descriptor });
      addToast({ type: 'success', message: $_('settings.runtime.toasts.saved') });
      editingId = null;
      editDescriptor = '';
      await loadTemplates();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? $_('settings.runtime.errors.save') });
    }
  }

  function cancelEdit() {
    editingId = null;
    editDescriptor = '';
  }

  function toggleType(type: string) {
    expandedType = expandedType === type ? null : type;
  }

  onMount(() => {
    void loadTemplates();
  });

  // Reload when workspace type changes
  $: if (workspaceType) {
    void loadTemplates();
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h3 class="text-lg font-semibold text-slate-900">View Template Catalog</h3>
    <span class="text-sm text-slate-500">{workspaceType} workspace</span>
  </div>

  {#if loading}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <p class="text-sm text-blue-700">Loading templates...</p>
    </div>
  {:else if grouped.length === 0}
    <div class="rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <p class="text-sm text-slate-500">No view templates found for this workspace type.</p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each grouped as group}
        <div class="rounded border border-slate-200 bg-white overflow-hidden">
          <button
            type="button"
            class="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition"
            on:click={() => toggleType(group.type)}
          >
            <div class="flex items-center gap-2">
              {#if expandedType === group.type}
                <ChevronDown class="w-4 h-4 text-slate-400" />
              {:else}
                <ChevronRight class="w-4 h-4 text-slate-400" />
              {/if}
              <span class="font-medium text-slate-900">{group.label}</span>
              <span class="text-xs text-slate-400">({group.items.length})</span>
            </div>
          </button>

          {#if expandedType === group.type}
            <div class="border-t border-slate-200 divide-y divide-slate-100">
              {#each group.items as template}
                <div class="px-4 py-3">
                  {#if editingId === template.id}
                    <!-- Edit mode -->
                    <div class="space-y-2">
                      <textarea
                        class="w-full h-48 rounded border border-slate-300 px-3 py-2 text-xs font-mono"
                        bind:value={editDescriptor}
                      />
                      <div class="flex gap-2">
                        <button
                          type="button"
                          class="rounded bg-primary px-3 py-1 text-sm text-white hover:opacity-90"
                          on:click={saveEdit}
                        >
                          {$_('common.save')}
                        </button>
                        <button
                          type="button"
                          class="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
                          on:click={cancelEdit}
                        >
                          {$_('common.cancel')}
                        </button>
                      </div>
                    </div>
                  {:else}
                    <!-- View mode -->
                    <div class="flex items-center justify-between">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-medium text-slate-900">
                            {template.objectType}
                            {template.maturityStage ? `(${template.maturityStage})` : ''}
                          </span>
                          <!-- Source badge -->
                          {#if isSystemConfig(template)}
                            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-500">
                              <Lock class="w-3 h-3" />
                              {$_('settings.runtime.systemDefault')}
                            </span>
                          {:else if isCopiedConfig(template)}
                            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700">
                              <UserPen class="w-3 h-3" />
                              ({$_('settings.runtime.customized')})
                            </span>
                          {/if}
                          <span class="text-[10px] text-slate-400">v{template.version}</span>
                        </div>
                        <p class="text-xs text-slate-400 mt-0.5 truncate">
                          Layout: {(template.descriptor as any)?.layout ?? 'unknown'}
                        </p>
                      </div>
                      <div class="flex items-center gap-1">
                        <!-- Edit button: only on copied or user-created -->
                        {#if !isSystemConfig(template)}
                          <button
                            type="button"
                            class="p-1 text-slate-400 hover:text-primary rounded"
                            title={$_('common.edit')}
                            on:click={() => startEdit(template)}
                          >
                            <Pencil class="w-4 h-4" />
                          </button>
                        {/if}
                        <!-- Copy button: only on system configs, hidden if copy exists -->
                        {#if isSystemConfig(template) && !hasCopyInWorkspace(template.id)}
                          <button
                            type="button"
                            class="p-1 text-slate-400 hover:text-primary rounded"
                            title={$_('settings.runtime.copy')}
                            on:click={() => handleCopy(template.id)}
                          >
                            <Copy class="w-4 h-4" />
                          </button>
                        {/if}
                        <!-- Reset button: only on copied configs -->
                        {#if isCopiedConfig(template)}
                          <button
                            type="button"
                            class="p-1 text-slate-400 hover:text-amber-600 rounded"
                            title={$_('settings.runtime.resetToDefault')}
                            on:click={() => handleReset(template.id)}
                          >
                            <RotateCcw class="w-4 h-4" />
                          </button>
                        {/if}
                        <!-- Delete button: only on user-created (no parent) -->
                        {#if isUserCreated(template)}
                          <button
                            type="button"
                            class="p-1 text-slate-400 hover:text-red-600 rounded"
                            title={$_('common.delete')}
                            on:click={() => handleDelete(template.id)}
                          >
                            <Trash2 class="w-4 h-4" />
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
