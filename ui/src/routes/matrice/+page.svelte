<script lang="ts">
  import { matrixStore, type MatrixAxis } from '$lib/stores/matrix';
  import { currentFolderId, type Folder } from '$lib/stores/folders';
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPost, apiPut } from '$lib/utils/api';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { API_BASE_URL } from '$lib/config';
  import { fetchUseCases } from '$lib/stores/useCases';
  import { calculateUseCaseScores } from '$lib/utils/scoring';

  let isLoading = false;
  let editedConfig = { ...$matrixStore };
  let originalConfig = { ...$matrixStore };
  let selectedAxis: any = null;
  let isValueAxis = false;
  let showDescriptionsDialog = false;
  let showCreateMatrixDialog = false;
  let showCloseWarning = false;
  let createMatrixType = 'default'; // 'default', 'copy', 'blank'
  let availableFolders: Folder[] = [];
  let selectedFolderToCopy = '';
  
  // Variables pour l'auto-save des seuils
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let isSavingThresholds = false;

  onMount(async () => {
    await loadMatrix();
    await updateCaseCounts();
  });

  onDestroy(() => {
    // Nettoyer le timeout d'auto-save si la page est quittée
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
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
      const folder = await apiGet(`/folders/${$currentFolderId}`);
      
      if (folder.matrixConfig) {
        const matrix = typeof folder.matrixConfig === 'string' 
          ? JSON.parse(folder.matrixConfig) 
          : folder.matrixConfig;
        matrixStore.set(matrix);
        editedConfig = { ...matrix };
        originalConfig = { ...matrix };
        addToast({
          type: 'success',
          message: `Évaluation du dossier "${folder.name}" chargée`
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

  /**
   * Détermine le niveau (1-5) d'un score en comparant avec les thresholds
   * Le niveau est le plus grand level tel que score >= threshold.points
   */
  const getLevelFromScore = (score: number, thresholds: Array<{ level: number; points: number }>): number => {
    // Trier les thresholds par level décroissant pour trouver le plus grand level qui correspond
    const sortedThresholds = [...thresholds].sort((a, b) => b.level - a.level);
    for (const threshold of sortedThresholds) {
      if (score >= threshold.points) {
        return threshold.level;
      }
    }
    return 1; // Par défaut, niveau 1 si aucun threshold ne correspond
  };

  /**
   * Met à jour le comptage des cas d'usage par seuil de valeur et complexité
   */
  const updateCaseCounts = async () => {
    if (!$currentFolderId || !editedConfig) return;

    try {
      // Charger les cas d'usage du dossier
      const useCases = await fetchUseCases($currentFolderId);

      // Initialiser les compteurs à 0
      const valueCounts: Record<number, number> = {};
      const complexityCounts: Record<number, number> = {};
      
      editedConfig.valueThresholds.forEach(t => valueCounts[t.level] = 0);
      editedConfig.complexityThresholds.forEach(t => complexityCounts[t.level] = 0);

      // Pour chaque cas d'usage, calculer les scores et déterminer les niveaux
      for (const useCase of useCases) {
        const valueScores = useCase.data?.valueScores || useCase.valueScores || [];
        const complexityScores = useCase.data?.complexityScores || useCase.complexityScores || [];

        if (valueScores.length > 0 || complexityScores.length > 0) {
          // Adapter editedConfig au type attendu par calculateUseCaseScores
          const configForScoring = {
            valueAxes: editedConfig.valueAxes.map(axis => ({
              id: axis.id,
              name: axis.name,
              weight: axis.weight,
              description: axis.description || '',
              levelDescriptions: axis.levelDescriptions || []
            })),
            complexityAxes: editedConfig.complexityAxes.map(axis => ({
              id: axis.id,
              name: axis.name,
              weight: axis.weight,
              description: axis.description || '',
              levelDescriptions: axis.levelDescriptions || []
            })),
            valueThresholds: editedConfig.valueThresholds.map(t => ({ level: t.level, points: t.points })),
            complexityThresholds: editedConfig.complexityThresholds.map(t => ({ level: t.level, points: t.points }))
          };
          
          const scores = calculateUseCaseScores(configForScoring, valueScores, complexityScores);
          
          // Déterminer le niveau pour la valeur
          const valueLevel = getLevelFromScore(scores.finalValueScore, editedConfig.valueThresholds);
          valueCounts[valueLevel] = (valueCounts[valueLevel] || 0) + 1;
          
          // Déterminer le niveau pour la complexité
          const complexityLevel = getLevelFromScore(scores.finalComplexityScore, editedConfig.complexityThresholds);
          complexityCounts[complexityLevel] = (complexityCounts[complexityLevel] || 0) + 1;
        }
      }

      // Mettre à jour editedConfig avec les comptages
      editedConfig = {
        ...editedConfig,
        valueThresholds: editedConfig.valueThresholds.map(t => ({
          ...t,
          cases: valueCounts[t.level] || 0
        })),
        complexityThresholds: editedConfig.complexityThresholds.map(t => ({
          ...t,
          cases: complexityCounts[t.level] || 0
        }))
      };
    } catch (error) {
      console.error('Failed to update case counts:', error);
      // Ne pas afficher d'erreur toast car c'est une fonctionnalité secondaire
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
    const pointsNumber = typeof points === 'string' ? Number(points) : points;
    if (isValue && editedConfig.valueThresholds) {
      const newThresholds = [...editedConfig.valueThresholds];
      const index = newThresholds.findIndex(t => t.level === level);
      if (index !== -1) {
        newThresholds[index] = { ...newThresholds[index], points: pointsNumber };
        editedConfig = { ...editedConfig, valueThresholds: newThresholds };
        
        // Enregistrer/modifier la modification globale dans le store pour NavigationGuard
        // Une seule entrée pour tous les seuils (évite les appels multiples)
        unsavedChangesStore.addChange({
          id: 'matrix-thresholds-all',
          component: 'matrix-thresholds',
          value: editedConfig,
          saveFunction: saveThresholds
        });
        
        // Programmer la sauvegarde après 5 secondes (auto-save)
        scheduleThresholdSave();
        
        // Recalculer les comptages immédiatement (pour feedback visuel)
        updateCaseCounts();
      }
    } else if (!isValue && editedConfig.complexityThresholds) {
      const newThresholds = [...editedConfig.complexityThresholds];
      const index = newThresholds.findIndex(t => t.level === level);
      if (index !== -1) {
        newThresholds[index] = { ...newThresholds[index], points: pointsNumber };
        editedConfig = { ...editedConfig, complexityThresholds: newThresholds };
        
        // Enregistrer/modifier la modification globale dans le store pour NavigationGuard
        // Une seule entrée pour tous les seuils (évite les appels multiples)
        unsavedChangesStore.addChange({
          id: 'matrix-thresholds-all',
          component: 'matrix-thresholds',
          value: editedConfig,
          saveFunction: saveThresholds
        });
        
        // Programmer la sauvegarde après 5 secondes (auto-save)
        scheduleThresholdSave();
        
        // Recalculer les comptages immédiatement
        updateCaseCounts();
      }
    }
  };

  /**
   * Programme la sauvegarde des seuils après 5 secondes d'inactivité
   */
  const scheduleThresholdSave = () => {
    // Annuler le timeout précédent s'il existe
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    // Programmer la sauvegarde après 5 secondes
    saveTimeout = setTimeout(async () => {
      await saveThresholds();
    }, 5000);
  };

  /**
   * Sauvegarde automatique des seuils modifiés
   * Cette fonction est appelée soit :
   * - Automatiquement après 5 secondes d'inactivité (via scheduleThresholdSave)
   * - Par NavigationGuard lors de la navigation (via unsavedChangesStore.saveAll)
   */
  const saveThresholds = async () => {
    if (!$currentFolderId || isSavingThresholds) return;
    
    isSavingThresholds = true;
    try {
      await apiPut(`/folders/${$currentFolderId}/matrix`, editedConfig);
      matrixStore.set(editedConfig);
      originalConfig = { ...editedConfig };
      
      // Nettoyer la modification sauvegardée du store
      // On retire la modification globale des seuils
      unsavedChangesStore.removeChange('matrix-thresholds-all');
      
      // Annuler le timeout d'auto-save s'il existe (car on vient de sauvegarder)
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }
      
      // Recalculer les comptages après sauvegarde
      await updateCaseCounts();
      
      // Toast silencieux (pas de notification visible pour auto-save)
      // L'utilisateur verra les comptages mis à jour
    } catch (error) {
      console.error('Failed to save thresholds:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la sauvegarde automatique des seuils'
      });
    } finally {
      isSavingThresholds = false;
    }
  };

  const saveChanges = async () => {
    if (!$currentFolderId) return;
    
    try {
      await apiPut(`/folders/${$currentFolderId}/matrix`, editedConfig);
      matrixStore.set(editedConfig);
      originalConfig = { ...editedConfig };
      // Mettre à jour les comptages après sauvegarde
      await updateCaseCounts();
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

  /**
   * Ajoute un nouvel axe de valeur ou de complexité
   */
  const addAxis = (isValue: boolean) => {
    const newAxis: MatrixAxis = {
      id: `axis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: isValue ? 'Nouvel axe de valeur' : 'Nouvel axe de complexité',
      weight: 1.0,
      description: '',
      levelDescriptions: []
    };
    
    if (isValue) {
      const newValueAxes = [...editedConfig.valueAxes, newAxis];
      editedConfig = { ...editedConfig, valueAxes: newValueAxes };
    } else {
      const newComplexityAxes = [...editedConfig.complexityAxes, newAxis];
      editedConfig = { ...editedConfig, complexityAxes: newComplexityAxes };
    }
    
    // Enregistrer la modification dans le store
    unsavedChangesStore.addChange({
      id: `matrix-axes-all`,
      component: 'matrix-axes',
      value: editedConfig,
      saveFunction: saveThresholds // Réutiliser la même fonction de sauvegarde
    });
    
    // Programmer la sauvegarde après 5 secondes
    scheduleThresholdSave();
    
    // Recalculer les comptages après ajout d'axe
    updateCaseCounts();
    
    addToast({
      type: 'success',
      message: `Nouvel axe ${isValue ? 'de valeur' : 'de complexité'} ajouté`
    });
  };

  /**
   * Supprime un axe de valeur ou de complexité
   */
  const removeAxis = (isValue: boolean, index: number) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer cet axe ? Cette action affectera le calcul des scores des cas d'usage.`)) {
      return;
    }
    
    if (isValue) {
      const newValueAxes = editedConfig.valueAxes.filter((_, i) => i !== index);
      editedConfig = { ...editedConfig, valueAxes: newValueAxes };
    } else {
      const newComplexityAxes = editedConfig.complexityAxes.filter((_, i) => i !== index);
      editedConfig = { ...editedConfig, complexityAxes: newComplexityAxes };
    }
    
    // Enregistrer la modification dans le store
    unsavedChangesStore.addChange({
      id: `matrix-axes-all`,
      component: 'matrix-axes',
      value: editedConfig,
      saveFunction: saveThresholds
    });
    
    // Programmer la sauvegarde après 5 secondes
    scheduleThresholdSave();
    
    // Recalculer les comptages après suppression d'axe
    updateCaseCounts();
    
    addToast({
      type: 'success',
      message: `Axe ${isValue ? 'de valeur' : 'de complexité'} supprimé`
    });
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
      const data = await apiGet<{ items: Folder[] }>('/folders/list/with-matrices');
      availableFolders = data.items.filter((folder) => folder.hasMatrix && folder.id !== $currentFolderId);
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
        matrixToUse = await apiGet('/folders/matrix/default');
        console.log('Default matrix fetched:', matrixToUse);
      } else if (createMatrixType === 'copy' && selectedFolderToCopy) {
        // Copier une matrice existante
        matrixToUse = await apiGet(`/folders/${selectedFolderToCopy}/matrix`);
      } else if (createMatrixType === 'blank') {
        // Évaluation vierge
        matrixToUse = {
          valueAxes: [],
          complexityAxes: [],
          valueThresholds: [],
          complexityThresholds: []
        };
      }
      
      if (matrixToUse) {
        console.log('Saving matrix to folder:', $currentFolderId);
        await apiPut(`/folders/${$currentFolderId}/matrix`, matrixToUse);
        matrixStore.set(matrixToUse);
        editedConfig = { ...matrixToUse };
        originalConfig = { ...matrixToUse };
        showCreateMatrixDialog = false;
        // Mettre à jour les comptages après création
        await updateCaseCounts();
        addToast({
          type: 'success',
          message: 'Nouvelle matrice créée avec succès'
        });
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
  <h1 class="text-3xl font-bold mb-6 text-navy">Configuration de l'évaluation Valeur/Complexité</h1>
  
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
        <div class="bg-gradient-to-r from-purple-700 to-purple-900 p-4 rounded-t-lg flex items-center justify-between">
          <h2 class="text-white text-lg font-semibold flex items-center">
            <span class="mr-2">Axes de Valeur</span>
            {#each Array.from({ length: 3 }) as _}
              <span class="text-yellow-500 text-xl">★</span>
            {/each}
            {#each Array.from({ length: 2 }) as _}
              <span class="text-gray-300 text-xl">★</span>
        {/each}
          </h2>
          <button
            on:click={() => addAxis(true)}
            class="bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-3 py-1 rounded text-sm flex items-center"
            title="Ajouter un axe de valeur"
          >
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
            </svg>
            Ajouter
          </button>
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
                    <div class="text-sm w-full">
                      <EditableInput
                        value={axis.name}
                        originalValue={originalConfig.valueAxes[index]?.name || ""}
                        changeId={`value-axis-${index}-name`}
                        apiEndpoint={`${API_BASE_URL}/folders/${$currentFolderId}/matrix`}
                        fullData={editedConfig}
                        multiline={true}
                        markdown={false}
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
                      on:input={(e) => {
                        const target = e.target as HTMLInputElement;
                        if (target) handleValueWeightChange(index, target.value);
                      }}
                      class="w-20 px-2 py-1 border border-gray-300 rounded"
                    />
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
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
                      <button
                        class="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        on:click={() => removeAxis(true, index)}
                        title="Supprimer cet axe"
                        aria-label="Supprimer {axis.name}"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- Complexity Axes Configuration -->
      <div class="bg-white rounded-lg shadow-md">
        <div class="bg-gradient-to-r from-gray-700 to-gray-900 p-4 rounded-t-lg flex items-center justify-between">
          <h2 class="text-white text-lg font-semibold flex items-center">
            <span class="mr-2">Axes de Complexité</span>
            {#each Array.from({ length: 3 }) as _}
              <span class="text-gray-800 font-bold">X</span>
            {/each}
            {#each Array.from({ length: 2 }) as _}
              <span class="text-gray-300 font-bold">X</span>
        {/each}
          </h2>
          <button
            on:click={() => addAxis(false)}
            class="bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-3 py-1 rounded text-sm flex items-center"
            title="Ajouter un axe de complexité"
          >
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
            </svg>
            Ajouter
          </button>
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
                    <div class="text-sm w-full">
                      <EditableInput
                        value={axis.name}
                        originalValue={originalConfig.complexityAxes[index]?.name || ""}
                        changeId={`complexity-axis-${index}-name`}
                        apiEndpoint={`${API_BASE_URL}/folders/${$currentFolderId}/matrix`}
                        fullData={editedConfig}
                        multiline={true}
                        markdown={false}
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
                      on:input={(e) => {
                        const target = e.target as HTMLInputElement;
                        if (target) handleComplexityWeightChange(index, target.value);
                      }}
                      class="w-20 px-2 py-1 border border-gray-300 rounded"
                    />
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
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
                      <button
                        class="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        on:click={() => removeAxis(false, index)}
                        title="Supprimer cet axe"
                        aria-label="Supprimer {axis.name}"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                      </button>
                    </div>
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
                      on:input={(e) => {
                        const target = e.target as HTMLInputElement;
                        if (target) handlePointsChange(true, threshold.level, parseInt(target.value));
                      }}
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
                      on:input={(e) => {
                        const target = e.target as HTMLInputElement;
                        if (target) handlePointsChange(false, threshold.level, parseInt(target.value));
                      }}
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
                    apiEndpoint={`${API_BASE_URL}/folders/${$currentFolderId}/matrix`}
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
              <div class="font-medium">Évaluation de base</div>
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
              <div class="font-medium">Évaluation vierge</div>
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