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
  import FileMenu from '$lib/components/FileMenu.svelte';
  import ImportExportDialog from '$lib/components/ImportExportDialog.svelte';
  import { workspaceReadOnlyScope, workspaceScopeHydrated, selectedWorkspaceRole, workspaceScope } from '$lib/stores/workspaceScope';
  import { session } from '$lib/stores/session';
  import { acceptUnlock, acquireLock, fetchLock, forceUnlock, releaseLock, requestUnlock, sendPresence, fetchPresence, leavePresence, type LockSnapshot, type PresenceUser } from '$lib/utils/object-lock';
  import { listComments } from '$lib/utils/comments';
  import { Lock } from '@lucide/svelte';
  import DocumentsBlock from '$lib/components/DocumentsBlock.svelte';

  let useCase: any = undefined;
  let error = '';
  let matrix: MatrixConfig | null = null;
  let calculatedScores: any = null;
  let organizationId: string | null = null;
  let organizationName: string | null = null;
  let hubKey: string | null = null;
  let lastUseCaseIdForCounts: string | null = null;
  let hasMounted = false;
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
  let showExportDialog = false;
  let commentCounts: Record<string, number> = {};
  let hasDocuments = false;
  let workspaceId: string | null = null;
  let commentUserId: string | null = null;
  let lastCommentCountsKey = '';
  let commentCountsLoading = false;
  let commentCountsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let commentCountsRetryAttempts = 0;
  let commentReloadTimer: ReturnType<typeof setTimeout> | null = null;
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
  $: workspaceId = $workspaceScope.selectedId ?? null;
  $: commentUserId = $session.user?.id ?? null;
  $: workspaceName =
    ($workspaceScope.items || []).find((w) => w.id === $workspaceScope.selectedId)?.name ?? '';
  $: commentsTotal = Object.values(commentCounts).reduce((sum, v) => sum + v, 0);

  onMount(() => {
    loadUseCase();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('beforeunload', handleLeave);
    if (useCaseId) {
      setupUseCaseHub(useCaseId);
      lastUseCaseIdForCounts = useCaseId;
    }
    hasMounted = true;
    
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

  const handleUseCaseHubEvent = (evt: any, currentId: string) => {
    if (evt?.type === 'usecase_update') {
      const id: string = evt.useCaseId;
      const data: any = evt.data ?? {};
      if (!id || id !== currentId) return;
      if (data?.deleted) return;
      if (data?.useCase) {
        useCase = { ...(useCase || {}), ...data.useCase };
        useCasesStore.update(items => items.map(uc => uc.id === currentId ? useCase : uc));
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
      return;
    }
    if (evt?.type === 'comment_update') {
      if (evt.contextType !== 'usecase' || evt.contextId !== currentId) return;
      scheduleCommentReload();
    }
  };

  const setupUseCaseHub = (currentId: string) => {
    if (hubKey) streamHub.delete(hubKey);
    hubKey = `useCaseDetail:${currentId}`;
    streamHub.set(hubKey, (evt: any) => handleUseCaseHubEvent(evt, currentId));
  };

  onDestroy(() => {
    if (commentCountsRetryTimer) clearTimeout(commentCountsRetryTimer);
    if (hubKey) streamHub.delete(hubKey);
    if (lockHubKey) streamHub.delete(lockHubKey);
    if (lockRefreshTimer) clearInterval(lockRefreshTimer);
    if (lockTargetId) void leavePresence('usecase', lockTargetId);
    void releaseCurrentLock();
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handleLeave);
    window.removeEventListener('beforeunload', handleLeave);
  });

  $: if (hasMounted && useCaseId && useCaseId !== lastUseCaseIdForCounts) {
    lastUseCaseIdForCounts = useCaseId;
    void loadUseCase();
    setupUseCaseHub(useCaseId);
  }

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

  $: if (lock && isLockedByMe) {
    scheduleLockRefresh();
  }

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
        await loadCommentCounts();
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
      await loadCommentCounts();
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

  const canLoadCommentCounts = () =>
    Boolean(useCaseId && workspaceId && commentUserId && !$session.loading);

  const scheduleCommentCountsRetry = () => {
    if (commentCountsRetryTimer) return;
    commentCountsRetryTimer = setTimeout(() => {
      commentCountsRetryTimer = null;
      if (canLoadCommentCounts() && commentCountsRetryAttempts < 3) {
        void loadCommentCounts();
      }
    }, 600);
  };

  const loadCommentCounts = async () => {
    if (!canLoadCommentCounts()) return;
    if (commentCountsLoading) return;
    commentCountsLoading = true;
    try {
      const res = await listComments({ contextType: 'usecase', contextId: useCaseId });
      const counts: Record<string, number> = {};
      const threads = new Map<string, { status: string; count: number; sectionKey: string | null }>();
      for (const item of res.items || []) {
        const threadId = item.thread_id;
        if (!threadId) continue;
        const existing = threads.get(threadId);
        if (!existing) {
          threads.set(threadId, {
            status: item.status,
            count: 1,
            sectionKey: item.section_key || null,
          });
        } else {
          threads.set(threadId, { ...existing, count: existing.count + 1 });
        }
      }
      for (const thread of threads.values()) {
        if (thread.status === 'closed') continue;
        const key = thread.sectionKey || 'root';
        counts[key] = (counts[key] || 0) + thread.count;
      }
      commentCounts = counts;
      commentCountsRetryAttempts = 0;
    } catch {
      // ignore; badges are optional
      commentCountsRetryAttempts += 1;
      scheduleCommentCountsRetry();
    } finally {
      commentCountsLoading = false;
    }
  };

  $: if (useCaseId && workspaceId && commentUserId && !$session.loading) {
    const key = `${useCaseId}:${workspaceId}:${commentUserId}`;
    if (key !== lastCommentCountsKey) {
      lastCommentCountsKey = key;
      void loadCommentCounts();
    }
  }

  const scheduleCommentReload = () => {
    if (commentReloadTimer) return;
    commentReloadTimer = setTimeout(() => {
      commentReloadTimer = null;
      void loadCommentCounts();
    }, 150);
  };

  const openCommentsFor = (sectionKey: string) => {
    const detail = { contextType: 'usecase', contextId: useCaseId, sectionKey };
    window.dispatchEvent(new CustomEvent('topai:open-comments', { detail }));
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
      locked={isLockedByOther || isReadOnly}
      {commentCounts}
      onOpenComments={openCommentsFor}
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
            <FileMenu
              showNew={false}
              showImport={false}
              showExport={true}
              showPrint={true}
              showDelete={!isReadOnly}
              disabledImport={isReadOnly}
              disabledExport={isReadOnly}
              onExport={() => (showExportDialog = true)}
              onPrint={() => window.print()}
              onDelete={handleDelete}
              triggerTitle="Actions"
              triggerAriaLabel="Actions"
            />
            {#if isReadOnly && showReadOnlyLock && !showPresenceBadge}
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

    <DocumentsBlock
      contextType="usecase"
      contextId={useCase.id}
      on:state={(event) => {
        hasDocuments = (event.detail?.items || []).length > 0;
      }}
    />
  {/if}
</section>

{#if useCase}
  <!-- Commentaires gérés par ChatWidget -->
{/if}

{#if useCase}
  <ImportExportDialog
    bind:open={showExportDialog}
    mode="export"
    title="Exporter le cas d'usage"
    scope="usecase"
    scopeId={useCase.id}
    allowScopeSelect={false}
    allowScopeIdEdit={false}
    workspaceName={workspaceName}
    objectName={useCase?.data?.name || useCase?.name || ''}
    commentsAvailable={commentsTotal > 0}
    documentsAvailable={hasDocuments}
    includeOptions={[
      { id: 'folders', label: 'Inclure le dossier', defaultChecked: true },
      { id: 'matrix', label: 'Inclure la matrice du dossier', defaultChecked: true },
      ...(organizationId
        ? [{ id: 'organization', label: "Inclure l'organisation", defaultChecked: true }]
        : []),
    ]}
    includeDependencies={{ matrix: ['folders'] }}
    includeAffectsComments={['folders', 'matrix', 'organization']}
    includeAffectsDocuments={['folders', 'matrix', 'organization']}
  />
{/if}
