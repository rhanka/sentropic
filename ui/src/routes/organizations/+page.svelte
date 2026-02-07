<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // {@html} is only used with sanitized HTML produced by renderInlineMarkdown().
  import { organizationsStore, fetchOrganizations, deleteOrganization } from '$lib/stores/organizations';
  import { addToast } from '$lib/stores/toast';
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { streamHub } from '$lib/stores/streamHub';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import FileMenu from '$lib/components/FileMenu.svelte';
  import ImportExportDialog from '$lib/components/ImportExportDialog.svelte';
import { getScopedWorkspaceIdForUser, workspaceReadOnlyScope, workspaceScopeHydrated, workspaceScope, selectedWorkspace } from '$lib/stores/workspaceScope';
  import { renderInlineMarkdown } from '$lib/utils/markdown';
  import { Lock, Trash2 } from '@lucide/svelte';

  const HUB_KEY = 'organizationsList';
  let isReadOnly = false;
  $: isReadOnly = $workspaceReadOnlyScope;
  $: showReadOnlyLock = $workspaceScopeHydrated && $workspaceReadOnlyScope;
let showImportDialog = false;
let showExportDialog = false;
$: workspaceName = $selectedWorkspace?.name || '';

  onMount(() => {
    void (async () => {
      await loadOrganizations();
    })();

    // Abonnement SSE global via streamHub
    streamHub.set(HUB_KEY, (evt: any) => {
      if (evt?.type !== 'organization_update') return;
      const organizationId: string = evt.organizationId;
      const data: any = evt.data ?? {};
      if (!organizationId) return;

      if (data?.deleted) {
        organizationsStore.update((items) => items.filter((o) => o.id !== organizationId));
        return;
      }

      if (data?.organization) {
        const updated = data.organization;
        organizationsStore.update((items) => {
          const idx = items.findIndex((o) => o.id === updated.id);
          if (idx === -1) return [updated, ...items];
          const next = [...items];
          next[idx] = { ...next[idx], ...updated };
          return next;
        });
      }
    });

    // Reload on workspace selection change
    let lastScope = $workspaceScope.selectedId;
    const unsub = workspaceScope.subscribe((s) => {
      if (s.selectedId !== lastScope) {
        lastScope = s.selectedId;
        void loadOrganizations();
      }
    });
    return () => unsub();
  });

  onDestroy(() => {
    streamHub.delete(HUB_KEY);
  });

  const loadOrganizations = async () => {
    try {
      const orgs = await fetchOrganizations();
      organizationsStore.set(orgs);
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement des organisations'
      });
    }
  };

const handleImportComplete = async () => {
  await loadOrganizations();
};

  const handleDeleteOrganization = async (id: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette organisation ?")) return;

    try {
      await deleteOrganization(id);
      organizationsStore.update((items) => items.filter((o) => o.id !== id));

      addToast({
        type: 'success',
        message: 'Organisation supprimée avec succès !'
      });
    } catch (err) {
      console.error('Failed to delete organization:', err);
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erreur lors de la suppression'
      });
    }
  };


  const openOrganization = (organization: { id: string; status?: string }) => {
    const isDraft = organization.status === 'draft';
    // UX: un brouillon se reprend via la vue `new` (icônes IA / save / annuler).
    if (isDraft) {
      goto(`/organizations/new?draft=${encodeURIComponent(organization.id)}`);
      return;
    }
    goto(`/organizations/${organization.id}`);
  };
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">Organisations</h1>
    {#if !isReadOnly}
      <FileMenu
        showNew={true}
        showImport={true}
        showExport={true}
        showPrint={false}
        showDelete={false}
        onNew={() => goto('/organizations/new')}
        onImport={() => (showImportDialog = true)}
        onExport={() => (showExportDialog = true)}
        triggerTitle="Actions organisation"
        triggerAriaLabel="Actions organisation"
      />
    {:else if showReadOnlyLock}
      <button
        class="rounded p-2 transition text-slate-400 cursor-not-allowed"
        title="Mode lecture seule : création / suppression désactivées."
        aria-label="Mode lecture seule : création / suppression désactivées."
        type="button"
        disabled
      >
        <Lock class="w-5 h-5" />
      </button>
    {/if}
  </div>

  <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
    {#each $organizationsStore as organization}
      {@const isEnriching = organization.status === 'enriching'}
      {@const isDraft = organization.status === 'draft'}
      {@const canClick = !isEnriching}
      <article
        {...(canClick ? { role: 'button', tabindex: 0 } : {})}
        class="rounded border border-slate-200 bg-white shadow-sm transition-shadow group flex flex-col h-full {isEnriching ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md cursor-pointer'}"
        on:click={() => { if (canClick) openOrganization(organization); }}
        on:keydown={(e) => { if (canClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openOrganization(organization); } }}
      >
        {#if isEnriching}
          <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-purple-200 bg-purple-50 gap-2 rounded-t-lg">
            <div class="flex-1 min-w-0">
                    <h2 class="text-lg sm:text-xl font-medium truncate text-purple-800">{organization.name}</h2>
            </div>
            {#if !isReadOnly}
              <button
                class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded flex-shrink-0"
                on:click|stopPropagation={() => handleDeleteOrganization(organization.id)}
                title="Supprimer l'organisation"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            {/if}
          </div>
          <div class="p-3 sm:p-4">
            <StreamMessage
                      streamId={`organization_${organization.id}`}
                      status={organization.status}
              maxHistory={6}
              placeholderTitle="Enrichissement en cours…"
            />
          </div>
        {:else}
          <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-purple-200 bg-purple-50 gap-2 rounded-t-lg">
            <div class="flex-1 min-w-0">
                    <h2 class="text-lg sm:text-xl font-medium truncate text-purple-800 group-hover:text-purple-900 transition-colors">{organization.name}</h2>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              {#if !isReadOnly}
                <button
                  class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                  on:click|stopPropagation={() => handleDeleteOrganization(organization.id)}
                  title="Supprimer"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              {/if}
            </div>
          </div>

          <div class="p-3 sm:p-4 pt-2 flex-1 min-h-0">
                    {#if organization.industry || organization.size}
              <div class="flex flex-col gap-1 mb-3">
                        {#if organization.industry}
                          <p class="text-sm text-slate-600">Secteur: {organization.industry}</p>
                {/if}
                        {#if organization.size}
                  <p class="text-sm text-slate-500 line-clamp-2 break-words">
                            Taille: <span>{@html renderInlineMarkdown(organization.size)}</span>
                  </p>
                {/if}
              </div>
            {/if}
                    {#if organization.products}
              <div class="text-sm text-slate-600 line-clamp-2 break-words">
                        {@html renderInlineMarkdown(organization.products)}
              </div>
            {/if}
          </div>

          <div class="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-slate-100">
            <span class="text-xs text-slate-400 whitespace-nowrap">
              {#if isDraft}
                Brouillon
              {:else}
                Cliquez pour voir les détails
              {/if}
            </span>
            <div class="flex items-center gap-2 flex-wrap">
              {#if isDraft}
                <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 whitespace-nowrap">
                  Brouillon
                </span>
              {:else}
                <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 whitespace-nowrap">
                  Active
                </span>
              {/if}
            </div>
          </div>
        {/if}
      </article>
    {/each}
  </div>
</section>

<ImportExportDialog
  bind:open={showImportDialog}
  mode="import"
  title="Importer une organisation"
  scope="organization"
  defaultTargetWorkspaceId={getScopedWorkspaceIdForUser()}
  importObjectTypes={['organizations']}
  on:imported={handleImportComplete}
/>

<ImportExportDialog
  bind:open={showExportDialog}
  mode="export"
  title="Exporter les organisations"
  scope="workspace"
  allowScopeSelect={false}
  allowScopeIdEdit={false}
  workspaceName={workspaceName}
  objectName="Toutes les organisations"
  objectLabel="Organisation"
  fixedInclude={['organizations']}
  includeOptions={[{ id: 'folders', label: 'Inclure les dossiers rattachés', defaultChecked: false }]}
  includeDependencies={{ folders: ['usecases', 'matrix'] }}
  includeAffectsComments={['folders']}
  includeAffectsDocuments={['folders']}
  exportKind="organizations"
/>


