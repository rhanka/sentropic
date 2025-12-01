<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { useCasesStore, fetchUseCases } from '$lib/stores/useCases';
  import { foldersStore, fetchFolders, currentFolderId } from '$lib/stores/folders';
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPost } from '$lib/utils/api';
  import UseCaseScatterPlot from '$lib/components/UseCaseScatterPlot.svelte';
  import UseCaseDetail from '$lib/components/UseCaseDetail.svelte';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { refreshManager } from '$lib/stores/refresh';
  import References from '$lib/components/References.svelte';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { renderMarkdownWithRefs } from '$lib/utils/markdown';

  let isLoading = false;
  let summaryBox: HTMLElement | null = null;
  let summaryContent: HTMLElement | null = null;
  let matrix: MatrixConfig | null = null;
  let selectedFolderId: string | null = null;
  let currentFolder: any = null;
  let executiveSummary: any = null;
  let isGeneratingSummary = false;
  
  // Variables locales pour l'édition markdown (non persistantes)
  let editedIntroduction = '';
  let editedAnalyse = '';
  let editedRecommandation = '';
  let editedSyntheseExecutive = '';
  
  // Fonction pour initialiser les valeurs éditées depuis executiveSummary
  function initializeEditedValues() {
    if (!executiveSummary) {
      editedIntroduction = '';
      editedAnalyse = '';
      editedRecommandation = '';
      editedSyntheseExecutive = '';
      return;
    }
    
    // Parser executiveSummary si c'est une chaîne JSON
    let parsedSummary: any = executiveSummary;
    if (typeof executiveSummary === 'string') {
      try {
        parsedSummary = JSON.parse(executiveSummary);
      } catch (e) {
        console.error('Failed to parse executiveSummary:', e);
        parsedSummary = null;
      }
    }
    
    if (parsedSummary) {
      editedIntroduction = parsedSummary.introduction || '';
      editedAnalyse = parsedSummary.analyse || '';
      editedRecommandation = parsedSummary.recommandation || '';
      editedSyntheseExecutive = parsedSummary.synthese_executive || '';
    } else {
      editedIntroduction = '';
      editedAnalyse = '';
      editedRecommandation = '';
      editedSyntheseExecutive = '';
    }
  }
  
  // Initialiser les valeurs éditées quand executiveSummary change (réinitialisées à chaque reload)
  $: if (executiveSummary !== undefined) {
    initializeEditedValues();
  }
  
  // Numéros de page statiques pour le sommaire
  const basePageNumbers = {
    introduction: 2,
    sommaire: 3,
    analyse: 4,
    recommandations: 5,
    references: 6,
    annexes: 7
  };

  // Détecter si on a plus de 23 cas d'usage (nécessite un saut de page supplémentaire)
  $: hasMoreThan23UseCases = filteredUseCases.length > 23;
  $: pageOffset = hasMoreThan23UseCases ? 1 : 0;

  // Numéros de page ajustés (incrémentés de 1 si plus de 23 cas d'usage)
  $: pageNumbers = {
    introduction: basePageNumbers.introduction,
    sommaire: basePageNumbers.sommaire,
    analyse: basePageNumbers.analyse + pageOffset,
    recommandations: basePageNumbers.recommandations + pageOffset,
    references: basePageNumbers.references + pageOffset,
    annexes: basePageNumbers.annexes + pageOffset
  };

  // Calculer les numéros de page des cas d'usage (statique : page annexes + index + 1)
  // Si plus de 23 cas d'usage, le 24ème et suivants sont incrémentés de 1
  $: useCasePages = filteredUseCases.map((uc, index) => {
    const basePage = pageNumbers.annexes + index + 1;
    // Les cas d'usage après le 23ème ont déjà leur page incrémentée via pageOffset
    // Donc pas besoin d'ajustement supplémentaire ici
    return {
      name: uc.data?.name || uc.name || uc.titre || uc.nom || 'Cas d\'usage',
      page: basePage,
      id: uc.id,
      is24thOrLater: index >= 23
    };
  });

  onMount(async () => {
    loadConfig();
    await loadData();
    startAutoRefresh();
  });

  onDestroy(() => {
    refreshManager.stopAllRefreshes();
  });

  const loadData = async () => {
    isLoading = true;
    try {
      // Charger les dossiers
      const folders = await fetchFolders();
      foldersStore.set(folders);
      
      // Charger les cas d'usage
      const useCases = await fetchUseCases();
      useCasesStore.set(useCases);
      
      // Sélectionner le dossier actuel ou le premier disponible
      selectedFolderId = $currentFolderId || (folders.length > 0 ? folders[0].id : null);
      
      if (selectedFolderId) {
        await loadMatrix(selectedFolderId);
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement des données du dashboard'
      });
    } finally {
      isLoading = false;
    }
  };

  const loadMatrix = async (folderId: string) => {
    try {
      const folder = await apiGet(`/folders/${folderId}`);
      currentFolder = folder;
      matrix = folder.matrixConfig;
      executiveSummary = folder.executiveSummary || null;
      
      // Mettre à jour le folder dans le store pour refléter les changements de statut
      foldersStore.update(folders => 
        folders.map(f => f.id === folderId ? { ...f, status: folder.status, executiveSummary: folder.executiveSummary, name: folder.name } : f)
      );
      
      // Mettre à jour le titre édité si c'est le dossier actuel
      if (folderId === selectedFolderId) {
        editedFolderName = folder.name || '';
      }
    } catch (error) {
      console.error('Failed to load matrix:', error);
    }
  };

  const generateExecutiveSummary = async () => {
    if (!selectedFolderId) return;
    
    isGeneratingSummary = true;
    try {
      const result = await apiPost('/analytics/executive-summary', {
        folder_id: selectedFolderId,
        value_threshold: valueThreshold,
        complexity_threshold: complexityThreshold
      });
      
      addToast({
        type: 'success',
        message: result.message || 'Génération de la synthèse exécutive démarrée'
      });
      
      // Recharger le folder pour mettre à jour le statut
      await loadMatrix(selectedFolderId);
      
      // Mettre à jour le store des dossiers pour refléter le changement de statut
      const folders = await fetchFolders();
      foldersStore.set(folders);
    } catch (error: any) {
      console.error('Failed to generate executive summary:', error);
      addToast({
        type: 'error',
        message: error?.data?.message || 'Erreur lors de la génération de la synthèse exécutive'
      });
    } finally {
      isGeneratingSummary = false;
    }
  };

  // Fonctions helper pour construire fullData pour chaque section de executiveSummary
  const getExecutiveSummaryUpdateData = (field: string, newValue: string) => {
    if (!executiveSummary || !selectedFolderId) return undefined;
    
    // Construire l'objet executiveSummary complet avec le champ mis à jour
    return {
      executiveSummary: {
        introduction: field === 'introduction' ? newValue : (executiveSummary.introduction || ''),
        analyse: field === 'analyse' ? newValue : (executiveSummary.analyse || ''),
        recommandation: field === 'recommandation' ? newValue : (executiveSummary.recommandation || ''),
        synthese_executive: field === 'synthese_executive' ? newValue : (executiveSummary.synthese_executive || ''),
        references: executiveSummary.references || []
      }
    };
  };
  
  // Variables réactives pour fullData (pour éviter les problèmes de type dans le template)
  $: syntheseFullData = getExecutiveSummaryUpdateData('synthese_executive', editedSyntheseExecutive) || null;
  $: introductionFullData = getExecutiveSummaryUpdateData('introduction', editedIntroduction) || null;
  $: analyseFullData = getExecutiveSummaryUpdateData('analyse', editedAnalyse) || null;
  $: recommandationFullData = getExecutiveSummaryUpdateData('recommandation', editedRecommandation) || null;

  // Gérer la sauvegarde réussie - recharger le folder et mettre à jour
  const handleExecutiveSummarySaved = async (field: string) => {
    if (!selectedFolderId) return;
    
    try {
      // Recharger le folder pour avoir les données à jour
      await loadMatrix(selectedFolderId);
      
      // Mettre à jour le store des dossiers
      const folders = await fetchFolders();
      foldersStore.set(folders);
      
      // Mettre à jour originalValue pour refléter la nouvelle valeur sauvegardée
      if (executiveSummary) {
        const fieldMap: Record<string, keyof typeof executiveSummary> = {
          'introduction': 'introduction',
          'analyse': 'analyse',
          'recommandation': 'recommandation',
          'synthese_executive': 'synthese_executive'
        };
        
        if (fieldMap[field] && executiveSummary[fieldMap[field]]) {
          // Les variables edited* seront mises à jour via la réactivité de initializeEditedValues
        }
      }
    } catch (error) {
      console.error('Failed to reload folder after save:', error);
    }
  };

  // Variable pour le titre du dossier édité
  let editedFolderName = '';
  
  // Initialiser le titre édité quand le dossier change
  $: if (selectedFolderName !== undefined) {
    editedFolderName = selectedFolderName || '';
  }

  // Gérer la sauvegarde du titre du dossier
  const handleFolderNameSaved = async () => {
    if (!selectedFolderId) return;
    
    try {
      // Recharger le folder pour avoir les données à jour
      await loadMatrix(selectedFolderId);
      
      // Mettre à jour le store des dossiers
      const folders = await fetchFolders();
      foldersStore.set(folders);
    } catch (error) {
      console.error('Failed to reload folder after name save:', error);
    }
  };

  // Fonction pour rendre le markdown avec références et styles (utilise la fonction partagée)
  const renderMarkdown = (text: string | null | undefined, references: Array<{title: string; url: string}> = []): string => {
    return renderMarkdownWithRefs(text, references, {
      addListStyles: true,
      addHeadingStyles: true,
      listPadding: 1.5
    });
  };


  // Filtrer les cas d'usage par dossier sélectionné
  $: filteredUseCases = selectedFolderId 
    ? $useCasesStore.filter(uc => uc.folderId === selectedFolderId)
    : $useCasesStore;

  // Statistiques
  $: stats = {
    total: filteredUseCases.length,
    completed: filteredUseCases.filter(uc => uc.status === 'completed').length
  };

  // Bindings pour les stats ROI depuis le scatter plot
  let roiStats = { count: 0, avgValue: 0, avgComplexity: 0 };
  let showROIQuadrant = false;
  let medianValue = 0;
  let medianComplexity = 0;
  
  // Configuration du quadrant ROI
  const CONFIG_KEY = 'dashboard-roi-config';
  let configOpen = false;
  let valueThreshold: number | null = null;
  let complexityThreshold: number | null = null;
  
  // Charger la configuration depuis localStorage
  function loadConfig() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(CONFIG_KEY);
      if (saved) {
        try {
          const config = JSON.parse(saved);
          valueThreshold = config.valueThreshold ?? null;
          complexityThreshold = config.complexityThreshold ?? null;
        } catch (e) {
          console.error('Failed to load config:', e);
        }
      }
    }
  }
  
  // Sauvegarder la configuration dans localStorage
  function saveConfig() {
    if (typeof window !== 'undefined') {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({
        valueThreshold,
        complexityThreshold
      }));
    }
  }
  
  // Réinitialiser aux médianes
  function resetToMedians() {
    valueThreshold = null;
    complexityThreshold = null;
    saveConfig();
  }
  
  // Sauvegarder quand les seuils changent (mais pas au montage initial)
  let configInitialized = false;
  $: if (configInitialized && (valueThreshold !== null || complexityThreshold !== null)) {
    saveConfig();
  }
  $: configInitialized = true;
  
  // Nom du dossier sélectionné
  $: selectedFolderName = selectedFolderId ? ($foldersStore.find(f => f.id === selectedFolderId)?.name || '') : '';
  
  // Vérifier si la synthèse est en cours de génération
  $: isSummaryGenerating = currentFolder?.status === 'generating' && !executiveSummary;

  // Calculer les scores pour tous les usecases du dossier
  $: useCaseScoresMap = new Map(
    filteredUseCases
      .filter(uc => {
        const valueScores = uc.data?.valueScores || uc.valueScores;
        const complexityScores = uc.data?.complexityScores || uc.complexityScores;
        return valueScores && complexityScores && matrix;
      })
      .map(uc => {
        const valueScores = uc.data?.valueScores || uc.valueScores || [];
        const complexityScores = uc.data?.complexityScores || uc.complexityScores || [];
        return [
          uc.id,
          calculateUseCaseScores(matrix!, valueScores, complexityScores)
        ];
      })
  );

  // Rafraîchir automatiquement le folder si la synthèse est en cours de génération
  $: {
    const hasGeneratingFolder = currentFolder?.status === 'generating';
    
    if (hasGeneratingFolder && selectedFolderId) {
      if (!refreshManager.isRefreshActive('dashboard-folder')) {
        refreshManager.startRefresh('dashboard-folder', async () => {
          await loadMatrix(selectedFolderId!);
          // Mettre à jour aussi le store des dossiers
          const folders = await fetchFolders();
          foldersStore.set(folders);
        }, 2000);
      }
    } else {
      refreshManager.stopRefresh('dashboard-folder');
    }
  }

  const startAutoRefresh = () => {
    const hasGeneratingFolder = currentFolder?.status === 'generating';
    
    if (hasGeneratingFolder && selectedFolderId) {
      refreshManager.startRefresh('dashboard-folder', async () => {
        await loadMatrix(selectedFolderId!);
        // Mettre à jour aussi le store des dossiers
        const folders = await fetchFolders();
        foldersStore.set(folders);
      }, 2000);
    }
  };

  // Ajuster automatiquement la taille de police de la synthèse exécutive
  const adjustSummaryFontSize = () => {
    if (!summaryBox || !summaryContent) return;
    
    const box = summaryBox;
    const content = summaryContent;
    
    // Taille de police initiale
    let fontSize = 8; // pt
    const minFontSize = 5; // Réduit de 6 à 5 pour permettre un scaling plus agressif
    const baseLineHeight = 1.4;
    const baseParagraphMargin = 0.15; // cm
    const baseTitleMarginBottom = 0.15; // cm (marge sous le titre h3)
    const baseTitlePaddingBottom = 0.1; // cm (padding sous le titre h3)
    
    // Fonction pour vérifier si le contenu déborde
    const checkOverflow = () => {
      const scaleFactor = fontSize / 8; // Facteur de réduction par rapport à la taille initiale
      content.style.fontSize = `${fontSize}pt`;
      content.style.lineHeight = `${baseLineHeight * scaleFactor}`;
      // Réduire aussi les marges entre paragraphes
      const paragraphs = content.querySelectorAll('p');
      paragraphs.forEach((p, index) => {
        const pEl = p as HTMLElement;
        if (index === paragraphs.length - 1) {
          // Dernier paragraphe : pas de marge en bas
          pEl.style.setProperty('margin-bottom', '0', 'important');
        } else {
          pEl.style.setProperty('margin-bottom', `${baseParagraphMargin * scaleFactor}cm`, 'important');
        }
      });

    };
    
    // Réduire la taille jusqu'à ce que ça tienne (pas plus agressif : 0.2pt au lieu de 0.1pt)
    while (checkOverflow() && fontSize > minFontSize) {
      fontSize -= 0.2;
    }
    
    // Ajuster légèrement vers le bas pour être sûr que ça tienne (marge de sécurité plus grande)
    fontSize -= 0.3;
    
    // Appliquer la taille finale avec line-height et marges proportionnels
    const finalFontSize = Math.max(fontSize, minFontSize);
    const scaleFactor = finalFontSize / 8;
    content.style.fontSize = `${finalFontSize}pt`;
    content.style.lineHeight = `${baseLineHeight * scaleFactor}`;
    // Appliquer les marges réduites aux paragraphes
    const paragraphs = content.querySelectorAll('p');
    paragraphs.forEach((p, index) => {
      const pEl = p as HTMLElement;
      if (index === paragraphs.length - 1) {
        // Dernier paragraphe : pas de marge en bas
        pEl.style.setProperty('margin-bottom', '0', 'important');
      } else {
        pEl.style.setProperty('margin-bottom', `${baseParagraphMargin * scaleFactor}cm`, 'important');
      }
    });
    // Appliquer les marges réduites au titre h3
    const title = box.querySelector('h3');
    if (title) {
      const titleEl = title as HTMLElement;
      titleEl.style.setProperty('margin-bottom', `${baseTitleMarginBottom * scaleFactor}cm`, 'important');
      titleEl.style.setProperty('padding-bottom', `${baseTitlePaddingBottom * scaleFactor}cm`, 'important');
    }
    // Appliquer le padding réduit à la boîte
    // box.style.setProperty('padding', `${baseBoxPadding * scaleFactor}cm`, 'important');
  };

  // Ajuster quand la synthèse change ou au montage
  $: if (executiveSummary && summaryBox && summaryContent) {
    tick().then(() => {
      adjustSummaryFontSize();
    });
  }

  // Ajuster la taille de police lors de l'impression
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeprint', () => {
      setTimeout(() => {
        adjustSummaryFontSize();
      }, 100);
    });
  }
</script>

<!-- Page de garde (visible uniquement en impression) -->
{#if selectedFolderId && executiveSummary}
  <div class="report-cover-page">
    <div class="report-cover-header">
      <h1 class="report-cover-title">Rapport Top AI Ideas</h1>
      <h2 class="report-cover-subtitle">{selectedFolderName || 'Dashboard'}</h2>
    </div>
    
    {#if editedSyntheseExecutive}
      <div class="report-cover-summary" bind:this={summaryBox}>
        <h3>Synthèse exécutive</h3>
        <div class="prose prose-slate max-w-none" bind:this={summaryContent}>
          <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
            {@html renderMarkdown(editedSyntheseExecutive, executiveSummary?.references || [])}
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<section class="space-y-6 px-4 md:px-8 lg:px-16 xl:px-24 2xl:px-32 report-main-content">
  <div class="flex items-center">
    {#if selectedFolderId}
      <div class="text-3xl font-semibold print-hidden">
        <EditableInput
          label=""
          value={editedFolderName}
          markdown={false}
          apiEndpoint={`/folders/${selectedFolderId}`}
          fullData={{ name: editedFolderName }}
          changeId={`folder-name-${selectedFolderId}`}
          originalValue={selectedFolderName || ''}
          on:change={(e) => editedFolderName = e.detail.value}
          on:saved={handleFolderNameSaved}
        />
      </div>
    {:else}
      <h1 class="text-3xl font-semibold print-hidden">{selectedFolderName || 'Dashboard'}</h1>
    {/if}
  </div>

  <!-- Synthèse exécutive (FIRST) - Masquée en impression (déjà sur la page de garde) -->
  {#if selectedFolderId}
    {#if isSummaryGenerating || isGeneratingSummary}
      <div class="rounded-lg border border-blue-200 bg-blue-50 p-6">
        <div class="flex items-center gap-3">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <div>
            <p class="text-sm font-medium text-blue-700">Génération de la synthèse exécutive en cours...</p>
            <p class="text-xs text-blue-600 mt-1">Cela peut prendre quelques instants</p>
          </div>
        </div>
      </div>
    {:else if executiveSummary}
      <div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-6 print-hidden">
        <div class="border-b border-slate-200 pb-4 flex items-center justify-between">
          <h2 class="text-2xl font-semibold text-slate-900">Synthèse exécutive</h2>
          <div class="flex items-center gap-2">
            <button
              on:click={() => window.print()}
              class="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
              title="Imprimer ou exporter le rapport en PDF"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path>
              </svg>
            </button>
          <button
            on:click={generateExecutiveSummary}
            disabled={isGeneratingSummary}
              class="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              title="Régénérer la synthèse exécutive"
          >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" class:animate-spin={isGeneratingSummary}>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
          </button>
        </div>
            </div>
        
        {#if editedSyntheseExecutive}
          <EditableInput
            label=""
            value={editedSyntheseExecutive}
            markdown={true}
            apiEndpoint={selectedFolderId ? `/folders/${selectedFolderId}` : ''}
            fullData={syntheseFullData}
            changeId={selectedFolderId ? `exec-synthese-${selectedFolderId}` : ''}
            originalValue={executiveSummary?.synthese_executive || ''}
            references={executiveSummary?.references || []}
            on:change={(e) => editedSyntheseExecutive = e.detail.value}
            on:saved={() => handleExecutiveSummarySaved('synthese_executive')}
          />
        {/if}
      </div>
    {:else if currentFolder}
      <div class="rounded-lg border border-slate-200 bg-slate-50 p-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold text-slate-900 mb-1">Synthèse exécutive</h2>
            <p class="text-sm text-slate-600">Aucune synthèse exécutive disponible pour ce dossier</p>
          </div>
          <button
            on:click={generateExecutiveSummary}
            disabled={isGeneratingSummary}
            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGeneratingSummary ? 'Génération...' : 'Générer la synthèse'}
          </button>
        </div>
      </div>
    {/if}
  {/if}

  {#if isLoading}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <div class="flex items-center gap-3">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
        <p class="text-sm text-blue-700 font-medium">Chargement des données...</p>
      </div>
    </div>
  {:else}
    <!-- Contenu fusionné : statistiques, graphique, introduction -->
    {#if executiveSummary && selectedFolderId && !isSummaryGenerating}
      <div class="report-introduction">
        <!-- Statistiques -->
        <div class="grid gap-4 md:grid-cols-2">
          <div class="rounded-lg bg-white p-4 shadow-sm border border-slate-200">
            <div class="flex items-center">
              <div class="flex-shrink-0">
                <svg class="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
              </div>
              <div class="ml-4">
                <p class="text-sm font-medium text-slate-500">Nombre de cas d'usage</p>
                <p class="text-2xl font-semibold text-slate-900">{stats.total}</p>
                {#if roiStats.count > 0}
                  <p class="text-xs text-green-600 mt-1">
                    Valeur médiane: {roiStats.avgValue.toFixed(1)} pts | Complexité médiane: {roiStats.avgComplexity.toFixed(1)} pts
                  </p>
                {/if}
              </div>
            </div>
          </div>

          {#if showROIQuadrant}
            <div class="rounded-lg bg-white p-4 shadow-sm border border-slate-200 border-green-300 bg-green-50">
              <div class="flex items-center">
                <div class="flex-shrink-0">
                  <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
                  </svg>
                </div>
                <div class="ml-4 flex-1">
                  <p class="text-sm font-medium text-green-700">Gains rapides</p>
                  <p class="text-2xl font-semibold text-green-600">{roiStats.count} cas</p>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <!-- Graphique scatter plot -->
        <div class="rounded-lg bg-white p-6 shadow-sm border border-slate-200 relative report-scatter-plot-container my-6">
          <!-- Accordéon de configuration en haut à droite -->
          <div class="absolute top-4 right-4 z-10">
            <div class="rounded-lg bg-white border border-slate-200 shadow-sm">
              <button
                on:click={() => configOpen = !configOpen}
                class="flex items-center justify-center p-2 hover:bg-slate-50 transition-colors rounded"
                title="Configuration du quadrant ROI"
              >
                <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
                {#if valueThreshold !== null || complexityThreshold !== null}
                  <span class="ml-1 w-2 h-2 bg-blue-600 rounded-full"></span>
                {/if}
              </button>
              
              {#if configOpen}
                <div class="absolute z-50 mt-2 right-0 w-96 rounded-lg bg-white border border-slate-200 shadow-lg p-4 space-y-4">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-sm font-medium text-slate-700">Configuration du quadrant ROI</span>
                    <button
                      on:click={() => configOpen = false}
                      class="text-slate-400 hover:text-slate-600"
                      aria-label="Fermer la configuration"
                    >
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                      </svg>
                    </button>
                  </div>
                  <div class="grid gap-4 md:grid-cols-2">
                    <div>
                      <label for="value-threshold" class="block text-sm font-medium text-slate-700 mb-2">
                        Seuil de valeur (pts)
                      </label>
                      <div class="flex items-center gap-2">
                        <input
                          id="value-threshold"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={valueThreshold ?? ''}
                          on:input={(e) => {
                            const val = e.target?.value || '';
                            valueThreshold = val === '' ? null : parseFloat(val);
                          }}
                          placeholder={medianValue.toFixed(1)}
                          class="flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          on:click={() => valueThreshold = null}
                          class="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                          title="Utiliser la médiane"
                        >
                          Médiane ({medianValue.toFixed(1)})
                        </button>
                      </div>
                      <p class="text-xs text-slate-500 mt-1">
                        {valueThreshold !== null ? `Seuil personnalisé: ${valueThreshold.toFixed(1)}` : `Médiane actuelle: ${medianValue.toFixed(1)}`}
                      </p>
                    </div>
                    
                    <div>
                      <label for="complexity-threshold" class="block text-sm font-medium text-slate-700 mb-2">
                        Seuil de complexité (pts)
                      </label>
                      <div class="flex items-center gap-2">
                        <input
                          id="complexity-threshold"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={complexityThreshold ?? ''}
                          on:input={(e) => {
                            const val = e.target?.value || '';
                            complexityThreshold = val === '' ? null : parseFloat(val);
                          }}
                          placeholder={medianComplexity.toFixed(1)}
                          class="flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          on:click={() => complexityThreshold = null}
                          class="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                          title="Utiliser la médiane"
                        >
                          Médiane ({medianComplexity.toFixed(1)})
                        </button>
                      </div>
                      <p class="text-xs text-slate-500 mt-1">
                        {complexityThreshold !== null ? `Seuil personnalisé: ${complexityThreshold.toFixed(1)}` : `Médiane actuelle: ${medianComplexity.toFixed(1)}`}
                      </p>
                    </div>
                  </div>
                  
                  <div class="flex justify-end">
                    <button
                      on:click={resetToMedians}
                      class="text-sm text-slate-600 hover:text-slate-800 px-3 py-1 rounded hover:bg-slate-100 transition-colors"
                    >
                      Réinitialiser aux médianes
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
          
          <div class="flex justify-center">
            <UseCaseScatterPlot 
              useCases={filteredUseCases} 
              {matrix} 
              bind:roiStats 
              bind:showROIQuadrant
              bind:medianValue
              bind:medianComplexity
              {valueThreshold}
              {complexityThreshold}
            />
          </div>
        </div>

        <!-- Introduction -->
        {#if editedIntroduction}
          <div id="section-introduction" class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm report-analyse report-analyse-with-break">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900">Introduction</h2>
            </div>
            <div class="prose prose-slate max-w-none">
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                <EditableInput
                  label=""
                  value={editedIntroduction}
                  markdown={true}
                  apiEndpoint={selectedFolderId ? `/folders/${selectedFolderId}` : ''}
                  fullData={introductionFullData}
                  changeId={selectedFolderId ? `exec-intro-${selectedFolderId}` : ''}
                  originalValue={executiveSummary?.introduction || ''}
                  references={executiveSummary?.references || []}
                  on:change={(e) => editedIntroduction = e.detail.value}
                  on:saved={() => handleExecutiveSummarySaved('introduction')}
                />
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Sommaire (page 3) -->
    {#if executiveSummary && selectedFolderId && !isSummaryGenerating}
      <div class="report-table-of-contents">
        <h2 class="text-2xl font-semibold text-slate-900 mb-6">Sommaire</h2>
        <ul class="space-y-2 text-slate-700">
          <li class="toc-item">
            <a href="#section-introduction" class="toc-title toc-link">Introduction</a>
            <span class="toc-dots"></span>
            <span class="toc-page">{pageNumbers.introduction || '-'}</span>
          </li>
          <li class="toc-item">
            <a href="#section-analyse" class="toc-title toc-link">Analyse</a>
            <span class="toc-dots"></span>
            <span class="toc-page">{pageNumbers.analyse || '-'}</span>
          </li>
          {#if executiveSummary.recommandation}
            <li class="toc-item">
              <a href="#section-recommandations" class="toc-title toc-link">Recommandations</a>
              <span class="toc-dots"></span>
              <span class="toc-page">{pageNumbers.recommandations || '-'}</span>
            </li>
          {/if}
          {#if executiveSummary.references && executiveSummary.references.length > 0}
            <li class="toc-item">
              <a href="#section-references" class="toc-title toc-link">Références</a>
              <span class="toc-dots"></span>
              <span class="toc-page">{pageNumbers.references || '-'}</span>
            </li>
          {/if}
          {#if filteredUseCases.length > 0}
            <li class="toc-item">
              <span class="toc-title">Annexes</span>
              <span class="toc-dots"></span>
              <span class="toc-page">{pageNumbers.annexes || '-'}</span>
            </li>
            {#each useCasePages as useCasePage}
              <li class="toc-item toc-item-nested">
                <a href="#usecase-{useCasePage.id || ''}" class="toc-title toc-link">{useCasePage.name}</a>
                <span class="toc-dots"></span>
                <span class="toc-page">{useCasePage.page}</span>
              </li>
            {/each}
          {/if}
        </ul>
      </div>
    {/if}

    <!-- Analyse, Recommandations, Références (après l'introduction) -->
    {#if executiveSummary && selectedFolderId && !isSummaryGenerating}
      <div class="space-y-6">

        {#if editedAnalyse}
          <div id="section-analyse" class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm report-analyse report-analyse-with-break">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900">Analyse</h2>
            </div>
            <div class="prose prose-slate max-w-none">
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                <EditableInput
                  label=""
                  value={editedAnalyse}
                  markdown={true}
                  apiEndpoint={selectedFolderId ? `/folders/${selectedFolderId}` : ''}
                  fullData={analyseFullData}
                  changeId={selectedFolderId ? `exec-analyse-${selectedFolderId}` : ''}
                  originalValue={executiveSummary?.analyse || ''}
                  references={executiveSummary?.references || []}
                  on:change={(e) => editedAnalyse = e.detail.value}
                  on:saved={() => handleExecutiveSummarySaved('analyse')}
                />
              </div>
            </div>
          </div>
        {/if}

        {#if editedRecommandation}
          <div id="section-recommandations" class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm report-analyse report-analyse-with-break">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900">Recommandations</h2>
            </div>
            <div class="prose prose-slate max-w-none">
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                <EditableInput
                  label=""
                  value={editedRecommandation}
                  markdown={true}
                  apiEndpoint={selectedFolderId ? `/folders/${selectedFolderId}` : ''}
                  fullData={recommandationFullData}
                  changeId={selectedFolderId ? `exec-recommandation-${selectedFolderId}` : ''}
                  originalValue={executiveSummary?.recommandation || ''}
                  references={executiveSummary?.references || []}
                  on:change={(e) => editedRecommandation = e.detail.value}
                  on:saved={() => handleExecutiveSummarySaved('recommandation')}
                />
              </div>
            </div>
          </div>
        {/if}

        {#if executiveSummary.references && executiveSummary.references.length > 0}
          <div id="section-references" class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm report-analyse">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900">Références</h2>
            </div>
            <References references={executiveSummary.references} />
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<!-- Page de séparation pour les annexes (visible uniquement en impression) -->
{#if selectedFolderId && filteredUseCases.length > 0}
  <div class="report-cover-page">
    <div class="report-cover-header">
      <h1 class="report-cover-title">Annexe</h1>
      <h2 class="report-cover-subtitle">Fiches des cas d'usage</h2>
    </div>
  </div>
{/if}

<!-- Section Annexes (tous les usecases du dossier) -->
<section class="hidden print:block">
  {#if selectedFolderId && filteredUseCases.length > 0}
        {#each filteredUseCases as useCase, index (useCase.id)}
        <section 
          id="usecase-{useCase.id}" 
          class="space-y-6 usecase-annex-section {index === 23 ? 'force-page-break-before' : ''}" 
          data-usecase-id={useCase.id} 
          data-usecase-title={useCase?.data?.name || useCase?.name || (useCase as any)?.titre || (useCase as any)?.nom || 'Cas d\'usage'}>
            <UseCaseDetail
              useCase={useCase}
              matrix={matrix}
              calculatedScores={useCaseScoresMap.get(useCase.id) || null}
              isEditing={false}
            />
        </section>
        {/each}
    {/if}
</section>


<!-- Back cover -->
<div class="report-cover-page">
  <div class="report-cover-header">
    <h1 class="report-cover-title">Top AI Ideas</h1>
    <h2 class="report-cover-subtitle">Priorisez vos innovations par l'apport de valeur</h2>
  </div>
  <div class="report-cover-summary">
    <h3>À Propos</h3>
    <div class="prose prose-slate max-w-none">
      <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
        <p>
          Top AI Ideas s’inscrit dans la vision de SENT-tech : plus de vingt ans d’expertise en innovation, données, digital et intelligence artificielle. Ici, l’IA n’est jamais une finalité, mais un levier devenu indispensable à la compétitivité.
        </p>
        <p>
          La valeur naît d’une approche holistique, où les opportunités d’affaires rencontrent les capacités technologiques. Conçu pour guider les organisations dans leurs choix, Top AI Ideas aide à identifier les initiatives les plus prometteuses, dans une démarche collaborative, rigoureuse et orientée impact.
        </p>
        <p>
          Le présent échantillon est entièrement généré, à des fins de démonstration. Top AI Ideas permet une édition collaborative pour la validation de son contenu tout en permettant un rendu final dans un format professionnel.
        </p>
      </div>
    </div>
  </div>
</div>
