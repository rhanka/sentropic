<script lang="ts">
  import { companiesStore, fetchCompanies, deleteCompany, type Company } from '$lib/stores/companies';
  import { addToast } from '$lib/stores/toast';
  import { onMount } from 'svelte';

  onMount(async () => {
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
  });

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
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={() => window.location.href = '/entreprises/new'}>
      Ajouter
    </button>
  </div>

  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    {#each $companiesStore as company}
      <article class="rounded border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer group" 
               on:click={() => window.location.href = `/entreprises/${company.id}`}>
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <h2 class="text-xl font-medium group-hover:text-blue-600 transition-colors">{company.name}</h2>
            {#if company.industry}
              <p class="mt-1 text-sm text-slate-600">Secteur: {company.industry}</p>
            {/if}
            {#if company.size}
              <p class="mt-1 text-sm text-slate-500">Taille: {company.size}</p>
            {/if}
          </div>
          <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              class="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded"
              on:click|stopPropagation={() => window.location.href = `/entreprises/${company.id}`}
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
        {#if company.products}
          <div class="mt-2 text-sm text-slate-600 line-clamp-2">{company.products}</div>
        {/if}
        <div class="mt-3 flex items-center justify-between">
          <span class="text-xs text-slate-400">
            Cliquez pour voir les détails
          </span>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Active
            </span>
          </div>
        </div>
      </article>
    {/each}
  </div>
</section>