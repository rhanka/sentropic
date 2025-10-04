<script lang="ts">
  import { matrixStore } from '$lib/stores/matrix';
  import { currentFolderId } from '$lib/stores/folders';
  import { addToast } from '$lib/stores/toast';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { onMount } from 'svelte';

  let isLoading = false;
  let editedConfig = { ...$matrixStore };
  let originalConfig = { ...$matrixStore };
  let selectedAxis: any = null;
  let isValueAxis = false;
  let showDescriptionsDialog = false;
  let showCreateMatrixDialog = false;
  let showCloseWarning = false;
  let createMatrixType = 'default'; // 'default', 'copy', 'blank'
  let availableFolders = [];
  let selectedFolderToCopy = '';

  onMount(async () => {
    await loadMatrix();
  });

  const loadMatrix = async () => {
    if (!$currentFolderId) {
      addToast({
        type: 'info',
        message: 'Veuillez sélectionner un dossier pour voir sa matrice'
      });
      return;
    }

    isLoading = true;
    try {
      const response = await fetch(`http://localhost:8787/api/v1/folders/${$currentFolderId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch folder');
      }
      const folder = await response.json();
      
      if (folder.matrixConfig) {
        const matrix = typeof folder.matrixConfig === 'string' 
          ? JSON.parse(folder.matrixConfig) 
          : folder.matrixConfig;
        matrixStore.set(matrix);
        editedConfig = { ...matrix };
        originalConfig = { ...matrix };
        addToast({
          type: 'success',
          message: `Matrice du dossier "${folder.name}" chargée`
        });
      } else {
        addToast({
          type: 'warning',
          message: `Le dossier "${folder.name}" n'a pas de matrice configurée`
        });
      }
    } catch (error) {
      console.error('Failed to load matrix:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement de la matrice'
      });
    } finally {
      isLoading = false;
    }
  };

  const handleValueWeightChange = (index: number, weight: string) => {
    const newWeight = parseFloat(weight);
    if (isNaN(newWeight)) return;
    
    const newValueAxes = [...editedConfig.valueAxes];
    newValueAxes[index] = { ...newValueAxes[index], weight: newWeight };
    editedConfig = { ...editedConfig, valueAxes: newValueAxes };
  };
  
  const handleComplexityWeightChange = (index: number, weight: string) => {
    const newWeight = parseFloat(weight);
    if (isNaN(newWeight)) return;
    
    const newComplexityAxes = [...editedConfig.complexityAxes];
    newComplexityAxes[index] = { ...newComplexityAxes[index], weight: newWeight };
    editedConfig = { ...editedConfig, complexityAxes: newComplexityAxes };
  };

  const handlePointsChange = (isValue: boolean, level: number, points: string | number) => {
    if (isValue && editedConfig.valueThresholds) {
      const newThresholds = [...editedConfig.valueThresholds];
      const index = newThresholds.findIndex(t => t.level === level);
      if (index !== -1) {
        newThresholds[index] = { ...newThresholds[index], points: points };
        editedConfig = { ...editedConfig, valueThresholds: newThresholds };
      }
    } else if (!isValue && editedConfig.complexityThresholds) {
      const newThresholds = [...editedConfig.complexityThresholds];
      const index = newThresholds.findIndex(t => t.level === level);
      if (index !== -1) {
        newThresholds[index] = { ...newThresholds[index], points: points };
        editedConfig = { ...editedConfig, complexityThresholds: newThresholds };
      }
    }
  };

  const saveChanges = async () => {
    if (!$currentFolderId) return;
    
    try {
      const response = await fetch(`http://localhost:8787/api/v1/folders/${$currentFolderId}/matrix`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editedConfig)
      });

      if (!response.ok) {
        throw new Error('Failed to save matrix');
      }

      matrixStore.set(editedConfig);
      addToast({
        type: 'success',
        message: 'Configuration de la matrice mise à jour'
      });
    } catch (error) {
      console.error('Failed to save matrix:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la sauvegarde de la matrice'
      });
    }
  };

  const updateAxisName = (isValue: boolean, index: number, newName: string) => {
    if (isValue) {
      const newAxes = [...editedConfig.valueAxes];
      newAxes[index] = { ...newAxes[index], name: newName };
      editedConfig = { ...editedConfig, valueAxes: newAxes };
    } else {
      const newAxes = [...editedConfig.complexityAxes];
      newAxes[index] = { ...newAxes[index], name: newName };
      editedConfig = { ...editedConfig, complexityAxes: newAxes };
    }
    
    // Les modifications sont maintenant gérées par le store unsavedChanges
  };

  const openAxisDescriptions = (axis: any, isValue: boolean) => {
    selectedAxis = axis;
    isValueAxis = isValue;
    showDescriptionsDialog = true;
  };

  const handleCloseDescriptionsDialog = () => {
    // Vérifier s'il y a des modifications non sauvegardées via le store
    if ($unsavedChangesStore.changes.length > 0) {
      showCloseWarning = true;
    } else {
      showDescriptionsDialog = false;
    }
  };

  const handleCloseWarningCancel = () => {
    showCloseWarning = false;
  };

  const handleCloseWarningDiscard = () => {
    unsavedChangesStore.reset();
    showCloseWarning = false;
    showDescriptionsDialog = false;
  };

  const handleCloseWarningSave = async () => {
    try {
      await unsavedChangesStore.saveAll();
      showCloseWarning = false;
      showDescriptionsDialog = false;
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la sauvegarde'
      });
    }
  };

  // Ces fonctions ne sont plus nécessaires car on utilise directement le template Svelte

  const getLevelDescription = (axis: any, level: number): string => {
    if (!axis.levelDescriptions) return `Niveau ${level}`;
    
    const levelDesc = axis.levelDescriptions.find((ld: any) => ld.level === level);
    return levelDesc?.description || `Niveau ${level}`;
  };

  const updateLevelDescription = (levelNum: number, description: string) => {
    if (!selectedAxis) return;
    
    if (isValueAxis) {
      const axisIndex = editedConfig.valueAxes.findIndex((a: any) => a.name === selectedAxis.name);
      if (axisIndex === -1) return;
      
      const newValueAxes = [...editedConfig.valueAxes];
      const currentLevelDescs = [...(newValueAxes[axisIndex].levelDescriptions || [])];
      
      const levelIndex = currentLevelDescs.findIndex((ld: any) => ld.level === levelNum);
      if (levelIndex >= 0) {
        currentLevelDescs[levelIndex] = { ...currentLevelDescs[levelIndex], description };
      } else {
        currentLevelDescs.push({ level: levelNum, description });
      }
      
      newValueAxes[axisIndex] = { 
        ...newValueAxes[axisIndex], 
        levelDescriptions: currentLevelDescs 
      };
      
      editedConfig = { ...editedConfig, valueAxes: newValueAxes };
    } else {
      const axisIndex = editedConfig.complexityAxes.findIndex((a: any) => a.name === selectedAxis.name);
      if (axisIndex === -1) return;
      
      const newComplexityAxes = [...editedConfig.complexityAxes];
      const currentLevelDescs = [...(newComplexityAxes[axisIndex].levelDescriptions || [])];
      
      const levelIndex = currentLevelDescs.findIndex((ld: any) => ld.level === levelNum);
      if (levelIndex >= 0) {
        currentLevelDescs[levelIndex] = { ...currentLevelDescs[levelIndex], description };
      } else {
        currentLevelDescs.push({ level: levelNum, description });
      }
      
      newComplexityAxes[axisIndex] = { 
        ...newComplexityAxes[axisIndex], 
        levelDescriptions: currentLevelDescs 
      };
      
      editedConfig = { ...editedConfig, complexityAxes: newComplexityAxes };
    }
    
    // Les modifications sont maintenant gérées par le store unsavedChanges
  };

  const loadAvailableFolders = async () => {
    try {
      const response = await fetch('http://localhost:8787/api/v1/folders/list/with-matrices');
      if (response.ok) {
        const data = await response.json();
        availableFolders = data.items.filter((folder: any) => folder.hasMatrix && folder.id !== $currentFolderId);
      }
    } catch (error) {
      console.error('Failed to load folders:', error);
    }
  };

  const createNewMatrix = async () => {
    console.log('createNewMatrix called, currentFolderId:', $currentFolderId);
    if (!$currentFolderId) {
      console.log('No currentFolderId, returning');
      return;
    }
    
    try {
      let matrixToUse;
      
      if (createMatrixType === 'default') {
        // Utiliser la matrice de base par défaut
        console.log('Fetching default matrix...');
        const response = await fetch('http://localhost:8787/api/v1/folders/matrix/default');
        matrixToUse = await response.json();
        console.log('Default matrix fetched:', matrixToUse);
      } else if (createMatrixType === 'copy' && selectedFolderToCopy) {
        // Copier une matrice existante
        const response = await fetch(`http://localhost:8787/api/v1/folders/${selectedFolderToCopy}/matrix`);
        matrixToUse = await response.json();
      } else if (createMatrixType === 'blank') {
        // Matrice vierge
        matrixToUse = {
          valueAxes: [],
          complexityAxes: [],
          valueThresholds: [],
          complexityThresholds: []
        };
      }
      
      if (matrixToUse) {
        console.log('Saving matrix to folder:', $currentFolderId);
        const response = await fetch(`http://localhost:8787/api/v1/folders/${$currentFolderId}/matrix`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(matrixToUse)
        });
        
        console.log('Response status:', response.status);
        if (response.ok) {
          matrixStore.set(matrixToUse);
          editedConfig = { ...matrixToUse };
          showCreateMatrixDialog = false;
          addToast({
            type: 'success',
            message: 'Nouvelle matrice créée avec succès'
          });
        }
      }
    } catch (error) {
      console.error('Failed to create matrix:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la création de la matrice'
      });
    }
  };

  const openCreateMatrixDialog = async () => {
    await loadAvailableFolders();
    showCreateMatrixDialog = true;
  };
</script>

<div class="container mx-auto px-4 py-8">
  <h1 class="text-3xl font-bold mb-6 text-navy">Configuration de la Matrice Valeur/Complexité</h1>
  
  {#if $currentFolderId}
    <p class="text-gray-600 -mt-4 mb-6">
      Dossier sélectionné
    </p>
  {/if}
  
  <div class="bg-blue-50 border-l-4 border-blue-500 p-4 mb-8">
    <div class="flex">
      <svg class="h-6 w-6 text-blue-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>
      <div>
        <p class="mb-2">
          Ajustez les poids des axes de valeur et de complexité pour personnaliser l'évaluation des cas d'usage.
        </p>
        <p class="text-sm">
          La matrice utilise 5 niveaux pour chaque critère, avec des descriptions spécifiques pour chacun.
          Cliquez sur un critère pour voir et modifier les descriptions détaillées des 5 niveaux.
        </p>
      </div>
    </div>
  </div>
  
  {#if isLoading}
    <div class="text-center py-8">
      <p class="text-gray-600">Chargement de la matrice...</p>
    </div>
  {:else if !$matrixStore.valueAxes || $matrixStore.valueAxes.length === 0}
    <div class="text-center py-8">
      <p class="text-gray-600 mb-4">Aucune matrice configurée pour ce dossier</p>
      <button 
        on:click={openCreateMatrixDialog}
        class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg"
      >
        Créer une nouvelle matrice
      </button>
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
      <!-- Value Axes Configuration -->
      <div class="bg-white rounded-lg shadow-md">
        <div class="bg-gradient-to-r from-purple-700 to-purple-900 p-4 rounded-t-lg">
          <h2 class="text-white text-lg font-semibold flex items-center">
            <span class="mr-2">Axes de Valeur</span>
            {#each Array.from({ length: 3 }) as _}
              <span class="text-yellow-500 text-xl">★</span>
            {/each}
            {#each Array.from({ length: 2 }) as _}
              <span class="text-gray-300 text-xl">★</span>
        {/each}
          </h2>
        </div>
        <div class="p-0">
          <table class="w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/2">Critère</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/4">Poids</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/4">Action</th>
              </tr>
            </thead>
            <tbody>
              {#each editedConfig.valueAxes as axis, index}
                <tr class="border-t">
                  <td class="px-4 py-3">
                    <div class="text-sm">
                      <EditableInput
                        value={axis.name}
                        originalValue={originalConfig.valueAxes[index]?.name || ""}
                        changeId={`value-axis-${index}-name`}
                        apiEndpoint={`http://localhost:8787/api/v1/folders/${$currentFolderId}/matrix`}
                        fullData={editedConfig}
                        on:change={(e) => updateAxisName(true, index, e.detail.value)}
                        on:saved={() => {
                          originalConfig = { ...editedConfig };
                        }}
                      />
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <input
                      type="number"
                      min="0.5"
                      max="3"
                      step="0.5"
                      value={axis.weight}
                      on:input={(e) => handleValueWeightChange(index, e.target.value)}
                      class="w-20 px-2 py-1 border border-gray-300 rounded"
                    />
                  </td>
                  <td class="px-4 py-3">
                    <button 
                      class="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded"
                      on:click={() => openAxisDescriptions(axis, true)}
                      title="Voir les niveaux"
                      aria-label="Voir les niveaux de {axis.name}"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                      </svg>
        </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- Complexity Axes Configuration -->
      <div class="bg-white rounded-lg shadow-md">
        <div class="bg-gradient-to-r from-gray-700 to-gray-900 p-4 rounded-t-lg">
          <h2 class="text-white text-lg font-semibold flex items-center">
            <span class="mr-2">Axes de Complexité</span>
            {#each Array.from({ length: 3 }) as _}
              <span class="text-gray-800 font-bold">X</span>
            {/each}
            {#each Array.from({ length: 2 }) as _}
              <span class="text-gray-300 font-bold">X</span>
        {/each}
          </h2>
        </div>
        <div class="p-0">
          <table class="w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/2">Critère</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/4">Poids</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/4">Action</th>
              </tr>
            </thead>
            <tbody>
              {#each editedConfig.complexityAxes as axis, index}
                <tr class="border-t">
                  <td class="px-4 py-3">
                    <div class="text-sm">
                      <EditableInput
                        value={axis.name}
                        originalValue={originalConfig.complexityAxes[index]?.name || ""}
                        changeId={`complexity-axis-${index}-name`}
                        apiEndpoint={`http://localhost:8787/api/v1/folders/${$currentFolderId}/matrix`}
                        fullData={editedConfig}
                        on:change={(e) => updateAxisName(false, index, e.detail.value)}
                        on:saved={() => {
                          originalConfig = { ...editedConfig };
                        }}
                      />
  </div>
                  </td>
                  <td class="px-4 py-3">
                    <input
                      type="number"
                      min="0.5"
                      max="3"
                      step="0.5"
                      value={axis.weight}
                      on:input={(e) => handleComplexityWeightChange(index, e.target.value)}
                      class="w-20 px-2 py-1 border border-gray-300 rounded"
                    />
                  </td>
                  <td class="px-4 py-3">
                    <button 
                      class="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded"
                      on:click={() => openAxisDescriptions(axis, false)}
                      title="Voir les niveaux"
                      aria-label="Voir les niveaux de {axis.name}"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                      </svg>
        </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
      <!-- Value Threshold Configuration -->
      <div class="bg-white rounded-lg shadow-md">
        <div class="bg-gradient-to-r from-purple-700 to-purple-900 p-4 rounded-t-lg">
          <h2 class="text-white text-lg font-semibold">Configuration des seuils de Valeur</h2>
        </div>
        <div class="p-0">
          <table class="w-full">
            <thead class="bg-purple-50">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/3">Valeur</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/3">Points Fibonacci</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/3">Nombre de cas</th>
              </tr>
            </thead>
            <tbody>
              {#each editedConfig.valueThresholds as threshold}
                <tr class="border-t">
                  <td class="px-4 py-3 font-medium">
                    <div class="flex">
                      {#each Array.from({ length: threshold.level }) as _}
                        <span class="text-yellow-500 text-xl">★</span>
                      {/each}
                      {#each Array.from({ length: 5 - threshold.level }) as _}
                        <span class="text-gray-300 text-xl">★</span>
                      {/each}
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <input
                      type="number"
                      value={threshold.points}
                      on:input={(e) => handlePointsChange(true, threshold.level, parseInt(e.target.value))}
                      class="w-20 px-2 py-1 border border-gray-300 rounded"
                    />
                  </td>
                  <td class="px-4 py-3 text-center font-semibold">
                    {threshold.cases || 0}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- Complexity Threshold Configuration -->
      <div class="bg-white rounded-lg shadow-md">
        <div class="bg-gradient-to-r from-gray-700 to-gray-900 p-4 rounded-t-lg">
          <h2 class="text-white text-lg font-semibold">Configuration des seuils de Complexité</h2>
        </div>
        <div class="p-0">
          <table class="w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/5">Complexité</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/5">Points Fibonacci</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/5">Nombre de cas</th>
              </tr>
            </thead>
            <tbody>
              {#each editedConfig.complexityThresholds as threshold}
                <tr class="border-t">
                  <td class="px-4 py-3 font-medium">
                    <div class="flex">
                      {#each Array.from({ length: threshold.level }) as _}
                        <span class="text-gray-800 font-bold">X</span>
                      {/each}
                      {#each Array.from({ length: 5 - threshold.level }) as _}
                        <span class="text-gray-300 font-bold">X</span>
                      {/each}
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <input
                      type="number"
                      value={threshold.points}
                      on:input={(e) => handlePointsChange(false, threshold.level, parseInt(e.target.value))}
                      class="w-20 px-2 py-1 border border-gray-300 rounded"
                    />
                  </td>
                  <td class="px-4 py-3 text-center font-semibold">
                    {threshold.cases || 0}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    
    <div class="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-8">
      <div class="flex">
        <svg class="h-6 w-6 text-yellow-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
        </svg>
        <p>
          Attention : Modifier les poids recalculera automatiquement tous les scores de vos cas d'usage existants.
        </p>
      </div>
    </div>
    
    <div class="flex justify-between">
      <button 
        on:click={openCreateMatrixDialog}
        class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center"
      >
        <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
        </svg>
        Créer une nouvelle matrice
      </button>
      <button 
        on:click={saveChanges}
        class="bg-navy hover:bg-navy/90 text-white px-4 py-2 rounded flex items-center"
      >
        <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path>
        </svg>
        Enregistrer la configuration
      </button>
    </div>
  {/if}
</div>

<!-- Dialog for displaying and editing detailed level descriptions -->
{#if showDescriptionsDialog}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg max-w-3xl max-h-[80vh] overflow-y-auto w-full mx-4">
      <div class="p-6">
        <h3 class="text-lg font-semibold mb-2">
          {selectedAxis?.name} - Description des niveaux
        </h3>
        <p class="text-gray-600 mb-4">
          Vous pouvez modifier les descriptions des 5 niveaux pour ce critère en cliquant sur le texte:
        </p>
        
        <table class="w-full">
          <thead>
            <tr class="border-b">
              <th class="text-left py-2">Niveau</th>
              <th class="text-left py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {#each Array.from({ length: 5 }) as _, level}
              {@const levelNum = level + 1}
              <tr class="border-b">
                <td class="py-3 align-top">
                  {#if isValueAxis}
                    <div class="flex">
                      {#each Array.from({ length: levelNum }) as _}
                        <span class="text-yellow-500 text-xl">★</span>
                      {/each}
                      {#each Array.from({ length: 5 - levelNum }) as _}
                        <span class="text-gray-300 text-xl">★</span>
                      {/each}
                    </div>
                  {:else}
                    <div class="flex">
                      {#each Array.from({ length: levelNum }) as _}
                        <span class="text-gray-800 font-bold">X</span>
                      {/each}
                      {#each Array.from({ length: 5 - levelNum }) as _}
                        <span class="text-gray-300 font-bold">X</span>
                      {/each}
                    </div>
                  {/if}
                </td>
                <td class="py-3">
                  <EditableInput
                    value={getLevelDescription(selectedAxis, levelNum)}
                    originalValue={getLevelDescription(selectedAxis, levelNum)}
                    changeId={`${isValueAxis ? 'value' : 'complexity'}-axis-${selectedAxis ? selectedAxis.name : 'unknown'}-level-${levelNum}`}
                    apiEndpoint={`http://localhost:8787/api/v1/folders/${$currentFolderId}/matrix`}
                    fullData={editedConfig}
                    on:change={(e) => updateLevelDescription(levelNum, e.detail.value)}
                    on:saved={() => {
                      originalConfig = { ...editedConfig };
                    }}
                  />
                </td>
              </tr>
        {/each}
          </tbody>
        </table>
        
        <div class="flex justify-end gap-3 mt-6">
          <button 
            on:click={handleCloseDescriptionsDialog}
            class="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded hover:bg-gray-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Dialog for creating a new matrix -->
{#if showCreateMatrixDialog}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg max-w-md w-full mx-4">
      <div class="p-6">
        <h3 class="text-lg font-semibold mb-4">
          Créer une nouvelle matrice
        </h3>
        <p class="text-gray-600 mb-6">
          Choisissez le type de matrice à créer :
        </p>
        
        <div class="space-y-4">
          <!-- Option 1: Matrice de base -->
          <label class="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input 
              type="radio" 
              bind:group={createMatrixType} 
              value="default" 
              class="mr-3"
            />
            <div>
              <div class="font-medium">Matrice de base</div>
              <div class="text-sm text-gray-600">Utiliser la matrice par défaut avec toutes les descriptions complètes</div>
            </div>
          </label>
          
          <!-- Option 2: Copier une matrice existante -->
          <label class="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input 
              type="radio" 
              bind:group={createMatrixType} 
              value="copy" 
              class="mr-3"
            />
            <div class="flex-1">
              <div class="font-medium">Copier une matrice existante</div>
              <div class="text-sm text-gray-600 mb-2">Copier la matrice d'un autre dossier</div>
              {#if createMatrixType === 'copy'}
                <select 
                  bind:value={selectedFolderToCopy}
                  class="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="">Sélectionner un dossier...</option>
                  {#each availableFolders as folder}
                    <option value={folder.id}>{folder.name}</option>
        {/each}
                </select>
              {/if}
            </div>
          </label>
          
          <!-- Option 3: Matrice vierge -->
          <label class="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input 
              type="radio" 
              bind:group={createMatrixType} 
              value="blank" 
              class="mr-3"
            />
            <div>
              <div class="font-medium">Matrice vierge</div>
              <div class="text-sm text-gray-600">Commencer avec une matrice vide</div>
            </div>
          </label>
        </div>
        
        <div class="flex justify-end gap-3 mt-6">
          <button 
            on:click={() => showCreateMatrixDialog = false}
            class="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            Annuler
          </button>
          <button 
            on:click={createNewMatrix}
            disabled={createMatrixType === 'copy' && !selectedFolderToCopy}
            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Créer
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Warning popup for unsaved changes when closing descriptions dialog -->
{#if showCloseWarning}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg max-w-md w-full mx-4 p-6">
      <div class="flex items-center mb-4">
        <svg class="w-6 h-6 text-yellow-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
        </svg>
        <h3 class="text-lg font-semibold text-gray-900">
          Modifications non sauvegardées
        </h3>
      </div>
      
      <p class="text-gray-600 mb-6">
        Vous avez des modifications non sauvegardées. Que souhaitez-vous faire ?
      </p>
      
      <div class="flex justify-end gap-3">
        <button 
          on:click={handleCloseWarningCancel}
          class="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
        >
          Annuler
        </button>
        <button 
          on:click={handleCloseWarningDiscard}
          class="px-4 py-2 text-red-600 hover:text-red-800 border border-red-300 rounded"
        >
          Ignorer et fermer
        </button>
        <button 
          on:click={handleCloseWarningSave}
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Sauvegarder et fermer
        </button>
      </div>
    </div>
  </div>
{/if}