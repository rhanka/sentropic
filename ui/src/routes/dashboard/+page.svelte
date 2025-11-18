<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { useCasesStore, fetchUseCases } from '$lib/stores/useCases';
  import { foldersStore, fetchFolders, currentFolderId } from '$lib/stores/folders';
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPost } from '$lib/utils/api';
  import UseCaseScatterPlot from '$lib/components/UseCaseScatterPlot.svelte';
  import UseCaseDetail from '$lib/components/UseCaseDetail.svelte';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { marked } from 'marked';
  import { refreshManager } from '$lib/stores/refresh';
  import References from '$lib/components/References.svelte';
  import { calculateUseCaseScores } from '$lib/utils/scoring';

  let isLoading = false;
  let summaryBox: HTMLElement | null = null;
  let summaryContent: HTMLElement | null = null;
  let matrix: MatrixConfig | null = null;
  let selectedFolderId: string | null = null;
  let currentFolder: any = null;
  let executiveSummary: any = null;
  let isGeneratingSummary = false;

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
        folders.map(f => f.id === folderId ? { ...f, status: folder.status, executiveSummary: folder.executiveSummary } : f)
      );
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

  // Fonction pour créer un lien de référence
  const createReferenceLink = (num: string, ref: {title: string; url: string}): string => {
    const refId = `ref-${num}`;
    return `<a href="#${refId}" 
                class="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer" 
                title="${ref.title.replace(/"/g, '&quot;')}"
                onclick="event.preventDefault(); document.getElementById('${refId}')?.scrollIntoView({behavior: 'smooth', block: 'center'}); return false;">
                [${num}]
              </a>`;
  };

  // Fonction pour parser les références [1], [2] dans le markdown HTML
  const parseReferencesInMarkdown = (html: string, references: Array<{title: string; url: string}> = []): string => {
    if (!html || !references || references.length === 0) return html;
    
    // Remplacer les patterns [1], [2], etc par des liens cliquables
    return html.replace(/\[(\d+)\]/g, (match, num) => {
      const index = parseInt(num) - 1;
      if (index >= 0 && index < references.length) {
        return createReferenceLink(num, references[index]);
      }
      return match; // Si la référence n'existe pas, garder le texte original
    });
  };

  // Fonction pour rendre le markdown en HTML avec parsing des références
  const renderMarkdown = (text: string | null | undefined, references: Array<{title: string; url: string}> = []): string => {
    if (!text) return '';
    let html = marked(text);
    
    // Post-traitement pour améliorer le rendu des listes
    html = html.replace(/<ul>/g, '<ul class="list-disc space-y-2 mb-4" style="padding-left:1.5rem;">');
    html = html.replace(/<ol>/g, '<ol class="list-decimal space-y-2 mb-4" style="padding-left:1.5rem;">');
    html = html.replace(/<li>/g, '<li class="mb-1">');
    
    // Post-traitement pour améliorer le rendu des titres
    html = html.replace(/<h2>/g, '<h2 class="text-xl font-semibold text-slate-900 mt-6 mb-4">');
    html = html.replace(/<h3>/g, '<h3 class="text-lg font-semibold text-slate-800 mt-4 mb-3">');
    
    return parseReferencesInMarkdown(html, references);
  };

  const handleFolderChange = async (event: Event) => {
    const target = event.target as HTMLSelectElement;
    selectedFolderId = target.value;
    if (selectedFolderId) {
      await loadMatrix(selectedFolderId);
    }
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
      .filter(uc => uc.valueScores && uc.complexityScores && matrix)
      .map(uc => [
        uc.id,
        calculateUseCaseScores(matrix!, uc.valueScores!, uc.complexityScores!)
      ])
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
    const minFontSize = 6;
    const maxFontSize = 12;
    
    // Fonction pour vérifier si le contenu déborde
    const checkOverflow = () => {
      content.style.fontSize = `${fontSize}pt`;
      return content.scrollHeight > content.clientHeight;
    };
    
    // Réduire la taille jusqu'à ce que ça tienne
    while (checkOverflow() && fontSize > minFontSize) {
      fontSize -= 0.1;
    }
    
    // Augmenter la taille si on a de la place
    while (!checkOverflow() && fontSize < maxFontSize) {
      fontSize += 0.1;
    }
    
    // Ajuster légèrement vers le bas pour être sûr que ça tienne
    fontSize -= 0.2;
    
    // Appliquer la taille finale
    content.style.fontSize = `${Math.max(fontSize, minFontSize)}pt`;
  };

  // Ajuster quand la synthèse change ou au montage
  $: if (executiveSummary && summaryBox && summaryContent) {
    tick().then(() => {
      adjustSummaryFontSize();
    });
  }

  // Ajuster aussi lors de l'impression
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeprint', () => {
      setTimeout(adjustSummaryFontSize, 100);
    });
  }
</script>

<!-- Page de garde (visible uniquement en impression) -->
{#if selectedFolderId && executiveSummary}
  <div class="report-cover-page" style="background-image: url('/hero-tech-cover.jpg');">
    <div class="report-cover-header">
      <h1 class="report-cover-title">Rapport Top AI Ideas</h1>
      <h2 class="report-cover-subtitle">{selectedFolderName || 'Dashboard'}</h2>
    </div>
    
    {#if executiveSummary.synthese_executive}
      <div class="report-cover-summary" bind:this={summaryBox}>
        <h3>Synthèse exécutive</h3>
        <div class="prose prose-slate max-w-none" bind:this={summaryContent}>
          <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
            {@html renderMarkdown(executiveSummary.synthese_executive, executiveSummary.references || [])}
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<section class="space-y-6 px-4 md:px-8 lg:px-16 xl:px-24 2xl:px-32 report-main-content">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">{selectedFolderName || 'Dashboard'}</h1>
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
          <button
            on:click={generateExecutiveSummary}
            disabled={isGeneratingSummary}
            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            {isGeneratingSummary ? 'Régénération...' : 'Régénérer'}
          </button>
        </div>
        
        {#if executiveSummary.synthese_executive}
          <div class="prose prose-slate max-w-none">
            <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
              {@html renderMarkdown(executiveSummary.synthese_executive, executiveSummary.references || [])}
            </div>
          </div>
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
    <div class="rounded-lg bg-white p-6 shadow-sm border border-slate-200 relative">
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
                        const val = (e.target as HTMLInputElement).value;
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
                        const val = (e.target as HTMLInputElement).value;
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

    <!-- Introduction, Analyse, Recommandations (après le Dashboard) -->
    {#if executiveSummary && selectedFolderId && !isSummaryGenerating}
      <div class="space-y-6">
        {#if executiveSummary.introduction}
          <div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900">Introduction</h2>
            </div>
            <div class="prose prose-slate max-w-none">
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                {@html renderMarkdown(executiveSummary.introduction, executiveSummary.references || [])}
              </div>
            </div>
          </div>
        {/if}

        {#if executiveSummary.analyse}
          <div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900">Analyse</h2>
            </div>
            <div class="prose prose-slate max-w-none">
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                {@html renderMarkdown(executiveSummary.analyse, executiveSummary.references || [])}
              </div>
            </div>
          </div>
        {/if}

        {#if executiveSummary.recommandation}
          <div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900">Recommandations</h2>
            </div>
            <div class="prose prose-slate max-w-none">
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                {@html renderMarkdown(executiveSummary.recommandation, executiveSummary.references || [])}
              </div>
            </div>
          </div>
        {/if}

        {#if executiveSummary.references && executiveSummary.references.length > 0}
          <div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900">Références</h2>
            </div>
            <References references={executiveSummary.references} />
          </div>
        {/if}
      </div>
    {/if}

    <!-- Section Annexes (tous les usecases du dossier) -->
    {#if selectedFolderId && filteredUseCases.length > 0}
      <div class="space-y-0">
        {#each filteredUseCases as useCase (useCase.id)}
          <div class="usecase-annex">
            <UseCaseDetail
              useCase={useCase}
              matrix={matrix}
              calculatedScores={useCaseScoresMap.get(useCase.id) || null}
              mode="print-only"
              isEditing={false}
              draft={{}}
            />
          </div>
        {/each}
      </div>
    {/if}

  {/if}
</section>