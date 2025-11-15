<script lang="ts">
  import { onMount } from 'svelte';
  import { useCasesStore, fetchUseCases } from '$lib/stores/useCases';
  import { foldersStore, fetchFolders, currentFolderId } from '$lib/stores/folders';
  import { addToast } from '$lib/stores/toast';
  import { apiGet } from '$lib/utils/api';
  import UseCaseScatterPlot from '$lib/components/UseCaseScatterPlot.svelte';
  import type { MatrixConfig } from '$lib/types/matrix';

  let isLoading = false;
  let matrix: MatrixConfig | null = null;
  let selectedFolderId: string | null = null;

  onMount(async () => {
    loadConfig();
    await loadData();
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
      matrix = folder.matrixConfig;
    } catch (error) {
      console.error('Failed to load matrix:', error);
    }
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
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">{selectedFolderName || 'Dashboard'}</h1>
  </div>

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
              {#if roiStats.count > 0}
                <p class="text-xs text-green-600 mt-1">
                  Valeur médiane: {roiStats.avgValue.toFixed(1)} pts | Complexité médiane: {roiStats.avgComplexity.toFixed(1)} pts
                </p>
              {/if}
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

  {/if}
</section>