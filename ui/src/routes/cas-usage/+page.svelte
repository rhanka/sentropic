<script lang="ts">
  import { useCasesStore, fetchUseCases, deleteUseCase } from '$lib/stores/useCases';
  import { currentFolderId } from '$lib/stores/folders';
  import { addToast, removeToast } from '$lib/stores/toast';
  import { apiGet, apiPost } from '$lib/utils/api';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { streamHub } from '$lib/stores/streamHub';
  import StreamMessage from '$lib/components/StreamMessage.svelte';

  let isLoading = false;
  let matrix: MatrixConfig | null = null;
  const HUB_KEY = 'useCasesPage';

  // Helper to create array of indices for iteration
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

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

    // SSE: usecase_update + folder_update (pour matrixConfig)
    streamHub.set(HUB_KEY, (evt: any) => {
      if (evt?.type === 'usecase_update') {
        const useCaseId: string = evt.useCaseId;
        const data: any = evt.data ?? {};
        if (!useCaseId) return;
        if (data?.deleted) {
          useCasesStore.update((items) => items.filter(uc => uc.id !== useCaseId));
          return;
        }
        if (data?.useCase) {
          const updated = data.useCase;
          useCasesStore.update((items) => {
            const idx = items.findIndex(uc => uc.id === updated.id);
            if (idx === -1) return [updated, ...items];
            const next = [...items];
            next[idx] = { ...next[idx], ...updated };
            return next;
          });
        }
        return;
      }
      if (evt?.type === 'folder_update') {
        const folderId: string = evt.folderId;
        const data: any = evt.data ?? {};
        if (!folderId || folderId !== $currentFolderId) return;
        if (data?.folder?.matrixConfig) {
          matrix = data.folder.matrixConfig;
        }
      }
    });
  });

  onDestroy(() => {
    streamHub.delete(HUB_KEY);
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

  // Polling désactivé: cas d'usage se mettent à jour via SSE (usecase_update)

  const startGeneration = async (context: string, createNewFolder: boolean, companyId: string | null) => {
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
    }
  };


  const handleUseCaseClick = (useCaseId: string, status: string) => {
    // Si le cas d'usage est en cours de génération ou détail, ne pas naviguer
    if (status === 'generating' || status === 'detailing') {
      return;
    }
    
    // Naviguer vers la vue détaillée du cas d'usage
    goto(`/cas-usage/${useCaseId}`);
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
  
  {#if isLoading}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <p class="text-sm text-blue-700">Chargement des cas d'usage...</p>
    </div>
  {/if}
  
  <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
    {#each $useCasesStore as useCase}
      {@const isDetailing = useCase.status === 'detailing'}
      {@const isDraft = useCase.status === 'draft'}
      {@const isGenerating = useCase.status === 'generating'}
      {@const canClick = !(isDetailing || isGenerating)}
      <article 
        {...(canClick ? { role: 'button', tabindex: 0 } : {})}
        class="rounded border border-slate-200 bg-white shadow-sm transition-shadow group flex flex-col h-full {(isDetailing || isGenerating) ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md cursor-pointer'}" 
        on:click={() => canClick && handleUseCaseClick(useCase.id, useCase.status || 'completed')}
        on:keydown={(e) => {
          if (canClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handleUseCaseClick(useCase.id, useCase.status || 'completed');
          }
        }}>
        <!-- Header -->
        <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-blue-200 bg-blue-50 gap-2 rounded-t-lg">
          <div class="flex-1 min-w-0">
            <h2 class="text-lg sm:text-xl font-medium truncate {(isDetailing || isGenerating) ? 'text-slate-400' : 'text-blue-800 group-hover:text-blue-900 transition-colors'}">{useCase?.data?.name || useCase?.name || 'Cas d\'usage sans nom'}</h2>
          </div>
          <button 
            class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            on:click|stopPropagation={() => handleDeleteUseCase(useCase.id)}
            title="Supprimer"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>
        
        <!-- Body -->
        <div class="p-3 sm:p-4 pt-2 flex-1 min-h-0">
          {#if useCase?.data?.description || useCase?.description}
            <p class="text-sm text-slate-600 line-clamp-2 mb-3">{useCase?.data?.description || useCase?.description || ''}</p>
          {/if}
          {#if isDetailing || isGenerating}
            <StreamMessage streamId={`usecase_${useCase.id}`} status={useCase.status} maxHistory={6} />
          {:else}
          <div class="flex flex-col sm:flex-row gap-2 sm:gap-4 text-sm text-slate-500">
            <div class="flex items-center gap-1 flex-wrap">
              <span class="whitespace-nowrap">Valeur:</span>
              {#if matrix}
                {@const valueScores = useCase?.data?.valueScores || useCase?.valueScores}
                {@const complexityScores = useCase?.data?.complexityScores || useCase?.complexityScores}
                {#if valueScores && complexityScores}
                  {@const calculatedScores = calculateUseCaseScores(matrix, valueScores, complexityScores)}
                  {@const valueStars = calculatedScores.valueStars}
                <div class="flex items-center gap-0.5">
                  {#each range(5) as i (i)}
                    {#if i < valueStars}
                      <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-yellow-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                      </svg>
                    {:else}
                      <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-300 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                      </svg>
                    {/if}
                  {/each}
                </div>
                {:else}
                  <span class="text-gray-400">N/A</span>
                {/if}
              {:else}
                <span class="text-gray-400">N/A</span>
              {/if}
            </div>
            <div class="flex items-center gap-1 flex-wrap">
              <span class="whitespace-nowrap">Complexité:</span>
              {#if matrix}
                {@const valueScores = useCase?.data?.valueScores || useCase?.valueScores}
                {@const complexityScores = useCase?.data?.complexityScores || useCase?.complexityScores}
                {#if valueScores && complexityScores}
                  {@const calculatedScores = calculateUseCaseScores(matrix, valueScores, complexityScores)}
                  {@const complexityStars = calculatedScores.complexityStars}
                <div class="flex items-center gap-0.5">
                  {#each range(5) as i (i)}
                    {#if i < complexityStars}
                      <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                      </svg>
                    {:else}
                      <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path>
                      </svg>
                    {/if}
                  {/each}
                </div>
                {:else}
                  <span class="text-gray-400">N/A</span>
                {/if}
              {:else}
                <span class="text-gray-400">N/A</span>
              {/if}
            </div>
          </div>
          {/if}
        </div>
        
        <!-- Footer -->
        <div class="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-slate-100">
          <span class="text-xs text-slate-400 whitespace-nowrap">
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
          <div class="flex items-center gap-2 flex-wrap">
            {#if useCase.model}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap">
                {useCase.model}
              </span>
            {/if}
            {#if isDetailing}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 whitespace-nowrap">
                <svg class="w-3 h-3 mr-1 animate-spin flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
                Détail en cours
              </span>
            {:else if isGenerating}
              <!-- badge supprimé (streamMessage affiche le suivi) -->
            {:else if isDraft}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 whitespace-nowrap">
                Brouillon
              </span>
            {/if}
          </div>
        </div>
      </article>
    {/each}
  </div>
</section>
