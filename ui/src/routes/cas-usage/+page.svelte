<script lang="ts">
  import { useCasesStore, fetchUseCases, deleteUseCase, detailUseCase } from '$lib/stores/useCases';
  import { currentFolderId } from '$lib/stores/folders';
  import { addToast, removeToast } from '$lib/stores/toast';
  import { apiGet, apiPost } from '$lib/utils/api';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { calculateUseCaseScores, scoreToStars } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { refreshManager } from '$lib/stores/refresh';

  let isLoading = false;
  let isGenerating = false;
  let matrix: MatrixConfig | null = null;

  // Réactivité pour détecter les changements de statut et gérer l'actualisation
  $: {
    const hasGeneratingUseCases = $useCasesStore.some(useCase => 
      useCase.status === 'generating' || useCase.status === 'detailing'
    );
    
    if (hasGeneratingUseCases) {
      // Démarrer l'actualisation légère si ce n'est pas déjà fait
      if (!refreshManager.isRefreshActive('useCases')) {
        refreshManager.startUseCasesRefresh(async () => {
          await refreshUseCasesStatus();
        });
      }
    } else {
      // Arrêter l'actualisation si aucune génération n'est en cours
      refreshManager.stopRefresh('useCases');
    }
  }

  // Réactivité pour recharger les cas d'usage quand le dossier change
  $: if ($currentFolderId) {
    loadUseCases();
  }

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
    } else if ($currentFolderId) {
      // Charger les cas existants seulement si un dossier est sélectionné
      await loadUseCases();
    }

    // Démarrer l'actualisation automatique si nécessaire
    startAutoRefresh();
  });

  onDestroy(() => {
    // Arrêter tous les refreshes quand on quitte la page
    refreshManager.stopAllRefreshes();
  });

  const loadUseCases = async () => {
    isLoading = true;
    try {
      // Charger les cas d'usage depuis l'API
      // Si un dossier est sélectionné, filtrer par ce dossier
      const useCases = await fetchUseCases($currentFolderId || undefined);
      useCasesStore.set(useCases);
      
      // Charger la matrice si on a un dossier sélectionné
      if ($currentFolderId) {
        try {
          const folder = await apiGet(`/folders/${$currentFolderId}`);
          matrix = folder.matrixConfig;
        } catch (err) {
          console.error('Failed to load matrix:', err);
        }
      }
      
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

  // Refresh léger des cas d'usage - met à jour les données complètes
  const refreshUseCasesStatus = async () => {
    try {
      const useCases = await fetchUseCases($currentFolderId || undefined);
      
      // Mettre à jour complètement les cas d'usage pour avoir les données les plus récentes
      useCasesStore.set(useCases);
      
      // Recharger la matrice si nécessaire
      if ($currentFolderId && !matrix) {
        try {
          const folder = await apiGet(`/folders/${$currentFolderId}`);
          matrix = folder.matrixConfig;
        } catch (err) {
          console.error('Failed to load matrix during refresh:', err);
        }
      }
    } catch (error) {
      console.error('Failed to refresh use cases status:', error);
    }
  };

  const startAutoRefresh = () => {
    // Vérifier s'il y a des cas d'usage en génération
    const hasGeneratingUseCases = $useCasesStore.some(useCase => 
      useCase.status === 'generating' || useCase.status === 'detailing'
    );

    if (hasGeneratingUseCases) {
      // Démarrer l'actualisation légère des cas d'usage
      refreshManager.startUseCasesRefresh(async () => {
        await refreshUseCasesStatus();
      });
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
      const result = await apiPost('/use-cases/generate', {
        input: context,
        create_new_folder: createNewFolder,
        company_id: companyId
      });

      // Mettre à jour le toaster de progression
      removeToast(progressToastId);
      progressToastId = addToast({
        type: 'success',
        message: `✅ ${result.message || 'Génération démarrée avec succès'}`,
        duration: 5000
      });

      // Mettre à jour le currentFolderId si un dossier a été créé
      if (result.created_folder_id) {
        currentFolderId.set(result.created_folder_id);
        // Rediriger vers la page dossiers pour voir le statut de génération
        goto('/dossiers');
      } else {
        // Recharger les cas d'usage si aucun nouveau dossier n'a été créé
        await loadUseCases();
      }

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
      {@const isDetailing = useCase.status === 'detailing'}
      {@const isDraft = useCase.status === 'draft'}
      {@const isGenerating = useCase.status === 'generating'}
      <article class="rounded border border-slate-200 bg-white shadow-sm transition-shadow group flex flex-col {(isDetailing || isGenerating) ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md cursor-pointer'}" 
               on:click={() => !(isDetailing || isGenerating) && goto(`/cas-usage/${useCase.id}`)}>
        <!-- Header -->
        <div class="flex justify-between items-start p-4 pb-2 border-b border-slate-100">
          <div class="flex-1 min-w-0">
            <h2 class="text-xl font-medium truncate {(isDetailing || isGenerating) ? 'text-slate-400' : 'group-hover:text-blue-600 transition-colors'}">{useCase.name}</h2>
          </div>
          <button 
            class="ml-2 p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            on:click|stopPropagation={() => handleDeleteUseCase(useCase.id)}
            title="Supprimer"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>
        
        <!-- Body -->
        <div class="p-4 pt-2 flex-1">
          {#if useCase.description}
            <p class="text-sm text-slate-600 line-clamp-2 mb-3">{useCase.description}</p>
          {/if}
          <div class="flex gap-4 text-sm text-slate-500 items-center">
            <div class="flex items-center gap-1">
              <span>Valeur:</span>
              {#if matrix && useCase.valueScores && useCase.complexityScores}
                {@const calculatedScores = calculateUseCaseScores(matrix, useCase.valueScores, useCase.complexityScores)}
                {@const valueStars = calculatedScores.valueStars}
                {#each Array(5) as _, i}
                  {#if i < valueStars}
                    <svg class="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                    </svg>
                  {:else}
                    <svg class="w-4 h-4 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                    </svg>
                  {/if}
                {/each}
              {:else}
                <span class="text-gray-400">N/A</span>
              {/if}
            </div>
            <div class="flex items-center gap-1">
              <span>Complexité:</span>
              {#if matrix && useCase.valueScores && useCase.complexityScores}
                {@const calculatedScores = calculateUseCaseScores(matrix, useCase.valueScores, useCase.complexityScores)}
                {@const complexityStars = calculatedScores.complexityStars}
                {#each Array(5) as _, i}
                  {#if i < complexityStars}
                    <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                  {:else}
                    <svg class="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path>
                    </svg>
                  {/if}
                {/each}
              {:else}
                <span class="text-gray-400">N/A</span>
              {/if}
            </div>
          </div>
        </div>
        
        <!-- Footer -->
        <div class="px-4 pb-4 pt-2 flex items-center justify-between border-t border-slate-100">
          <span class="text-xs text-slate-400">
            {#if isDetailing}
              Détail en cours...
            {:else if isGenerating}
              Génération en cours...
            {:else if isDraft}
              Brouillon
            {:else}
              Cliquez pour voir les détails
            {/if}
          </span>
          <div class="flex items-center gap-2">
            {#if useCase.model}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                {useCase.model}
              </span>
            {/if}
            {#if isDetailing}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                <svg class="w-3 h-3 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
                Détail en cours
              </span>
            {:else if isGenerating}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                <svg class="w-3 h-3 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
                Génération...
              </span>
            {:else if isDraft}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                Brouillon
              </span>
            {/if}
          </div>
        </div>
      </article>
    {/each}
  </div>
</section>
