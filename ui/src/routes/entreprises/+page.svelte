<script lang="ts">
  import { companiesStore, fetchCompanies, deleteCompany, type Company } from '$lib/stores/companies';
  import { addToast } from '$lib/stores/toast';
  import { onMount, onDestroy } from 'svelte';
  import { refreshManager } from '$lib/stores/refresh';
  import { goto } from '$app/navigation';

  // Réactivité pour détecter les changements de statut et gérer l'actualisation
  $: {
    const hasEnrichingCompanies = $companiesStore.some(company => company.status === 'enriching');
    
    if (hasEnrichingCompanies) {
      // Démarrer l'actualisation légère si ce n'est pas déjà fait
      if (!refreshManager.isRefreshActive('companies')) {
        refreshManager.startCompaniesRefresh(async () => {
          await loadCompanies();
        });
      }
    } else {
      // Arrêter l'actualisation si aucun enrichissement n'est en cours
      refreshManager.stopRefresh('companies');
    }
  }

  onMount(async () => {
    await loadCompanies();
    // Démarrer l'actualisation automatique si nécessaire
    startAutoRefresh();
  });

  onDestroy(() => {
    // Arrêter tous les refreshes quand on quitte la page
    refreshManager.stopAllRefreshes();
  });

  const loadCompanies = async () => {
    try {
      const companies = await fetchCompanies();
      companiesStore.set(companies);
    } catch (err) {
      console.error('Failed to fetch companies:', err);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement des entreprises'
      });
    }
  };

  const startAutoRefresh = () => {
    // L'auto-refresh est géré par la réactivité ci-dessus
  };

  const handleDeleteCompany = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette entreprise ?')) return;
    
    try {
      await deleteCompany(id);
      companiesStore.update((items) => items.filter(c => c.id !== id));
      
      addToast({
        type: 'success',
        message: 'Entreprise supprimée avec succès !'
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
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">Entreprises</h1>
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={() => goto('/entreprises/new')}>
      Ajouter
    </button>
  </div>

  <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
    {#each $companiesStore as company}
      {@const isEnriching = company.status === 'enriching'}
      {@const isDraft = company.status === 'draft'}
      <article class="rounded border border-slate-200 bg-white shadow-sm transition-shadow group flex flex-col h-full {isEnriching ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md cursor-pointer'}" 
               on:click={() => { if (!isEnriching) goto(`/entreprises/${company.id}`); }}>
        {#if isEnriching}
          <!-- Vue pour l'enrichissement avec nom et bouton de suppression -->
          <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-purple-200 bg-purple-50 gap-2 rounded-t-lg">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg sm:text-xl font-medium truncate text-purple-800">{company.name}</h2>
              <p class="text-sm text-purple-600 mt-1">Enrichissement en cours...</p>
            </div>
            <button 
              class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded flex-shrink-0"
              on:click|stopPropagation={() => handleDeleteCompany(company.id)}
              title="Supprimer l'entreprise"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>
          <!-- Bouton d'enrichissement centré -->
          <div class="flex flex-col items-center justify-center h-24 text-center p-3 sm:p-4">
            <div class="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-yellow-100 text-yellow-800 mb-2 whitespace-nowrap">
              <svg class="w-4 h-4 mr-2 animate-spin flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
              Enrichissement par IA en cours
            </div>
            <p class="text-xs text-slate-500">Veuillez patienter...</p>
          </div>
        {:else}
          <!-- Vue normale pour les autres statuts -->
          <!-- Header -->
          <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-purple-200 bg-purple-50 gap-2 rounded-t-lg">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg sm:text-xl font-medium truncate text-purple-800 group-hover:text-purple-900 transition-colors">{company.name}</h2>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button 
                class="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded"
                on:click|stopPropagation={() => goto(`/entreprises/${company.id}`)}
                title="Voir les détails"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                </svg>
              </button>
              <button 
                class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                on:click|stopPropagation={() => handleDeleteCompany(company.id)}
                title="Supprimer"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
              </button>
            </div>
          </div>
          
          <!-- Body -->
          <div class="p-3 sm:p-4 pt-2 flex-1 min-h-0">
            {#if company.industry || company.size}
              <div class="flex flex-col gap-1 mb-3">
                {#if company.industry}
                  <p class="text-sm text-slate-600">Secteur: {company.industry}</p>
                {/if}
                {#if company.size}
                  <p class="text-sm text-slate-500">Taille: {company.size}</p>
                {/if}
              </div>
            {/if}
            {#if company.products}
              <div class="text-sm text-slate-600 line-clamp-2">{company.products}</div>
            {/if}
          </div>
          
          <!-- Footer -->
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