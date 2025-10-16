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
    completed: filteredUseCases.filter(uc => uc.status === 'completed').length,
    generating: filteredUseCases.filter(uc => uc.status === 'generating').length,
    detailing: filteredUseCases.filter(uc => uc.status === 'detailing').length
  };
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">Dashboard</h1>
    
    <!-- Sélecteur de dossier -->
    <div class="flex items-center gap-3">
      <label for="folder-select" class="text-sm font-medium text-slate-700">Dossier:</label>
      <select 
        id="folder-select"
        bind:value={selectedFolderId}
        on:change={handleFolderChange}
        class="rounded border border-slate-300 px-3 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {#each $foldersStore as folder}
          <option value={folder.id}>{folder.name}</option>
        {/each}
      </select>
    </div>
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
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div class="rounded-lg bg-white p-4 shadow-sm border border-slate-200">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <svg class="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-slate-500">Total</p>
            <p class="text-2xl font-semibold text-slate-900">{stats.total}</p>
          </div>
        </div>
      </div>

      <div class="rounded-lg bg-white p-4 shadow-sm border border-slate-200">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-slate-500">Terminés</p>
            <p class="text-2xl font-semibold text-green-600">{stats.completed}</p>
          </div>
        </div>
      </div>

      <div class="rounded-lg bg-white p-4 shadow-sm border border-slate-200">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <svg class="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-slate-500">En cours</p>
            <p class="text-2xl font-semibold text-yellow-600">{stats.generating + stats.detailing}</p>
          </div>
        </div>
      </div>

    </div>

    <!-- Graphique scatter plot -->
    <div class="rounded-lg bg-white p-6 shadow-sm border border-slate-200">
      <h2 class="text-xl font-semibold text-slate-900 mb-4">Matrice Valeur vs Complexité</h2>
        <UseCaseScatterPlot useCases={filteredUseCases} {matrix} />
    </div>

  {/if}
</section>