<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // {@html} is only used with sanitized HTML produced by renderInlineMarkdown().
  import { companiesStore, fetchCompanies, deleteCompany } from '$lib/stores/companies';
  import { addToast } from '$lib/stores/toast';
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { streamHub } from '$lib/stores/streamHub';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import { adminWorkspaceScope } from '$lib/stores/adminWorkspaceScope';
  import { adminReadOnlyScope } from '$lib/stores/adminWorkspaceScope';
  import { renderInlineMarkdown } from '$lib/utils/markdown';
  import { Trash2 } from '@lucide/svelte';

  const HUB_KEY = 'companiesList';

  onMount(() => {
    void (async () => {
      await loadCompanies();
    })();

    // Abonnement SSE global via streamHub
    streamHub.set(HUB_KEY, (evt: any) => {
      if (evt?.type !== 'company_update') return;
      const companyId: string = evt.companyId;
      const data: any = evt.data ?? {};
      if (!companyId) return;

      if (data?.deleted) {
        companiesStore.update((items) => items.filter((c) => c.id !== companyId));
        return;
      }

      if (data?.company) {
        const updated = data.company;
        companiesStore.update((items) => {
          const idx = items.findIndex((c) => c.id === updated.id);
          if (idx === -1) return [updated, ...items];
          const next = [...items];
          next[idx] = { ...next[idx], ...updated };
          return next;
        });
      }
    });

    // Reload on admin workspace scope change
    let lastScope = $adminWorkspaceScope.selectedId;
    const unsub = adminWorkspaceScope.subscribe((s) => {
      if (s.selectedId !== lastScope) {
        lastScope = s.selectedId;
        void loadCompanies();
      }
    });
    return () => unsub();
  });

  onDestroy(() => {
    streamHub.delete(HUB_KEY);
  });

  const loadCompanies = async () => {
    try {
      const companies = await fetchCompanies();
      companiesStore.set(companies);
    } catch (err) {
      console.error('Failed to fetch companies:', err);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement des organisations'
      });
    }
  };

  const handleDeleteCompany = async (id: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette organisation ?")) return;

    try {
      await deleteCompany(id);
      companiesStore.update((items) => items.filter((c) => c.id !== id));

      addToast({
        type: 'success',
        message: 'Organisation supprimée avec succès !'
      });
    } catch (err) {
      console.error('Failed to delete company:', err);
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erreur lors de la suppression'
      });
    }
  };
</script>

<section class="space-y-6">
  {#if $adminReadOnlyScope}
    <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      Mode admin — workspace partagé : <b>lecture seule</b> (création / suppression désactivées).
    </div>
  {/if}
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">Organisations</h1>
    {#if !$adminReadOnlyScope}
      <button class="rounded bg-primary px-4 py-2 text-white" on:click={() => goto('/organisations/new')}>
        Ajouter
      </button>
    {/if}
  </div>

  <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
    {#each $companiesStore as company}
      {@const isEnriching = company.status === 'enriching'}
      {@const isDraft = company.status === 'draft'}
      {@const canClick = !isEnriching}
      <article
        {...(canClick ? { role: 'button', tabindex: 0 } : {})}
        class="rounded border border-slate-200 bg-white shadow-sm transition-shadow group flex flex-col h-full {isEnriching ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md cursor-pointer'}"
        on:click={() => { if (canClick) goto(`/organisations/${company.id}`); }}
        on:keydown={(e) => { if (canClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); goto(`/organisations/${company.id}`); } }}
      >
        {#if isEnriching}
          <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-purple-200 bg-purple-50 gap-2 rounded-t-lg">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg sm:text-xl font-medium truncate text-purple-800">{company.name}</h2>
            </div>
            {#if !$adminReadOnlyScope}
              <button
                class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded flex-shrink-0"
                on:click|stopPropagation={() => handleDeleteCompany(company.id)}
                title="Supprimer l'organisation"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            {/if}
          </div>
          <div class="p-3 sm:p-4">
            <StreamMessage
              streamId={`company_${company.id}`}
              status={company.status}
              maxHistory={6}
              placeholderTitle="Enrichissement en cours…"
            />
          </div>
        {:else}
          <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-purple-200 bg-purple-50 gap-2 rounded-t-lg">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg sm:text-xl font-medium truncate text-purple-800 group-hover:text-purple-900 transition-colors">{company.name}</h2>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              {#if !$adminReadOnlyScope}
                <button
                  class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                  on:click|stopPropagation={() => handleDeleteCompany(company.id)}
                  title="Supprimer"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              {/if}
            </div>
          </div>

          <div class="p-3 sm:p-4 pt-2 flex-1 min-h-0">
            {#if company.industry || company.size}
              <div class="flex flex-col gap-1 mb-3">
                {#if company.industry}
                  <p class="text-sm text-slate-600">Secteur: {company.industry}</p>
                {/if}
                {#if company.size}
                  <p class="text-sm text-slate-500 line-clamp-2 break-words">
                    Taille: <span>{@html renderInlineMarkdown(company.size)}</span>
                  </p>
                {/if}
              </div>
            {/if}
            {#if company.products}
              <div class="text-sm text-slate-600 line-clamp-2 break-words">
                {@html renderInlineMarkdown(company.products)}
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


