<script lang="ts">
  import { organizationsStore, currentOrganizationId, fetchOrganizations } from '$lib/stores/organizations';
  import { addToast } from '$lib/stores/toast';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let currentInput = '';
  let createNewFolder = true;
  let isLoading = true;

  onMount(async () => {
    try {
      const organizations = await fetchOrganizations();
      organizationsStore.set(organizations);
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement des organisations'
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
        organizationId: $currentOrganizationId || ''
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
    {#if !isLoading && $organizationsStore.length > 0}
      <div class="text-sm text-slate-600">
        {$organizationsStore.length} organisation{$organizationsStore.length > 1 ? 's' : ''} disponible{$organizationsStore.length > 1 ? 's' : ''}
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
      <span class="text-sm font-medium text-slate-700">Organisation (optionnel)</span>
      {#if isLoading}
        <div class="w-full rounded border border-slate-300 p-2 bg-slate-50 text-slate-500">
          Chargement des organisations...
        </div>
      {:else}
        <select
          class="w-full rounded border border-slate-300 p-2"
          bind:value={$currentOrganizationId}
        >
          <option value="">Non spécifié</option>
          {#each $organizationsStore as organization}
            <option value={organization.id}>
              {organization.name} {#if organization.industry}({organization.industry}){/if}
            </option>
          {/each}
        </select>
        {#if $organizationsStore.length === 0}
          <p class="text-sm text-slate-500 mt-1">
            Aucune organisation disponible. 
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
  {#if !isLoading && $organizationsStore.length > 0}
    <div class="rounded border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Organisations disponibles</h2>
        <a href="/organisations" class="text-sm text-blue-600 hover:text-blue-800 underline">
          Voir toutes les organisations
        </a>
      </div>
      <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {#each $organizationsStore.slice(0, 6) as organization}
          <div class="rounded border border-slate-200 p-3 hover:bg-slate-50 transition-colors">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <h3 class="font-medium text-slate-900">{organization.name}</h3>
                {#if organization.industry}
                  <p class="text-sm text-slate-600 mt-1">{organization.industry}</p>
                {/if}
                {#if organization.products}
                  <p class="text-xs text-slate-500 mt-1 line-clamp-2">{organization.products}</p>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
      {#if $organizationsStore.length > 6}
        <div class="mt-4 text-center">
          <a href="/organisations" class="text-sm text-blue-600 hover:text-blue-800 underline">
            Voir {$organizationsStore.length - 6} autres organisations...
          </a>
        </div>
      {/if}
    </div>
  {/if}
</section>
