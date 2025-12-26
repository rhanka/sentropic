<script lang="ts">
  import { companiesStore, currentCompanyId, fetchCompanies } from '$lib/stores/companies';
  import { addToast } from '$lib/stores/toast';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let currentInput = '';
  let createNewFolder = true;
  let isLoading = true;

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
    } finally {
      isLoading = false;
    }
  });

  const handleSubmit = async () => {
    if (!currentInput.trim()) {
      addToast({
        type: 'error',
        message: 'Veuillez préciser un contexte.'
      });
      return;
    }
    
    isLoading = true;
    
    try {
      // Navigation vers la page des cas d'usage qui gérera la génération
      const params = new URLSearchParams({
        generate: 'true',
        context: currentInput,
        createNewFolder: createNewFolder.toString(),
        companyId: $currentCompanyId || ''
      });
      
      goto(`/cas-usage?${params.toString()}`);
      
    } catch (error) {
      console.error('Failed to start generation:', error);
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Erreur lors du démarrage de la génération'
      });
    } finally {
      isLoading = false;
    }
  };
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">Générez vos cas d'usage</h1>
    {#if !isLoading && $companiesStore.length > 0}
      <div class="text-sm text-slate-600">
        {$companiesStore.length} entreprise{$companiesStore.length > 1 ? 's' : ''} disponible{$companiesStore.length > 1 ? 's' : ''}
      </div>
    {/if}
  </div>
  
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
    <label class="block space-y-2">
      <span class="text-sm font-medium text-slate-700">Décrivez votre contexte</span>
      <textarea
        class="h-40 w-full rounded border border-slate-300 p-3"
        bind:value={currentInput}
        placeholder="Ex: Optimisation du support client dans la banque retail"
      ></textarea>
    </label>
    <label class="block space-y-2">
      <span class="text-sm font-medium text-slate-700">Entreprise (optionnel)</span>
      {#if isLoading}
        <div class="w-full rounded border border-slate-300 p-2 bg-slate-50 text-slate-500">
          Chargement des entreprises...
        </div>
      {:else}
        <select
          class="w-full rounded border border-slate-300 p-2"
          bind:value={$currentCompanyId}
        >
          <option value="">Non spécifié</option>
          {#each $companiesStore as company}
            <option value={company.id}>
              {company.name} {#if company.industry}({company.industry}){/if}
            </option>
          {/each}
        </select>
        {#if $companiesStore.length === 0}
          <p class="text-sm text-slate-500 mt-1">
            Aucune entreprise disponible. 
            <a href="/organisations" class="text-blue-600 hover:text-blue-800 underline">
              Créer une organisation
            </a>
          </p>
        {/if}
      {/if}
    </label>
    <label class="flex items-center gap-2 text-sm text-slate-600">
      <input type="checkbox" bind:checked={createNewFolder} />
      Créer automatiquement un nouveau dossier
    </label>
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={handleSubmit}>
      Générer vos cas d'usage
    </button>
  </div>

  <!-- Section des entreprises récentes -->
  {#if !isLoading && $companiesStore.length > 0}
    <div class="rounded border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Organisations disponibles</h2>
        <a href="/organisations" class="text-sm text-blue-600 hover:text-blue-800 underline">
          Voir toutes les organisations
        </a>
      </div>
      <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {#each $companiesStore.slice(0, 6) as company}
          <div class="rounded border border-slate-200 p-3 hover:bg-slate-50 transition-colors">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <h3 class="font-medium text-slate-900">{company.name}</h3>
                {#if company.industry}
                  <p class="text-sm text-slate-600 mt-1">{company.industry}</p>
                {/if}
                {#if company.products}
                  <p class="text-xs text-slate-500 mt-1 line-clamp-2">{company.products}</p>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
      {#if $companiesStore.length > 6}
        <div class="mt-4 text-center">
          <a href="/organisations" class="text-sm text-blue-600 hover:text-blue-800 underline">
            Voir {$companiesStore.length - 6} autres organisations...
          </a>
        </div>
      {/if}
    </div>
  {/if}
</section>
