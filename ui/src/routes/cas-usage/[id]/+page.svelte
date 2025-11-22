<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { useCasesStore } from '$lib/stores/useCases';
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPut } from '$lib/utils/api';
  import { goto } from '$app/navigation';
  import UseCaseDetail from '$lib/components/UseCaseDetail.svelte';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { refreshManager } from '$lib/stores/refresh';

  let useCase: any = undefined;
  let isEditing = false;
  let draft: any = {};
  let error = '';
  let matrix: MatrixConfig | null = null;
  let calculatedScores: any = null;

  $: useCaseId = $page.params.id;

  // Réactivité pour détecter les changements de statut et gérer l'actualisation
  $: if (useCase) {
    const isGenerating = useCase.status === 'generating' || useCase.status === 'detailing';
    
    if (isGenerating) {
      // Démarrer l'actualisation légère si ce n'est pas déjà fait
      if (!refreshManager.isRefreshActive(`useCase-${useCase.id}`)) {
        refreshManager.startUseCaseDetailRefresh(useCase.id, async () => {
          await refreshUseCaseStatus();
        });
      }
    } else {
      // Arrêter l'actualisation si la génération est terminée
      refreshManager.stopRefresh(`useCase-${useCase.id}`);
    }
  }

  onMount(() => {
    loadUseCase();
    // Démarrer l'actualisation automatique si le cas d'usage est en génération
    startAutoRefresh();
    
    // Force display of all sections when printing
    const handleBeforePrint = () => {
      // Add print class to body to trigger print styles
      document.body.classList.add('printing');
      
      // Force all sections to be visible (Svelte conditionals might hide them)
      const useCasePrint = document.querySelector('.usecase-print');
      if (useCasePrint) {
        // Force display of all child divs
        useCasePrint.querySelectorAll('div').forEach(el => {
          const htmlEl = el as HTMLElement;
          if (htmlEl.style.display === 'none') {
            htmlEl.style.display = '';
          }
        });
      }

      // Force margin-top to 0 for section and usecase-print containers
      const section = document.querySelector('section.space-y-6');
      if (section) {
        const htmlEl = section as HTMLElement;
        htmlEl.style.marginTop = '0';
        htmlEl.style.paddingTop = '0';
      }
      if (useCasePrint) {
        const htmlEl = useCasePrint as HTMLElement;
        htmlEl.style.marginTop = '0';
        htmlEl.style.paddingTop = '0';
      }
    };
    
    const handleAfterPrint = () => {
      document.body.classList.remove('printing');
    };
    
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  });

  onDestroy(() => {
    // Arrêter tous les refreshes quand on quitte la page
    refreshManager.stopAllRefreshes();
  });

  const loadUseCase = async () => {
    try {
      // Charger depuis l'API pour avoir les données les plus récentes
      useCase = await apiGet(`/use-cases/${useCaseId}`);
      
      // Mettre à jour le store avec les données fraîches
      useCasesStore.update(items => 
        items.map(uc => uc.id === useCaseId ? useCase : uc)
      );
      
      if (useCase) {
        draft = { 
          ...useCase,
          dataSourcesText: useCase.dataSources ? useCase.dataSources.join('\n') : '',
          dataObjectsText: useCase.dataObjects ? useCase.dataObjects.join('\n') : ''
        };
        await loadMatrixAndCalculateScores();
      }
    } catch (err) {
      console.error('Failed to fetch use case:', err);
      // Fallback sur le store local en cas d'erreur
      const useCases = $useCasesStore;
      useCase = useCases.find(uc => uc.id === useCaseId);
      
      if (!useCase) {
        addToast({ type: 'error', message: 'Erreur lors du chargement du cas d\'usage' });
        error = 'Erreur lors du chargement du cas d\'usage';
        return;
      }
      
      draft = { 
        ...useCase,
        dataSourcesText: useCase.dataSources ? useCase.dataSources.join('\n') : '',
        dataObjectsText: useCase.dataObjects ? useCase.dataObjects.join('\n') : ''
      };
      await loadMatrixAndCalculateScores();
    }
  };

  // Refresh léger du cas d'usage - met à jour seulement les champs qui changent
  const refreshUseCaseStatus = async () => {
    try {
      const updatedUseCase = await apiGet(`/use-cases/${useCaseId}`);
      
      // Mettre à jour seulement les champs qui changent (status, etc.)
      if (useCase) {
        useCase = { ...useCase, ...updatedUseCase };
        draft = { ...useCase };
        
        // Mettre à jour le store
        useCasesStore.update(items => 
          items.map(uc => uc.id === useCaseId ? useCase : uc)
        );
      }
    } catch (error) {
      console.error('Failed to refresh use case status:', error);
    }
  };

  const handleUpdateUseCase = async () => {
    if (!useCase || !draft.name?.trim()) return;

    try {
      // Convertir les textes en arrays
      const updatedDraft = {
        ...draft,
        dataSources: draft.dataSourcesText ? draft.dataSourcesText.split('\n').filter(line => line.trim()) : draft.dataSources || [],
        dataObjects: draft.dataObjectsText ? draft.dataObjectsText.split('\n').filter(line => line.trim()) : draft.dataObjects || []
      };
      
      useCasesStore.update(items => items.map(uc => uc.id === useCase.id ? { ...uc, ...updatedDraft } : uc));
      useCase = { ...useCase, ...updatedDraft };
      isEditing = false;
      addToast({ type: 'success', message: 'Cas d\'usage mis à jour avec succès !' });
    } catch (err) {
      console.error('Failed to update use case:', err);
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur lors de la mise à jour' });
    }
  };

  const handleDelete = async () => {
    if (!useCase || !confirm('Êtes-vous sûr de vouloir supprimer ce cas d\'usage ?')) return;

    try {
      useCasesStore.update(items => items.filter(uc => uc.id !== useCase?.id));
      addToast({ type: 'success', message: 'Cas d\'usage supprimé avec succès !' });
      goto('/cas-usage');
    } catch (err) {
      console.error('Failed to delete use case:', err);
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur lors de la suppression' });
    }
  };

  const handleCancel = () => {
    if (useCase) {
      draft = { ...useCase };
    }
    isEditing = false;
    error = '';
  };

  const loadMatrixAndCalculateScores = async () => {
    if (!useCase?.folderId) return;
    
    try {
      // Charger la matrice depuis le dossier
      const folder = await apiGet(`/folders/${useCase.folderId}`);
      matrix = folder.matrixConfig;
      
      if (matrix && useCase.valueScores && useCase.complexityScores) {
        calculatedScores = calculateUseCaseScores(
          matrix,
          useCase.valueScores,
          useCase.complexityScores
        );
      }
    } catch (err) {
      console.error('Failed to load matrix:', err);
    }
  };

  const startAutoRefresh = () => {
    // Vérifier si le cas d'usage est en génération
    if (useCase && (useCase.status === 'generating' || useCase.status === 'detailing' || useCase.status === 'pending')) {
      // Démarrer l'actualisation légère pour ce cas d'usage spécifique
      refreshManager.startUseCaseDetailRefresh(useCase.id, async () => {
        await refreshUseCaseStatus();
      });
    }
  };
</script>

<section class="space-y-6">
  {#if error}
    <div class="rounded bg-red-50 border border-red-200 p-4 text-red-700 mb-6">
      {error}
    </div>
  {/if}

  {#if useCase}
    <UseCaseDetail
      {useCase}
      {matrix}
      {calculatedScores}
      mode="view"
      {isEditing}
      {draft}
    >
      <svelte:fragment slot="actions-view">
            <button
              on:click={() => window.print()}
              class="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
              title="Imprimer ou exporter en PDF"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path>
              </svg>
            </button>
            <button 
              class="rounded bg-blue-500 px-4 py-2 text-white"
              on:click={() => isEditing = true}
            >
              Modifier
            </button>
            <button 
              class="rounded bg-red-500 px-4 py-2 text-white"
              on:click={handleDelete}
            >
              Supprimer
            </button>
      </svelte:fragment>
      <svelte:fragment slot="actions-edit">
        <button 
          class="rounded bg-primary px-4 py-2 text-white"
          on:click={handleUpdateUseCase}
          disabled={!draft.name?.trim()}
        >
          Enregistrer
        </button>
        <button 
          class="rounded border border-slate-300 px-4 py-2"
          on:click={handleCancel}
        >
          Annuler
        </button>
      </svelte:fragment>
    </UseCaseDetail>
  {/if}
</section>
