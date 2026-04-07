<script lang="ts">
  /**
   * ViewTemplateCatalog — template catalog UI for settings.
   * Shows all view templates for the current workspace as a flat list using ConfigItemCard.
   * Aligned UX: Copy / Edit / Reset / Delete per SPEC_EVOL_CONFIG_UX_ALIGNMENT.
   */
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { selectedWorkspace } from '$lib/stores/workspaceScope';
  import { listViewTemplates } from '$lib/stores/viewTemplates';
  import { apiPost, apiPut, apiDelete } from '$lib/utils/api';
  import { addToast } from '$lib/stores/toast';
  import type { ViewTemplateRecord } from '$lib/types/view-template';
  import ConfigItemCard from './ConfigItemCard.svelte';

  let templates: ViewTemplateRecord[] = [];
  let loading = true;
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

  /**
   * Parse a template descriptor and return a human-readable summary
   * showing tab count, field count, and field types used.
   */
  function describeTemplate(descriptor: any): string {
    if (!descriptor?.tabs) return 'No descriptor';
    const tabs = descriptor.tabs as any[];
    const fields = tabs.flatMap((t: any) =>
      (t.rows || []).flatMap((r: any) => [
        ...(r.fields || []),
        ...(r.main?.fields || []),
        ...(r.sidebar?.fields || []),
      ]),
    );
    const types = [...new Set(fields.map((f: any) => f.type))].filter(Boolean);
    return `${tabs.length} tab${tabs.length > 1 ? 's' : ''} · ${fields.length} field${fields.length > 1 ? 's' : ''} (${types.join(', ')})`;
  }

  // Check if a copy already exists for a given parent template in this workspace
  function hasCopyInWorkspace(parentId: string): boolean {
    return templates.some(t => t.parentId === parentId && t.sourceLevel === 'user');
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

  function startEdit(id: string) {
    const template = templates.find(t => t.id === id);
    if (!template) return;
    editingId = template.id;
    editDescriptor = JSON.stringify(template.descriptor, null, 2);
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
  {:else if templates.length === 0}
    <div class="rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <p class="text-sm text-slate-500">No view templates found for this workspace type.</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each templates as template (template.id)}
        <ConfigItemCard
          item={{
            id: template.id,
            name: OBJECT_TYPE_LABELS[template.objectType] ?? template.objectType,
            key: template.objectType,
            description: template.maturityStage
              ? `Stage: ${template.maturityStage} · ${describeTemplate(template.descriptor)}`
              : describeTemplate(template.descriptor),
            sourceLevel: template.sourceLevel,
            parentId: template.parentId,
          }}
          hasCopy={hasCopyInWorkspace(template.id)}
          onCopy={(id) => void handleCopy(id)}
          onEdit={(id) => startEdit(id)}
          onReset={(id) => void handleReset(id)}
          onDelete={(id) => void handleDelete(id)}
        >
          {#if editingId === template.id}
            <div class="mt-3 space-y-2">
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
          {/if}
        </ConfigItemCard>
      {/each}
    </div>
  {/if}
</div>
