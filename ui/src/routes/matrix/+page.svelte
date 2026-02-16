<script lang="ts">
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import {
    matrixStore,
    type MatrixAxis,
    type MatrixConfig,
    type MatrixThreshold
  } from '$lib/stores/matrix';
  import { currentFolderId, type Folder } from '$lib/stores/folders';
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPut } from '$lib/utils/api';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { streamHub } from '$lib/stores/streamHub';
  import LockPresenceBadge from '$lib/components/LockPresenceBadge.svelte';
  import { API_BASE_URL } from '$lib/config';
  import { fetchUseCases } from '$lib/stores/useCases';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import { workspaceReadOnlyScope, workspaceScopeHydrated, selectedWorkspaceRole, selectedWorkspace } from '$lib/stores/workspaceScope';
  import { session } from '$lib/stores/session';
  import { acceptUnlock, acquireLock, fetchLock, forceUnlock, releaseLock, requestUnlock, sendPresence, fetchPresence, leavePresence, type LockSnapshot, type PresenceUser } from '$lib/utils/object-lock';
  import { Info, Eye, Trash2, AlertTriangle, Plus, Upload, Star, X, Lock } from '@lucide/svelte';
  import FileMenu from '$lib/components/FileMenu.svelte';
  import ImportExportDialog from '$lib/components/ImportExportDialog.svelte';
  import { AUTOSAVE_DEBOUNCE_MS } from '$lib/constants/autosave';

  // Helper to create array of indices for iteration
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  const HUB_KEY = 'matrixPage';
  const MATRIX_SAVE_DELAY_MS = AUTOSAVE_DEBOUNCE_MS;
  const MATRIX_UNSAVED_CHANGE_PREFIXES = ['value-axis-', 'complexity-axis-', 'matrix-config-all'];

  let isLoading = false;
  let editedConfig = { ...$matrixStore };
  let originalConfig = { ...$matrixStore };
  let lastAppliedMatrixSnapshot = '';
  let selectedAxisId: string | null = null;
  let selectedAxis: MatrixAxis | null = null;
  let isValueAxis = false;
  let showDescriptionsDialog = false;
  let showCreateMatrixDialog = false;
  let showCloseWarning = false;
  let createMatrixType = 'default'; // 'default', 'copy', 'blank'
  let availableFolders: Folder[] = [];
  let selectedFolderToCopy = '';
  let isReadOnly = false;
  let showExportDialog = false;
  let currentFolderName = '';
  $: workspaceName = $selectedWorkspace?.name || '';
  let lockHubKey: string | null = null;
  let lockRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let lockTargetId: string | null = null;
  let lock: LockSnapshot | null = null;
  let lockLoading = false;
  let lockError: string | null = null;
  let suppressAutoLock = false;
  let presenceUsers: PresenceUser[] = [];
  let presenceTotal = 0;
  
  // Auto-save state for the matrix (thresholds, weights, axes)
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let isSavingMatrix = false;
  $: showReadOnlyLock = $workspaceScopeHydrated && $workspaceReadOnlyScope;
  $: isWorkspaceAdmin = $selectedWorkspaceRole === 'admin';
  $: isLockedByMe = !!lock && lock.lockedBy.userId === $session.user?.id;
  $: isLockedByOther = !!lock && lock.lockedBy.userId !== $session.user?.id;
  $: lockOwnerLabel = lock?.lockedBy?.displayName || lock?.lockedBy?.email || get(_)('common.user');
  $: lockRequestedByMe = !!lock && lock.unlockRequestedByUserId === $session.user?.id;
  $: showPresenceBadge = lockLoading || lockError || !!lock || presenceUsers.length > 0 || presenceTotal > 0;
  $: isReadOnly = $workspaceReadOnlyScope || isLockedByOther;
  let lastReadOnlyRole = $workspaceReadOnlyScope;
  const LOCK_REFRESH_MS = 10 * 1000;

  const parseOptionalObject = (value: unknown): Record<string, any> | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'object') return value as Record<string, any>;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed === null) return null;
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  };

  const normalizeAxis = (
    axis: Record<string, any> | null | undefined,
    kind: 'value' | 'complexity',
    index: number
  ): MatrixAxis => ({
    id:
      typeof axis?.id === 'string' && axis.id.trim().length > 0
        ? axis.id
        : `${kind}-axis-${index + 1}`,
    name: typeof axis?.name === 'string' ? axis.name : '',
    weight: Number.isFinite(Number(axis?.weight)) ? Number(axis?.weight) : 1,
    description: typeof axis?.description === 'string' ? axis.description : '',
    levelDescriptions: Array.isArray(axis?.levelDescriptions)
      ? axis.levelDescriptions.map((ld: Record<string, any>, levelIndex: number) => ({
          level: Number.isFinite(Number(ld?.level)) ? Number(ld.level) : levelIndex + 1,
          description: typeof ld?.description === 'string' ? ld.description : ''
        }))
      : []
  });

  const normalizeThreshold = (
    threshold: Record<string, any> | null | undefined,
    index: number
  ): MatrixThreshold => {
    const points = Number.isFinite(Number(threshold?.points)) ? Number(threshold?.points) : 0;
    const level = Number.isFinite(Number(threshold?.level)) ? Number(threshold?.level) : index + 1;
    return {
      level,
      points,
      threshold: Number.isFinite(Number(threshold?.threshold))
        ? Number(threshold?.threshold)
        : points,
      ...(Number.isFinite(Number(threshold?.cases))
        ? { cases: Number(threshold?.cases) }
        : {})
    };
  };

  const cloneMatrixConfig = (matrix: Record<string, any>): MatrixConfig => {
    const cloned: MatrixConfig = {
      valueAxes: Array.isArray(matrix.valueAxes)
        ? matrix.valueAxes.map((axis: Record<string, any>, index: number) =>
            normalizeAxis(axis, 'value', index)
          )
        : [],
      complexityAxes: Array.isArray(matrix.complexityAxes)
        ? matrix.complexityAxes.map((axis: Record<string, any>, index: number) =>
            normalizeAxis(axis, 'complexity', index)
          )
        : [],
      valueThresholds: Array.isArray(matrix.valueThresholds)
        ? matrix.valueThresholds.map((threshold: Record<string, any>, index: number) =>
            normalizeThreshold(threshold, index)
          )
        : [],
      complexityThresholds: Array.isArray(matrix.complexityThresholds)
        ? matrix.complexityThresholds.map((threshold: Record<string, any>, index: number) =>
            normalizeThreshold(threshold, index)
          )
        : []
    };

    if (Array.isArray(matrix.valueLevelDescriptions)) {
      cloned.valueLevelDescriptions = matrix.valueLevelDescriptions.map((value: unknown) =>
        value == null ? '' : String(value)
      );
    }
    if (Array.isArray(matrix.complexityLevelDescriptions)) {
      cloned.complexityLevelDescriptions = matrix.complexityLevelDescriptions.map((value: unknown) =>
        value == null ? '' : String(value)
      );
    }
    return cloned;
  };

  const stringifyMatrixConfig = (value: unknown): string => {
    if (!value || typeof value !== 'object') return '';
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  };

  const hasPendingMatrixChanges = () => {
    const changes = get(unsavedChangesStore).changes;
    return changes.some((change) =>
      MATRIX_UNSAVED_CHANGE_PREFIXES.some((prefix) => change.id.startsWith(prefix))
    );
  };

  const buildMatrixPayload = (override?: any): MatrixConfig => {
    const draft = cloneMatrixConfig(editedConfig as Record<string, any>);
    if (override) override(draft);
    return draft;
  };

  const findAxisById = (
    config: MatrixConfig,
    axisId: string | null,
    valueAxis: boolean
  ): MatrixAxis | null => {
    if (!axisId) return null;
    const axes = valueAxis ? config.valueAxes : config.complexityAxes;
    return axes.find((axis) => axis.id === axisId) ?? null;
  };

  $: selectedAxis = findAxisById(editedConfig as MatrixConfig, selectedAxisId, isValueAxis);

  const applyMatrixSnapshotFromFolder = (
    folderData: any,
    origin: 'load' | 'sse' = 'sse'
  ) => {
    if (!folderData) return;
    if (typeof folderData.name === 'string') {
      currentFolderName = folderData.name;
    }
    const rawMatrix = folderData.matrixConfig ?? folderData.matrix_config;
    const parsedMatrix = parseOptionalObject(rawMatrix);
    if (!parsedMatrix || typeof parsedMatrix !== 'object') return;
    const normalizedMatrix = cloneMatrixConfig(parsedMatrix);
    const nextSnapshot = stringifyMatrixConfig(normalizedMatrix);
    if (!nextSnapshot || nextSnapshot === lastAppliedMatrixSnapshot) return;
    lastAppliedMatrixSnapshot = nextSnapshot;

    const preserveLocalDraft = origin === 'sse' && hasPendingMatrixChanges();
    originalConfig = cloneMatrixConfig(normalizedMatrix);
    matrixStore.set(cloneMatrixConfig(normalizedMatrix));
    if (!preserveLocalDraft) {
      editedConfig = cloneMatrixConfig(normalizedMatrix);
      unsavedChangesStore.removeChange('matrix-config-all');
    }
    void updateCaseCounts();
  };

  onMount(async () => {
    await loadMatrix();
    streamHub.set(HUB_KEY, (evt: any) => {
      if (evt?.type !== 'folder_update') return;
      const folderId: string = evt.folderId;
      const data: any = evt.data ?? {};
      if (!folderId || !$currentFolderId || folderId !== $currentFolderId) return;
      if (data?.deleted) return;
      if (data?.folder) {
        applyMatrixSnapshotFromFolder(data.folder, 'sse');
      }
    });
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('beforeunload', handleLeave);
  });

  onDestroy(() => {
    // Clean up the auto-save timeout when leaving the page
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    streamHub.delete(HUB_KEY);
    if (lockHubKey) streamHub.delete(lockHubKey);
    if (lockRefreshTimer) clearInterval(lockRefreshTimer);
    if (lockTargetId) void leavePresence('folder', lockTargetId);
    void releaseCurrentLock();
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handleLeave);
    window.removeEventListener('beforeunload', handleLeave);
  });

  const subscribeLock = (targetId: string) => {
    if (lockHubKey) streamHub.delete(lockHubKey);
    lockHubKey = `lock:matrix:${targetId}`;
    streamHub.set(lockHubKey, (evt: any) => {
      if (evt?.type === 'lock_update') {
        if (evt.objectType !== 'folder') return;
        if (evt.objectId !== targetId) return;
        lock = evt?.data?.lock ?? null;
        if (!lock && !$workspaceReadOnlyScope) {
          if (suppressAutoLock) {
            suppressAutoLock = false;
            return;
          }
          void syncLock();
        }
        return;
      }
      if (evt?.type === 'presence_update') {
        if (evt.objectType !== 'folder') return;
        if (evt.objectId !== targetId) return;
        presenceTotal = Number(evt?.data?.total ?? 0);
        presenceUsers = Array.isArray(evt?.data?.users)
          ? evt.data.users.filter((u: PresenceUser) => u.userId !== $session.user?.id)
          : [];
        return;
      }
      if (evt?.type === 'ping') {
        void updatePresence();
      }
    });
  };

  const syncLock = async () => {
    if (!lockTargetId) return;
    lockLoading = true;
    lockError = null;
    try {
      if ($workspaceReadOnlyScope) {
        lock = await fetchLock('folder', lockTargetId);
      } else {
        const res = await acquireLock('folder', lockTargetId);
        lock = res.lock;
      }
      scheduleLockRefresh();
    } catch (e: any) {
      lockError = e?.message ?? get(_)('matrix.lockError');
    } finally {
      lockLoading = false;
    }
  };

  const scheduleLockRefresh = () => {
    if (lockRefreshTimer) clearInterval(lockRefreshTimer);
    if (!lock || !isLockedByMe) return;
    lockRefreshTimer = setInterval(() => {
      void refreshLock();
    }, LOCK_REFRESH_MS);
  };

  $: if (lock && isLockedByMe) {
    scheduleLockRefresh();
  }

  const refreshLock = async () => {
    if (!lockTargetId || !$session.user) return;
    if (!isLockedByMe) return;
    try {
      const res = await acquireLock('folder', lockTargetId);
      lock = res.lock;
    } catch {
      // ignore refresh errors
    }
  };

  const releaseCurrentLock = async () => {
    if (!lockTargetId || !isLockedByMe) return;
    try {
      await releaseLock('folder', lockTargetId);
    } catch {
      // ignore release errors
    }
  };

  const handleRequestUnlock = async () => {
    if (!lockTargetId) return;
    try {
      const res = await requestUnlock('folder', lockTargetId);
      lock = res.lock;
      addToast({ type: 'success', message: get(_)('matrix.unlockRequestSent') });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? get(_)('matrix.unlockRequestError') });
    }
  };

  const handleForceUnlock = async () => {
    if (!lockTargetId) return;
    try {
      await forceUnlock('folder', lockTargetId);
      addToast({ type: 'success', message: get(_)('matrix.lockForced') });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? get(_)('matrix.lockForceError') });
    }
  };

  const handleReleaseLock = async () => {
    if (!lockTargetId) return;
    if (lock?.unlockRequestedByUserId) {
      suppressAutoLock = true;
      await acceptUnlock('folder', lockTargetId);
      return;
    }
    suppressAutoLock = true;
    await releaseCurrentLock();
  };

  const hydratePresence = async () => {
    if (!lockTargetId) return;
    try {
      const res = await fetchPresence('folder', lockTargetId);
      presenceTotal = res.total;
      presenceUsers = res.users.filter((u) => u.userId !== $session.user?.id);
    } catch {
      // ignore
    }
  };

  const updatePresence = async () => {
    if (!lockTargetId) return;
    try {
      const res = await sendPresence('folder', lockTargetId);
      presenceTotal = res.total;
      presenceUsers = res.users.filter((u) => u.userId !== $session.user?.id);
    } catch {
      // ignore
    }
  };

  const handleVisibility = () => {
    if (!lockTargetId) return;
    if (document.hidden) {
      void leavePresence('folder', lockTargetId);
    } else {
      void updatePresence();
    }
  };

  const handleLeave = () => {
    if (!lockTargetId) return;
    void leavePresence('folder', lockTargetId);
  };


  $: if ($currentFolderId && $currentFolderId !== lockTargetId) {
    if (lockTargetId) {
      void leavePresence('folder', lockTargetId);
      void releaseCurrentLock();
    }
    lock = null;
    presenceUsers = [];
    presenceTotal = 0;
    lockTargetId = $currentFolderId;
    subscribeLock($currentFolderId);
    void syncLock();
    void hydratePresence();
    void updatePresence();
  }

  $: if ($workspaceReadOnlyScope !== lastReadOnlyRole) {
    lastReadOnlyRole = $workspaceReadOnlyScope;
    if (lastReadOnlyRole) {
      void releaseCurrentLock();
      void syncLock();
    } else {
      void syncLock();
    }
  }

 const loadMatrix = async () => {
    if (!$currentFolderId) {
      addToast({
        type: 'info',
        message: get(_)('matrix.pleaseSelectFolder')
      });
      return;
    }

    isLoading = true;
    try {
      const folder = await apiGet(`/folders/${$currentFolderId}`);
      currentFolderName = folder.name || '';

      const rawMatrix = folder.matrixConfig ?? folder.matrix_config;
      const matrix = parseOptionalObject(rawMatrix);
      if (matrix && typeof matrix === 'object') {
        applyMatrixSnapshotFromFolder(folder, 'load');
        addToast({
          type: 'success',
          message: get(_)('matrix.folderLoaded', { values: { name: folder.name } })
        });
      } else {
        addToast({
          type: 'warning',
          message: get(_)('matrix.folderNoMatrix', { values: { name: folder.name } })
        });
      }
    } catch (error) {
      console.error('Failed to load matrix:', error);
      addToast({
        type: 'error',
        message: get(_)('matrix.loadError')
      });
    } finally {
      isLoading = false;
    }
  };

  /**
   * Determine the level (1-5) for a score by comparing against thresholds.
   * The level is the highest level such that score >= threshold.points.
   */
  const getLevelFromScore = (score: number, thresholds: Array<{ level: number; points: number }>): number => {
    // Sort thresholds by descending level to find the highest matching level.
    const sortedThresholds = [...thresholds].sort((a, b) => b.level - a.level);
    for (const threshold of sortedThresholds) {
      if (score >= threshold.points) {
        return threshold.level;
      }
    }
    return 1; // Default to level 1 if no threshold matches.
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
    
    // Programmer la sauvegarde (auto-save)
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
    
    // Programmer la sauvegarde (auto-save)
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
        
        // Programmer la sauvegarde (auto-save)
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
        
        // Programmer la sauvegarde (auto-save)
        scheduleMatrixSave();
        
        // Recalculer les comptages immédiatement
        updateCaseCounts();
      }
    }
  };

  /**
   * Programme la sauvegarde de la matrice après une courte inactivité
   * Utilisé pour les seuils, poids d'axes, et autres modifications
   */
  const scheduleMatrixSave = () => {
    // Annuler le timeout précédent s'il existe
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    // Programmer la sauvegarde avec un debounce court
    saveTimeout = setTimeout(async () => {
      await saveMatrix();
    }, MATRIX_SAVE_DELAY_MS);
  };

  /**
   * Sauvegarde automatique de la matrice modifiée
   * Cette fonction est appelée soit :
   * - Automatiquement après un court délai d'inactivité (via scheduleMatrixSave)
   * - Par NavigationGuard lors de la navigation (via unsavedChangesStore.saveAll)
   */
  const saveMatrix = async () => {
    if (isReadOnly) return;
    if (!$currentFolderId || isSavingMatrix) return;
    
    isSavingMatrix = true;
    try {
      await apiPut(`/folders/${$currentFolderId}/matrix`, editedConfig);
      matrixStore.set(editedConfig);
      originalConfig = { ...editedConfig };
      lastAppliedMatrixSnapshot = stringifyMatrixConfig(originalConfig);
      
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
        message: get(_)('matrix.autoSaveError')
      });
    } finally {
      isSavingMatrix = false;
    }
  };

  const saveChanges = async () => {
    if (isReadOnly) {
      addToast({ type: 'warning', message: get(_)('matrix.readOnlyTooltip') });
      return;
    }
    if (!$currentFolderId) return;
    
    try {
      await apiPut(`/folders/${$currentFolderId}/matrix`, editedConfig);
      matrixStore.set(editedConfig);
      originalConfig = { ...editedConfig };
      lastAppliedMatrixSnapshot = stringifyMatrixConfig(originalConfig);
      // Mettre à jour les comptages après sauvegarde
      await updateCaseCounts();
      addToast({
        type: 'success',
        message: get(_)('matrix.saveSuccess')
      });
    } catch (error) {
      console.error('Failed to save matrix:', error);
      addToast({
        type: 'error',
        message: get(_)('matrix.saveError')
      });
    }
  };

  /**
   * Ajoute un nouvel axe de valeur ou de complexité
   */
  const addAxis = (isValue: boolean) => {
    const newAxis: MatrixAxis = {
      id: `axis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: isValue ? get(_)('matrix.newValueAxisName') : get(_)('matrix.newComplexityAxisName'),
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
    
    // Programmer la sauvegarde
    scheduleMatrixSave();
    // Note: updateCaseCounts() n'est pas appelé ici car l'ajout d'axe ne change pas les comptages
    // Les comptages seront mis à jour après sauvegarde ou lors de la modification des seuils
    
    addToast({
      type: 'success',
      message: isValue ? get(_)('matrix.valueAxisAdded') : get(_)('matrix.complexityAxisAdded')
    });
  };

  /**
   * Supprime un axe de valeur ou de complexité
   */
  const removeAxis = (isValue: boolean, index: number) => {
    if (!confirm(get(_)('matrix.confirmDeleteAxis'))) {
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
    
    // Programmer la sauvegarde
    scheduleMatrixSave();
    // Note: updateCaseCounts() n'est pas appelé ici car la suppression d'axe ne change pas les comptages
    // Les comptages seront mis à jour après sauvegarde ou lors de la modification des seuils
    
    addToast({
      type: 'success',
      message: isValue ? get(_)('matrix.valueAxisDeleted') : get(_)('matrix.complexityAxisDeleted')
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

  const closeDescriptionsDialog = () => {
    selectedAxisId = null;
    showDescriptionsDialog = false;
  };

  const openAxisDescriptions = (axis: MatrixAxis, isValue: boolean) => {
    selectedAxisId = axis.id;
    isValueAxis = isValue;
    showDescriptionsDialog = true;
  };

  const handleCloseDescriptionsDialog = () => {
    // Vérifier s'il y a des modifications non sauvegardées via le store
    if ($unsavedChangesStore.changes.length > 0) {
      showCloseWarning = true;
    } else {
      closeDescriptionsDialog();
    }
  };

  const handleCloseWarningCancel = () => {
    showCloseWarning = false;
  };

  const handleCloseWarningDiscard = () => {
    unsavedChangesStore.reset();
    showCloseWarning = false;
    closeDescriptionsDialog();
  };

  const handleCloseWarningSave = async () => {
    if (isReadOnly) {
      addToast({ type: 'warning', message: get(_)('matrix.readOnlyTooltip') });
      showCloseWarning = false;
      closeDescriptionsDialog();
      return;
    }
    try {
      await unsavedChangesStore.saveAll();
      showCloseWarning = false;
      closeDescriptionsDialog();
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      addToast({
        type: 'error',
        message: get(_)('matrix.saveErrorGeneric')
      });
    }
  };

  // Ces fonctions ne sont plus nécessaires car on utilise directement le template Svelte

  const getLevelDescription = (axis: MatrixAxis | null, level: number): string => {
    if (!axis?.levelDescriptions) return get(_)('matrix.levelN', { values: { level } });
    
    const levelDesc = axis.levelDescriptions.find((ld) => ld.level === level);
    return levelDesc?.description || get(_)('matrix.levelN', { values: { level } });
  };

  const getSelectedLevelDescription = (level: number): string => {
    return getLevelDescription(selectedAxis, level);
  };

  const getSelectedLevelOriginalDescription = (level: number): string => {
    const originalAxis = findAxisById(originalConfig as MatrixConfig, selectedAxisId, isValueAxis);
    return getLevelDescription(originalAxis, level);
  };

  const updateLevelDescription = (levelNum: number, description: string) => {
    if (!selectedAxisId) return;
    
    if (isValueAxis) {
      const axisIndex = editedConfig.valueAxes.findIndex((a: MatrixAxis) => a.id === selectedAxisId);
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
      const axisIndex = editedConfig.complexityAxes.findIndex((a: MatrixAxis) => a.id === selectedAxisId);
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
      const data = await apiGet<{ items: Folder[] }>(`/folders/list/with-matrices`);
      availableFolders = data.items.filter((folder) => folder.hasMatrix && folder.id !== $currentFolderId);
    } catch (error) {
      console.error('Failed to load folders:', error);
    }
  };

  const createNewMatrix = async () => {
    if (isReadOnly) {
      addToast({ type: 'warning', message: $_('common.readOnlyEditDisabled') });
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
          message: $_('matrix.toasts.created')
        });
      }
    } catch (error) {
      console.error('Failed to create matrix:', error);
      addToast({
        type: 'error',
        message: $_('matrix.errors.create')
      });
    }
  };

  const openCreateMatrixDialog = async () => {
    await loadAvailableFolders();
    showCreateMatrixDialog = true;
  };
</script>

<div class="container mx-auto px-4 py-8">
<div class="mb-6 flex items-start justify-between gap-4">
  <h1 class="text-3xl font-bold text-navy">{$_('matrix.title')}</h1>
  <div class="flex items-center gap-2 flex-wrap justify-end">
    {#if $currentFolderId}
      <FileMenu
        showNew={false}
        showImport={false}
        showExport={true}
        showPrint={false}
        showDelete={false}
        disabledExport={isReadOnly}
        onExport={() => (showExportDialog = true)}
        triggerTitle={$_('common.actions')}
        triggerAriaLabel={$_('common.actions')}
      />
    {/if}
    <LockPresenceBadge
      {lock}
      {lockLoading}
      {lockError}
      {lockOwnerLabel}
      {lockRequestedByMe}
      isAdmin={isWorkspaceAdmin}
      {isLockedByMe}
      {isLockedByOther}
      avatars={presenceUsers.map((u) => ({ userId: u.userId, label: u.displayName || u.email || u.userId }))}
      connectedCount={presenceTotal}
      canRequestUnlock={!$workspaceReadOnlyScope}
      showHeaderLock={!isLockedByMe}
      on:requestUnlock={handleRequestUnlock}
      on:forceUnlock={handleForceUnlock}
      on:releaseLock={handleReleaseLock}
    />
	    {#if showReadOnlyLock && !showPresenceBadge}
	      <button
	        class="rounded p-2 transition text-slate-400 cursor-not-allowed"
	        title={$_('matrix.readOnlyTooltip')}
	        aria-label={$_('matrix.readOnlyTooltip')}
	        type="button"
	        disabled
	      >
        <Lock class="w-5 h-5" />
      </button>
  {/if}
  </div>
</div>
  
	  {#if $currentFolderId}
	    <p class="text-gray-600 -mt-4 mb-6">
	      {$_('matrix.selectedFolder')}
	    </p>
	  {/if}
  
  <div class="bg-blue-50 border-l-4 border-blue-500 p-4 mb-8">
    <div class="flex">
      <Info class="h-6 w-6 text-blue-500 mr-2" />
      <div>
	        <p class="mb-2">
	          {$_('matrix.help.intro')}
	        </p>
	        <p class="text-sm">
	          {$_('matrix.help.details')}
	        </p>
      </div>
    </div>
  </div>
  
  {#if isLoading}
    <div class="text-center py-8">
      <p class="text-gray-600">{$_('matrix.loading')}</p>
    </div>
  {:else if !$matrixStore.valueAxes || $matrixStore.valueAxes.length === 0}
    <div class="text-center py-8">
      <p class="text-gray-600 mb-4">{$_('matrix.empty')}</p>
	      <button 
	        on:click={openCreateMatrixDialog}
	        class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg"
	      >
	        {$_('matrix.createNew')}
	      </button>
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
      <!-- Value Axes Configuration -->
      <div class="bg-white rounded-lg shadow-md">
        <div class="bg-gradient-to-r from-purple-700 to-purple-900 p-4 rounded-t-lg flex items-center justify-between">
          <h2 class="text-white text-lg font-semibold flex items-center">
            <span class="mr-2">{$_('matrix.valueAxes')}</span>
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
	            title={$_('matrix.addValueAxis')}
	          >
	            <Plus class="w-4 h-4 mr-1" />
	            {$_('common.add')}
	          </button>
        </div>
        <div class="p-0">
          <table class="w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/2">{$_('matrix.criterion')}</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/4">{$_('matrix.weight')}</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/4">{$_('matrix.action')}</th>
              </tr>
            </thead>
            <tbody>
              {#each editedConfig.valueAxes as axis, index}
                <tr class="border-t">
                  <td class="px-4 py-3">
                    <div class="text-sm w-full">
                      <EditableInput
                        locked={isReadOnly}
                        value={axis.name}
                        originalValue={originalConfig.valueAxes[index]?.name || ""}
                        changeId={`value-axis-${index}-name`}
                        apiEndpoint={`${API_BASE_URL}/folders/${$currentFolderId}/matrix`}
                        fullData={editedConfig}
                        fullDataGetter={() =>
                          buildMatrixPayload((draft: MatrixConfig) => {
                            if (!draft.valueAxes?.[index]) return;
                            draft.valueAxes[index] = {
                              ...draft.valueAxes[index],
                              name: axis.name
                            };
                          })
                        }
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
                      title={$_('matrix.viewLevels')}
                      aria-label={`${$_('matrix.viewLevels')}: ${axis.name}`}
                    >
                      <Eye class="w-4 h-4" />
        </button>
                      <button
                        class="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        on:click={() => removeAxis(true, index)}
                        title={$_('matrix.deleteAxis')}
                        aria-label={`${$_('matrix.deleteAxis')}: ${axis.name}`}
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
            <span class="mr-2">{$_('matrix.complexityAxes')}</span>
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
	            title={$_('matrix.addComplexityAxis')}
	          >
	            <Plus class="w-4 h-4 mr-1" />
	            {$_('common.add')}
	          </button>
        </div>
        <div class="p-0">
          <table class="w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/2">{$_('matrix.criterion')}</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/4">{$_('matrix.weight')}</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/4">{$_('matrix.action')}</th>
              </tr>
            </thead>
            <tbody>
              {#each editedConfig.complexityAxes as axis, index}
                <tr class="border-t">
                  <td class="px-4 py-3">
                    <div class="text-sm w-full">
                      <EditableInput
                        locked={isReadOnly}
                        value={axis.name}
                        originalValue={originalConfig.complexityAxes[index]?.name || ""}
                        changeId={`complexity-axis-${index}-name`}
                        apiEndpoint={`${API_BASE_URL}/folders/${$currentFolderId}/matrix`}
                        fullData={editedConfig}
                        fullDataGetter={() =>
                          buildMatrixPayload((draft: MatrixConfig) => {
                            if (!draft.complexityAxes?.[index]) return;
                            draft.complexityAxes[index] = {
                              ...draft.complexityAxes[index],
                              name: axis.name
                            };
                          })
                        }
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
                        title={$_('matrix.viewLevels')}
                        aria-label={`${$_('matrix.viewLevels')}: ${axis.name}`}
                      >
                        <Eye class="w-4 h-4" />
                      </button>
                      <button
                        class="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        on:click={() => removeAxis(false, index)}
                        title={$_('matrix.deleteAxis')}
                        aria-label={`${$_('matrix.deleteAxis')}: ${axis.name}`}
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
          <h2 class="text-white text-lg font-semibold">{$_('matrix.valueThresholdsTitle')}</h2>
        </div>
        <div class="p-0">
          <table class="w-full">
            <thead class="bg-purple-50">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/3">{$_('matrix.value')}</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/3">{$_('matrix.fibonacciPoints')}</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/3">{$_('matrix.useCaseCount')}</th>
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
          <h2 class="text-white text-lg font-semibold">{$_('matrix.complexityThresholdsTitle')}</h2>
        </div>
        <div class="p-0">
          <table class="w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/5">{$_('matrix.complexity')}</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/5">{$_('matrix.fibonacciPoints')}</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-900 w-1/5">{$_('matrix.useCaseCount')}</th>
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
          {$_('matrix.weightsRecalcWarning')}
        </p>
      </div>
    </div>
    
    <div class="flex justify-between">
      <button 
        on:click={openCreateMatrixDialog}
        class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center"
      >
        <Plus class="mr-2 h-4 w-4" />
        {$_('matrix.createNew')}
      </button>
      <button 
        on:click={saveChanges}
        class="bg-navy hover:bg-navy/90 text-white px-4 py-2 rounded flex items-center"
      >
        <Upload class="mr-2 h-4 w-4" />
        {$_('common.save')}
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
          {selectedAxis?.name} - {$_('matrix.levelDescriptionsTitle')}
        </h3>
        <p class="text-gray-600 mb-4">
          {$_('matrix.help.details')}
        </p>
        
        <table class="w-full">
          <thead>
            <tr class="border-b">
              <th class="text-left py-2">{$_('matrix.level')}</th>
              <th class="text-left py-2">{$_('matrix.description')}</th>
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
                    locked={isReadOnly}
                    value={getSelectedLevelDescription(levelNum)}
                    originalValue={getSelectedLevelOriginalDescription(levelNum)}
                    changeId={`${isValueAxis ? 'value' : 'complexity'}-axis-${selectedAxis?.id ?? selectedAxisId ?? 'unknown'}-level-${levelNum}`}
                    apiEndpoint={`${API_BASE_URL}/folders/${$currentFolderId}/matrix`}
                    fullData={editedConfig}
                    fullDataGetter={() => buildMatrixPayload()}
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
            {$_('common.close')}
        </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<ImportExportDialog
  bind:open={showExportDialog}
  mode="export"
  title={$_('matrix.export')}
  scope="matrix"
  scopeId={$currentFolderId || ''}
  allowScopeSelect={false}
  allowScopeIdEdit={false}
  workspaceName={workspaceName}
  objectName={currentFolderName || $_('matrix.details.title')}
  commentsAvailable={false}
  documentsAvailable={false}
/>

<!-- Dialog for creating a new matrix -->
{#if showCreateMatrixDialog}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg max-w-md w-full mx-4">
      <div class="p-6">
        <h3 class="text-lg font-semibold mb-4">
          {$_('matrix.createNew')}
        </h3>
        <p class="text-gray-600 mb-6">
          {$_('matrix.createDialogBody')}
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
              <div class="font-medium">{$_('matrix.baseEvaluation')}</div>
              <div class="text-sm text-gray-600">{$_('matrix.baseEvaluationDesc')}</div>
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
              <div class="font-medium">{$_('matrix.copyExisting')}</div>
              <div class="text-sm text-gray-600 mb-2">{$_('matrix.copyExistingDesc')}</div>
              {#if createMatrixType === 'copy'}
                <select 
                  bind:value={selectedFolderToCopy}
                  class="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="">{$_('matrix.selectFolder')}</option>
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
              <div class="font-medium">{$_('matrix.blankEvaluation')}</div>
              <div class="text-sm text-gray-600">{$_('matrix.blankEvaluationDesc')}</div>
            </div>
          </label>
        </div>
        
        <div class="flex justify-end gap-3 mt-6">
          <button 
            on:click={() => showCreateMatrixDialog = false}
            class="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            {$_('common.cancel')}
          </button>
          <button 
            on:click={createNewMatrix}
            disabled={createMatrixType === 'copy' && !selectedFolderToCopy}
            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {$_('common.create')}
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
          {$_('unsavedChanges.dialog.title')}
        </h3>
      </div>
      
      <p class="text-gray-600 mb-6">
        {$_('unsavedChanges.dialog.body')}
      </p>
      
      <div class="flex justify-end gap-3">
        <button 
          on:click={handleCloseWarningCancel}
          class="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
        >
          {$_('unsavedChanges.actions.cancel')}
        </button>
        <button 
          on:click={handleCloseWarningDiscard}
          class="px-4 py-2 text-red-600 hover:text-red-800 border border-red-300 rounded"
        >
          {$_('unsavedChanges.actions.discardAndClose')}
        </button>
        <button 
          on:click={handleCloseWarningSave}
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {$_('unsavedChanges.actions.saveAndClose')}
        </button>
      </div>
    </div>
  </div>
{/if}
