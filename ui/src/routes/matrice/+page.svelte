<script lang="ts">
  import { matrixStore, type MatrixAxis } from '$lib/stores/matrix';
  import { currentFolderId, type Folder } from '$lib/stores/folders';
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPut } from '$lib/utils/api';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { API_BASE_URL } from '$lib/config';
  import { fetchUseCases } from '$lib/stores/useCases';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import { getScopedWorkspaceIdForAdmin } from '$lib/stores/adminWorkspaceScope';
  import { adminReadOnlyScope } from '$lib/stores/adminWorkspaceScope';
  import { Info, Eye, Trash2, AlertTriangle, Plus, Upload, Star, X } from '@lucide/svelte';

  // Helper to create array of indices for iteration
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

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
  
  // Variables pour l'auto-save de la matrice (seuils, poids, axes)
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let isSavingMatrix = false;

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
      const scoped = getScopedWorkspaceIdForAdmin();
      const qs = scoped ? `?workspace_id=${encodeURIComponent(scoped)}` : '';
      const folder = await apiGet(`/folders/${$currentFolderId}${qs}`);
      
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
    
    // Enregistrer/modifier la modification globale dans le store pour NavigationGuard
    unsavedChangesStore.addChange({
      id: 'matrix-config-all',
      component: 'matrix-config',
      value: editedConfig,
      saveFunction: saveMatrix
    });
    
    // Programmer la sauvegarde après 5 secondes (auto-save)
    scheduleMatrixSave();
    // Note: updateCaseCounts() n'est pas appelé ici car il fait un fetch des cas d'usage
    // Les comptages seront mis à jour après sauvegarde ou lors de la modification des seuils
  };
  
  const handleComplexityWeightChange = (index: number, weight: string) => {
    const newWeight = parseFloat(weight);
    if (isNaN(newWeight)) return;
    
    const newComplexityAxes = [...editedConfig.complexityAxes];
    newComplexityAxes[index] = { ...newComplexityAxes[index], weight: newWeight };
    editedConfig = { ...editedConfig, complexityAxes: newComplexityAxes };
    
    // Enregistrer/modifier la modification globale dans le store pour NavigationGuard
    unsavedChangesStore.addChange({
      id: 'matrix-config-all',
      component: 'matrix-config',
      value: editedConfig,
      saveFunction: saveMatrix
    });
    
    // Programmer la sauvegarde après 5 secondes (auto-save)
    scheduleMatrixSave();
    // Note: updateCaseCounts() n'est pas appelé ici car il fait un fetch des cas d'usage
    // Les comptages seront mis à jour après sauvegarde ou lors de la modification des seuils
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
        // Une seule entrée pour toute la config matrice (évite les appels multiples)
        unsavedChangesStore.addChange({
          id: 'matrix-config-all',
          component: 'matrix-config',
          value: editedConfig,
          saveFunction: saveMatrix
        });
        
        // Programmer la sauvegarde après 5 secondes (auto-save)
        scheduleMatrixSave();
        
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
        // Une seule entrée pour toute la config matrice (évite les appels multiples)
        unsavedChangesStore.addChange({
          id: 'matrix-config-all',
          component: 'matrix-config',
          value: editedConfig,
          saveFunction: saveMatrix
        });
        
        // Programmer la sauvegarde après 5 secondes (auto-save)
        scheduleMatrixSave();
        
        // Recalculer les comptages immédiatement
        updateCaseCounts();
      }
    }
  };

  /**
   * Programme la sauvegarde de la matrice après 5 secondes d'inactivité
   * Utilisé pour les seuils, poids d'axes, et autres modifications
   */
  const scheduleMatrixSave = () => {
    // Annuler le timeout précédent s'il existe
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    // Programmer la sauvegarde après 5 secondes
    saveTimeout = setTimeout(async () => {
      await saveMatrix();
    }, 5000);
  };

  /**
   * Sauvegarde automatique de la matrice modifiée
   * Cette fonction est appelée soit :
   * - Automatiquement après 5 secondes d'inactivité (via scheduleMatrixSave)
   * - Par NavigationGuard lors de la navigation (via unsavedChangesStore.saveAll)
   */
  const saveMatrix = async () => {
    if ($adminReadOnlyScope) return;
    if (!$currentFolderId || isSavingMatrix) return;
    
    isSavingMatrix = true;
    try {
      await apiPut(`/folders/${$currentFolderId}/matrix`, editedConfig);
      matrixStore.set(editedConfig);
      originalConfig = { ...editedConfig };
      
      // Nettoyer la modification sauvegardée du store
      // On retire la modification globale de la config matrice
      unsavedChangesStore.removeChange('matrix-config-all');
      
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
      console.error('Failed to save matrix:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la sauvegarde automatique de la configuration'
      });
    } finally {
      isSavingMatrix = false;
    }
  };

  const saveChanges = async () => {
    if ($adminReadOnlyScope) {
      addToast({ type: 'warning', message: 'Mode lecture seule : modification désactivée.' });
      return;
    }
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
      id: `matrix-config-all`,
      component: 'matrix-config',
      value: editedConfig,
      saveFunction: saveMatrix // Réutiliser la même fonction de sauvegarde
    });
    
    // Programmer la sauvegarde après 5 secondes
    scheduleMatrixSave();
    // Note: updateCaseCounts() n'est pas appelé ici car l'ajout d'axe ne change pas les comptages
    // Les comptages seront mis à jour après sauvegarde ou lors de la modification des seuils
    
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
      id: `matrix-config-all`,
      component: 'matrix-config',
      value: editedConfig,
      saveFunction: saveMatrix
    });
    
    // Programmer la sauvegarde après 5 secondes
    scheduleMatrixSave();
    // Note: updateCaseCounts() n'est pas appelé ici car la suppression d'axe ne change pas les comptages
    // Les comptages seront mis à jour après sauvegarde ou lors de la modification des seuils
    
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
    if ($adminReadOnlyScope) {
      addToast({ type: 'warning', message: 'Mode lecture seule : modification désactivée.' });
      showCloseWarning = false;
      showDescriptionsDialog = false;
      return;
    }
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
      const scoped = getScopedWorkspaceIdForAdmin();
      const qs = scoped ? `?workspace_id=${encodeURIComponent(scoped)}` : '';
      const data = await apiGet<{ items: Folder[] }>(`/folders/list/with-matrices${qs}`);
      availableFolders = data.items.filter((folder) => folder.hasMatrix && folder.id !== $currentFolderId);
    } catch (error) {
      console.error('Failed to load folders:', error);
    }
  };

  const createNewMatrix = async () => {
    if ($adminReadOnlyScope) {
      addToast({ type: 'warning', message: 'Mode lecture seule : modification désactivée.' });
      return;
    }
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
        const scoped = getScopedWorkspaceIdForAdmin();
        const qs = scoped ? `?workspace_id=${encodeURIComponent(scoped)}` : '';
        matrixToUse = await apiGet(`/folders/${selectedFolderToCopy}/matrix${qs}`);
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

  {#if $adminReadOnlyScope}
    <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 mb-4">
      Mode admin — workspace partagé : <b>lecture seule</b> (édition désactivée).
    </div>
  {/if}
  
  {#if $currentFolderId}
    <p class="text-gray-600 -mt-4 mb-6">
      Dossier sélectionné
    </p>
  {/if}
  
  <div class="bg-blue-50 border-l-4 border-blue-500 p-4 mb-8">
    <div class="flex">
      <Info class="h-6 w-6 text-blue-500 mr-2" />
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
            <div class="flex items-center gap-1 ml-1">
              {#each range(3) as i (i)}
                <Star class="w-5 h-5 text-yellow-400 fill-yellow-400" />
              {/each}
              {#each range(2) as i (i)}
                <Star class="w-5 h-5 text-gray-300" />
              {/each}
            </div>
          </h2>
          <button
            on:click={() => addAxis(true)}
            class="bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-3 py-1 rounded text-sm flex items-center"
            title="Ajouter un axe de valeur"
          >
            <Plus class="w-4 h-4 mr-1" />
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
                      <Eye class="w-4 h-4" />
        </button>
                      <button
                        class="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        on:click={() => removeAxis(true, index)}
                        title="Supprimer cet axe"
                        aria-label="Supprimer {axis.name}"
                      >
                        <Trash2 class="w-4 h-4" />
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
            <div class="flex items-center gap-1 ml-1">
              {#each range(3) as i (i)}
                <X class="w-5 h-5 text-white" />
              {/each}
              {#each range(2) as i (i)}
                <X class="w-5 h-5 text-gray-400" />
              {/each}
            </div>
          </h2>
          <button
            on:click={() => addAxis(false)}
            class="bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-3 py-1 rounded text-sm flex items-center"
            title="Ajouter un axe de complexité"
          >
            <Plus class="w-4 h-4 mr-1" />
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
                      <Eye class="w-4 h-4" />
        </button>
                      <button
                        class="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        on:click={() => removeAxis(false, index)}
                        title="Supprimer cet axe"
                        aria-label="Supprimer {axis.name}"
                      >
                        <Trash2 class="w-4 h-4" />
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
                    <div class="flex items-center gap-1">
                      {#each range(threshold.level) as i (i)}
                        <Star class="w-5 h-5 text-yellow-400 fill-yellow-400" />
                      {/each}
                      {#each range(5 - threshold.level) as i (i)}
                        <Star class="w-5 h-5 text-gray-300" />
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
                    <div class="flex items-center gap-1">
                      {#each range(threshold.level) as i (i)}
                        <X class="w-5 h-5 text-gray-800" />
                      {/each}
                      {#each range(5 - threshold.level) as i (i)}
                        <X class="w-5 h-5 text-gray-300" />
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
        <AlertTriangle class="h-6 w-6 text-yellow-500 mr-2" />
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
        <Plus class="mr-2 h-4 w-4" />
        Créer une nouvelle matrice
      </button>
      <button 
        on:click={saveChanges}
        class="bg-navy hover:bg-navy/90 text-white px-4 py-2 rounded flex items-center"
      >
        <Upload class="mr-2 h-4 w-4" />
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
            {#each range(5) as level}
              {@const levelNum = level + 1}
              <tr class="border-b">
                <td class="py-3 align-top">
                  {#if isValueAxis}
                    <div class="flex items-center gap-1">
                      {#each range(levelNum) as i (i)}
                        <Star class="w-5 h-5 text-yellow-400 fill-yellow-400" />
                      {/each}
                      {#each range(5 - levelNum) as i (i)}
                        <Star class="w-5 h-5 text-gray-300" />
                      {/each}
                    </div>
                  {:else}
                    <div class="flex items-center gap-1">
                      {#each range(levelNum) as i (i)}
                        <X class="w-5 h-5 text-gray-800" />
                      {/each}
                      {#each range(5 - levelNum) as i (i)}
                        <X class="w-5 h-5 text-gray-300" />
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
        <AlertTriangle class="w-6 h-6 text-yellow-500 mr-3" />
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