<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { useCasesStore } from '$lib/stores/useCases';
  import { deleteUseCase } from '$lib/stores/useCases';
  import { addToast } from '$lib/stores/toast';
  import { apiGet } from '$lib/utils/api';
  import { goto } from '$app/navigation';
  import UseCaseDetail from '$lib/components/UseCaseDetail.svelte';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { streamHub } from '$lib/stores/streamHub';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import LockPresenceBadge from '$lib/components/LockPresenceBadge.svelte';
  import { workspaceReadOnlyScope, workspaceScopeHydrated, selectedWorkspaceRole } from '$lib/stores/workspaceScope';
  import { session } from '$lib/stores/session';
  import { acceptUnlock, acquireLock, fetchLock, forceUnlock, releaseLock, requestUnlock, sendPresence, fetchPresence, leavePresence, type LockSnapshot, type PresenceUser } from '$lib/utils/object-lock';
  import { Printer, Trash2, Lock } from '@lucide/svelte';
  import DocumentsBlock from '$lib/components/DocumentsBlock.svelte';

  let useCase: any = undefined;
  let error = '';
  let matrix: MatrixConfig | null = null;
  let calculatedScores: any = null;
  let organizationId: string | null = null;
  let organizationName: string | null = null;
  let hubKey: string | null = null;
  let isReadOnly = false;
  let lockHubKey: string | null = null;
  let lockRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let lockTargetId: string | null = null;
  let lock: LockSnapshot | null = null;
  let lockLoading = false;
  let lockError: string | null = null;
  let suppressAutoLock = false;
  let presenceUsers: PresenceUser[] = [];
  let presenceTotal = 0;
  $: showReadOnlyLock = $workspaceScopeHydrated && $workspaceReadOnlyScope;
  $: isWorkspaceAdmin = $selectedWorkspaceRole === 'admin';
  $: isLockedByMe = !!lock && lock.lockedBy.userId === $session.user?.id;
  $: isLockedByOther = !!lock && lock.lockedBy.userId !== $session.user?.id;
  $: lockOwnerLabel = lock?.lockedBy?.displayName || lock?.lockedBy?.email || 'Utilisateur';
  $: lockRequestedByMe = !!lock && lock.unlockRequestedByUserId === $session.user?.id;
  $: showPresenceBadge = lockLoading || lockError || !!lock || presenceUsers.length > 0 || presenceTotal > 0;
  $: isReadOnly = $workspaceReadOnlyScope || isLockedByOther;
  let lastReadOnlyRole = isReadOnly;
  const LOCK_REFRESH_MS = 10 * 1000;

  $: useCaseId = $page.params.id;

  onMount(() => {
    loadUseCase();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('beforeunload', handleLeave);
    // SSE: usecase_update (+ folder_update pour la matrice)
    if (hubKey) streamHub.delete(hubKey);
    hubKey = `useCaseDetail:${useCaseId}`;
    streamHub.set(hubKey, (evt: any) => {
      if (evt?.type === 'usecase_update') {
        const id: string = evt.useCaseId;
        const data: any = evt.data ?? {};
        if (!id || id !== useCaseId) return;
        if (data?.deleted) return;
        if (data?.useCase) {
          useCase = { ...(useCase || {}), ...data.useCase };
          useCasesStore.update(items => items.map(uc => uc.id === useCaseId ? useCase : uc));
          void loadMatrixAndCalculateScores();
        }
        return;
      }
      if (evt?.type === 'folder_update') {
        const folderId: string = evt.folderId;
        const data: any = evt.data ?? {};
        if (!useCase?.folderId || folderId !== useCase.folderId) return;
        if (data?.folder?.matrixConfig) {
          matrix = data.folder.matrixConfig;
        }
        if (data?.folder) {
          organizationId = data.folder.organizationId ?? organizationId;
          organizationName = data.folder.organizationName ?? organizationName;
        }
        void loadMatrixAndCalculateScores();
      }
    });
    
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
    if (hubKey) streamHub.delete(hubKey);
    if (lockHubKey) streamHub.delete(lockHubKey);
    if (lockRefreshTimer) clearInterval(lockRefreshTimer);
    if (lockTargetId) void leavePresence('usecase', lockTargetId);
    void releaseCurrentLock();
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handleLeave);
    window.removeEventListener('beforeunload', handleLeave);
  });

  const subscribeLock = (targetId: string) => {
    if (lockHubKey) streamHub.delete(lockHubKey);
    lockHubKey = `lock:usecase:${targetId}`;
    streamHub.set(lockHubKey, (evt: any) => {
      if (evt?.type === 'lock_update') {
        if (evt.objectType !== 'usecase') return;
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
        if (evt.objectType !== 'usecase') return;
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
        lock = await fetchLock('usecase', lockTargetId);
      } else {
        const res = await acquireLock('usecase', lockTargetId);
        lock = res.lock;
      }
      scheduleLockRefresh();
    } catch (e: any) {
      lockError = e?.message ?? 'Erreur de verrouillage';
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

  const refreshLock = async () => {
    if (!lockTargetId || !$session.user) return;
    if (!isLockedByMe) return;
    try {
      const res = await acquireLock('usecase', lockTargetId);
      lock = res.lock;
    } catch {
      // ignore refresh errors
    }
  };

  const releaseCurrentLock = async () => {
    if (!lockTargetId || !isLockedByMe) return;
    try {
      await releaseLock('usecase', lockTargetId);
    } catch {
      // ignore release errors
    }
  };

  const handleRequestUnlock = async () => {
    if (!lockTargetId) return;
    try {
      const res = await requestUnlock('usecase', lockTargetId);
      lock = res.lock;
      addToast({ type: 'success', message: 'Demande de déverrouillage envoyée' });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur demande de déverrouillage' });
    }
  };

  const handleForceUnlock = async () => {
    if (!lockTargetId) return;
    try {
      await forceUnlock('usecase', lockTargetId);
      addToast({ type: 'success', message: 'Verrou forcé' });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur forçage verrou' });
    }
  };

  const handleReleaseLock = async () => {
    if (!lockTargetId) return;
    if (lock?.unlockRequestedByUserId) {
      suppressAutoLock = true;
      await acceptUnlock('usecase', lockTargetId);
      return;
    }
    suppressAutoLock = true;
    await releaseCurrentLock();
  };

  const hydratePresence = async () => {
    if (!lockTargetId) return;
    try {
      const res = await fetchPresence('usecase', lockTargetId);
      presenceTotal = res.total;
      presenceUsers = res.users.filter((u) => u.userId !== $session.user?.id);
    } catch {
      // ignore
    }
  };

  const updatePresence = async () => {
    if (!lockTargetId) return;
    try {
      const res = await sendPresence('usecase', lockTargetId);
      presenceTotal = res.total;
      presenceUsers = res.users.filter((u) => u.userId !== $session.user?.id);
    } catch {
      // ignore
    }
  };

  const handleVisibility = () => {
    if (!lockTargetId) return;
    if (document.hidden) {
      void leavePresence('usecase', lockTargetId);
    } else {
      void updatePresence();
    }
  };

  const handleLeave = () => {
    if (!lockTargetId) return;
    void leavePresence('usecase', lockTargetId);
  };


  $: if (useCaseId && useCaseId !== lockTargetId) {
    if (lockTargetId) {
      void leavePresence('usecase', lockTargetId);
      void releaseCurrentLock();
    }
    lock = null;
    presenceUsers = [];
    presenceTotal = 0;
    lockTargetId = useCaseId;
    subscribeLock(useCaseId);
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

  const loadUseCase = async () => {
    try {
      // Charger depuis l'API pour avoir les données les plus récentes
      useCase = await apiGet(`/use-cases/${useCaseId}`);
      
      // Mettre à jour le store avec les données fraîches
      useCasesStore.update(items => 
        items.map(uc => uc.id === useCaseId ? useCase : uc)
      );
      
      if (useCase) {
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
      
      await loadMatrixAndCalculateScores();
    }
  };

  // Polling désactivé: mise à jour via SSE (usecase_update)

  const handleDelete = async () => {
    if (!useCase) return;
    if (isReadOnly) {
      addToast({ type: 'error', message: 'Action non autorisée (mode lecture seule).' });
      return;
    }
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce cas d'usage ?")) return;

    try {
      await deleteUseCase(useCase.id);
      useCasesStore.update(items => items.filter(uc => uc.id !== useCase?.id));
      addToast({ type: 'success', message: 'Cas d\'usage supprimé avec succès !' });
      if (useCase.folderId) {
        goto(`/dossiers/${useCase.folderId}`);
      } else {
        goto('/dossiers');
      }
    } catch (err) {
      console.error('Failed to delete use case:', err);
      const anyErr = err as any;
      if (anyErr?.status === 403) {
        addToast({ type: 'error', message: 'Action non autorisée (mode lecture seule).' });
      } else {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur lors de la suppression' });
      }
    }
  };

  const loadMatrixAndCalculateScores = async () => {
    if (!useCase?.folderId) return;
    
    try {
      // Charger la matrice depuis le dossier
      const folderResp: any = await apiGet(`/folders/${useCase.folderId}`);
      matrix = folderResp?.matrixConfig ?? null;
      organizationId = folderResp?.organizationId ?? null;
      organizationName = folderResp?.organizationName ?? null;
      
      // Extraire les scores depuis data (avec fallback rétrocompatibilité)
      const valueScores = useCase?.data?.valueScores || useCase?.valueScores || [];
      const complexityScores = useCase?.data?.complexityScores || useCase?.complexityScores || [];
      
      if (matrix && valueScores.length > 0 && complexityScores.length > 0) {
        calculatedScores = calculateUseCaseScores(
          matrix,
          valueScores,
          complexityScores
        );
      } else if (useCase?.data?.totalValueScore !== undefined || useCase?.data?.totalComplexityScore !== undefined) {
        // Si les scores totaux sont déjà dans data, les utiliser directement
        calculatedScores = {
          finalValueScore: useCase?.data?.totalValueScore || useCase?.totalValueScore || 0,
          finalComplexityScore: useCase?.data?.totalComplexityScore || useCase?.totalComplexityScore || 0,
          valueStars: Math.round((useCase?.data?.totalValueScore || useCase?.totalValueScore || 0) / 20),
          complexityStars: Math.round((useCase?.data?.totalComplexityScore || useCase?.totalComplexityScore || 0) / 20)
        };
      }
    } catch (err) {
      console.error('Failed to load matrix:', err);
    }
  };

  // startAutoRefresh supprimé (SSE)
</script>

<section class="space-y-6">
  {#if error}
    <div class="rounded bg-red-50 border border-red-200 p-4 text-red-700 mb-6">
      {error}
    </div>
  {/if}

  {#if useCase}
  {#if useCase.status === 'generating' || useCase.status === 'detailing'}
    <StreamMessage streamId={`usecase_${useCase.id}`} status={useCase.status} maxHistory={10} />
  {/if}
    <UseCaseDetail
      {useCase}
      {matrix}
      {calculatedScores}
      {organizationId}
      {organizationName}
      isEditing={false}
      locked={isLockedByOther}
    >
      <svelte:fragment slot="actions-view">
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
            <button
              on:click={() => window.print()}
              class="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors flex items-center justify-center"
              title="Imprimer ou exporter en PDF"
            >
              <Printer class="w-5 h-5" />
            </button>
            {#if !isReadOnly}
            <button 
              on:click={handleDelete}
              class="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center justify-center"
              title="Supprimer le cas d'usage"
            >
              <Trash2 class="w-5 h-5" />
            </button>
            {:else if showReadOnlyLock && !showPresenceBadge}
              <button
                class="p-2 text-slate-400 cursor-not-allowed rounded-lg transition-colors flex items-center justify-center"
                title="Mode lecture seule : création / suppression désactivées."
                aria-label="Mode lecture seule : création / suppression désactivées."
                type="button"
                disabled
              >
                <Lock class="w-5 h-5" />
              </button>
            {/if}
      </svelte:fragment>
    </UseCaseDetail>

    <DocumentsBlock contextType="usecase" contextId={useCase.id} />
  {/if}
</section>
