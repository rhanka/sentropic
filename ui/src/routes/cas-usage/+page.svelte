<script lang="ts">
  import { useCasesStore, fetchUseCases, deleteUseCase } from '$lib/stores/useCases';
  import { currentFolderId } from '$lib/stores/folders';
  import { addToast, removeToast } from '$lib/stores/toast';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let isLoading = false;
  let isGenerating = false;

  onMount(async () => {
    // Vérifier si on doit générer
    const urlParams = new URLSearchParams($page.url.search);
    const shouldGenerate = urlParams.get('generate') === 'true';
    const context = urlParams.get('context');
    const createNewFolder = urlParams.get('createNewFolder') === 'true';
    const companyId = urlParams.get('companyId');
    const folderId = urlParams.get('folder');

    // Si un dossier spécifique est demandé, le sélectionner
    if (folderId) {
      currentFolderId.set(folderId);
      // Nettoyer l'URL
      goto('/cas-usage', { replaceState: true });
    }

    if (shouldGenerate && context) {
      // Nettoyer l'URL pour éviter la regénération
      goto('/cas-usage', { replaceState: true });
      // Lancer la génération
      await startGeneration(context, createNewFolder, companyId);
    } else {
      // Charger les cas existants
      await loadUseCases();
    }
  });

  const loadUseCases = async () => {
    isLoading = true;
    try {
      // Charger les cas d'usage depuis l'API
      // Si un dossier est sélectionné, filtrer par ce dossier
      const useCases = await fetchUseCases($currentFolderId || undefined);
      useCasesStore.set(useCases);
      
      // Si aucun dossier n'est sélectionné, afficher un message
      if (!$currentFolderId) {
        addToast({
          type: 'info',
          message: 'Veuillez sélectionner un dossier pour voir ses cas d\'usage'
        });
      }
    } catch (error) {
      console.error('Failed to fetch use cases:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement des cas d\'usage'
      });
    } finally {
      isLoading = false;
    }
  };

  const startGeneration = async (context: string, createNewFolder: boolean, companyId: string | null) => {
    isGenerating = true;
    let progressToastId = '';
    
    try {
      // Toaster persistant pour le suivi global
      progressToastId = addToast({
        type: 'info',
        message: 'Initialisation de la génération...',
        duration: 0
      });

      // Appeler l'API de génération
      const API_BASE_URL = 'http://localhost:8787/api/v1';
      const response = await fetch(`${API_BASE_URL}/use-cases/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: context,
          create_new_folder: createNewFolder,
          company_id: companyId
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to generate use cases');
      }

      const result = await response.json();

      // Mettre à jour le toaster de progression
      removeToast(progressToastId);
      progressToastId = addToast({
        type: 'success',
        message: `✅ ${result.summary}`,
        duration: 5000
      });

      // Mettre à jour le currentFolderId si un dossier a été créé
      if (result.created_folder_id) {
        currentFolderId.set(result.created_folder_id);
      }

      // Recharger les cas d'usage
      await loadUseCases();

    } catch (error) {
      console.error('Failed to generate use cases:', error);
      if (progressToastId) {
        removeToast(progressToastId);
      }
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Erreur lors de la génération'
      });
    } finally {
      isGenerating = false;
    }
  };


  const handleDeleteUseCase = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce cas d\'usage ?')) return;
    
    try {
      await deleteUseCase(id);
      useCasesStore.update((items) => items.filter(uc => uc.id !== id));
      addToast({
        type: 'success',
        message: 'Cas d\'usage supprimé avec succès !'
      });
    } catch (error) {
      console.error('Failed to delete use case:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la suppression'
      });
    }
  };
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">Cas d'usage</h1>
  
  {#if isGenerating}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <div class="flex items-center gap-3">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
        <p class="text-sm text-blue-700 font-medium">Génération en cours... Veuillez patienter</p>
      </div>
    </div>
  {:else if isLoading}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <p class="text-sm text-blue-700">Chargement des cas d'usage...</p>
    </div>
  {/if}
  
  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    {#each $useCasesStore as useCase}
      <article class="rounded border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer group" 
               on:click={() => window.location.href = `/cas-usage/${useCase.id}`}>
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <h2 class="text-xl font-medium group-hover:text-blue-600 transition-colors">{useCase.name}</h2>
            {#if useCase.description}
              <p class="mt-1 text-sm text-slate-600 line-clamp-2">{useCase.description}</p>
            {/if}
            <div class="mt-2 flex gap-4 text-sm text-slate-500">
              <span>Valeur: {useCase.totalValueScore ?? 'N/A'}</span>
              <span>Complexité: {useCase.totalComplexityScore ?? 'N/A'}</span>
            </div>
          </div>
          <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              class="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded"
              on:click|stopPropagation={() => window.location.href = `/cas-usage/${useCase.id}`}
              title="Voir les détails"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
              </svg>
            </button>
            <button 
              class="p-1 text-green-500 hover:text-green-700 hover:bg-green-50 rounded"
              on:click|stopPropagation={() => window.location.href = `/cas-usage/${useCase.id}`}
              title="Modifier"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
              </svg>
            </button>
            <button 
              class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
              on:click|stopPropagation={() => handleDeleteUseCase(useCase.id)}
              title="Supprimer"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="mt-3 flex items-center justify-between">
          <span class="text-xs text-slate-400">
            Cliquez pour voir les détails
          </span>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Actif
            </span>
          </div>
        </div>
      </article>
    {/each}
  </div>
</section>
