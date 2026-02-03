<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // {@html} is only used with sanitized HTML produced by renderInlineMarkdown().
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  import { foldersStore, currentFolderId, type Folder } from '$lib/stores/folders';
  import { useCasesStore, fetchUseCases, deleteUseCase } from '$lib/stores/useCases';
  import { addToast } from '$lib/stores/toast';
  import { apiDelete, apiGet } from '$lib/utils/api';

  import { streamHub } from '$lib/stores/streamHub';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import { getScopedWorkspaceIdForUser, workspaceReadOnlyScope, workspaceScopeHydrated, selectedWorkspaceRole, workspaceScope } from '$lib/stores/workspaceScope';
  import { session } from '$lib/stores/session';
  import { acceptUnlock, acquireLock, fetchLock, forceUnlock, releaseLock, requestUnlock, sendPresence, fetchPresence, leavePresence, type LockSnapshot, type PresenceUser } from '$lib/utils/object-lock';

  import type { MatrixConfig } from '$lib/types/matrix';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import { renderInlineMarkdown } from '$lib/utils/markdown';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import DocumentsBlock from '$lib/components/DocumentsBlock.svelte';
  import LockPresenceBadge from '$lib/components/LockPresenceBadge.svelte';
  import CommentBadge from '$lib/components/CommentBadge.svelte';
  import FileMenu from '$lib/components/FileMenu.svelte';
  import ImportExportDialog from '$lib/components/ImportExportDialog.svelte';
  import { Trash2, Star, X, Minus, Loader2, Lock } from '@lucide/svelte';
  import { listComments } from '$lib/utils/comments';

  let isLoading = false;
  let matrix: MatrixConfig | null = null;
  let currentFolder: Folder | null = null;
  let editedFolderName = '';
  let editedContext = '';
  let lastFolderId: string | null = null;
  let lastFolderIdForCounts: string | null = null;
  let hasMounted = false;
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
  let showImportDialog = false;
  const HUB_KEY = 'folderDetailUseCases';
  let isReadOnly = false;
  let commentCounts: Record<string, number> = {};
  let hasDocuments = false;
  let workspaceId: string | null = null;
  let commentUserId: string | null = null;
  let lastCommentCountsKey = '';
  let commentCountsLoading = false;
  let commentCountsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let commentCountsRetryAttempts = 0;
  let commentReloadTimer: ReturnType<typeof setTimeout> | null = null;
  $: isWorkspaceAdmin = $selectedWorkspaceRole === 'admin';
  $: isLockedByMe = !!lock && lock.lockedBy.userId === $session.user?.id;
  $: isLockedByOther = !!lock && lock.lockedBy.userId !== $session.user?.id;
  $: lockOwnerLabel = lock?.lockedBy?.displayName || lock?.lockedBy?.email || 'Utilisateur';
  $: lockRequestedByMe = !!lock && lock.unlockRequestedByUserId === $session.user?.id;
  $: showPresenceBadge = lockLoading || lockError || !!lock || presenceUsers.length > 0 || presenceTotal > 0;
  $: isReadOnly = $workspaceReadOnlyScope;
  let lastReadOnlyRole = isReadOnly;
  $: showReadOnlyLock = $workspaceScopeHydrated && $workspaceReadOnlyScope;
  const LOCK_REFRESH_MS = 10 * 1000;

  $: folderId = $page.params.id;
  $: workspaceId = $workspaceScope.selectedId ?? null;
  $: commentUserId = $session.user?.id ?? null;
  $: workspaceName =
    ($workspaceScope.items || []).find((w) => w.id === $workspaceScope.selectedId)?.name ?? '';
  $: commentsTotal = Object.values(commentCounts).reduce((sum, v) => sum + v, 0);

  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  const loadUseCases = async () => {
    isLoading = true;
    try {
      const useCases = await fetchUseCases(folderId);
      useCasesStore.set(useCases);

      const folder: Folder = await apiGet(`/folders/${folderId}`);
      currentFolder = folder;
      matrix = folder.matrixConfig;

      if (folder.id !== lastFolderId) {
        lastFolderId = folder.id;
        editedFolderName = folder.name || '';
        editedContext = folder.description || '';
      }

      foldersStore.update((items) => items.map((f) => (f.id === folder.id ? { ...f, ...folder } : f)));
    } catch (error) {
      console.error('Failed to load folder/use cases:', error);
      addToast({ type: 'error', message: 'Erreur lors du chargement du dossier' });
      currentFolder = null;
    } finally {
      isLoading = false;
    }
  };

  const handleImportComplete = async (event: CustomEvent<{ folderId?: string }>) => {
    const folderId = event.detail?.folderId;
    if (folderId && folderId !== currentFolder?.id) {
      currentFolderId.set(folderId);
      await goto(`/dossiers/${folderId}`);
      return;
    }
    await loadUseCases();
    await loadCommentCounts();
  };

  const canLoadCommentCounts = () =>
    Boolean(folderId && workspaceId && commentUserId && !$session.loading);

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
      const res = await listComments({ contextType: 'folder', contextId: folderId });
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
      // ignore
      commentCountsRetryAttempts += 1;
      scheduleCommentCountsRetry();
    } finally {
      commentCountsLoading = false;
    }
  };

  $: if (folderId && workspaceId && commentUserId && !$session.loading) {
    const key = `${folderId}:${workspaceId}:${commentUserId}`;
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
    const detail = { contextType: 'folder', contextId: folderId, sectionKey };
    window.dispatchEvent(new CustomEvent('topai:open-comments', { detail }));
  };

  const handleFolderNameSaved = async () => {
    try {
      const folder: Folder = await apiGet(`/folders/${folderId}`);
      currentFolder = folder;
      editedFolderName = folder.name || '';
      foldersStore.update((items) => items.map((f) => (f.id === folder.id ? { ...f, ...folder } : f)));
    } catch {
      // ignore
    }
  };

  const handleUseCaseClick = (useCaseId: string, status: string) => {
    if (status === 'generating' || status === 'detailing') return;
    goto(`/cas-usage/${useCaseId}`);
  };

  const handleDeleteUseCase = async (id: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce cas d'usage ?")) return;
    try {
      await deleteUseCase(id);
      useCasesStore.update((items) => items.filter((uc) => uc.id !== id));
      addToast({ type: 'success', message: "Cas d'usage supprimé avec succès !" });
    } catch (error) {
      console.error('Failed to delete use case:', error);
      const anyErr = error as any;
      if (anyErr?.status === 403) {
        addToast({ type: 'error', message: 'Action non autorisée (mode lecture seule).' });
      } else {
      addToast({ type: 'error', message: 'Erreur lors de la suppression' });
      }
    }
  };

  const handleDeleteFolder = async () => {
    if (!currentFolder) return;
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce dossier ?')) return;
    try {
      await apiDelete(`/folders/${currentFolder.id}`);
      foldersStore.update((items) => items.filter((f) => f.id !== currentFolder?.id));
      currentFolderId.set(null);
      addToast({ type: 'success', message: 'Dossier supprimé avec succès !' });
      goto('/dossiers');
    } catch (error) {
      console.error('Failed to delete folder:', error);
      const anyErr = error as any;
      if (anyErr?.status === 403) {
        addToast({ type: 'error', message: 'Action non autorisée (mode lecture seule).' });
      } else {
        addToast({ type: 'error', message: 'Erreur lors de la suppression' });
      }
    }
  };

  onMount(() => {
    currentFolderId.set(folderId);
    void loadUseCases();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('beforeunload', handleLeave);

    streamHub.set(HUB_KEY, (evt: any) => {
      if (evt?.type === 'usecase_update') {
        const useCaseId: string = evt.useCaseId;
        const data: any = evt.data ?? {};
        if (!useCaseId) return;
        if (data?.deleted) {
          useCasesStore.update((items) => items.filter((uc) => uc.id !== useCaseId));
          return;
        }
        if (data?.useCase) {
          const updated = data.useCase;
          useCasesStore.update((items) => {
            const idx = items.findIndex((uc) => uc.id === updated.id);
            if (idx === -1) return [updated, ...items];
            const next = [...items];
            next[idx] = { ...next[idx], ...updated };
            return next;
          });
        }
        return;
      }
      if (evt?.type === 'folder_update') {
        const fId: string = evt.folderId;
        const data: any = evt.data ?? {};
        if (!fId || fId !== folderId) return;
        if (data?.folder?.matrixConfig) {
          matrix = data.folder.matrixConfig;
        }
        if (data?.folder) {
          currentFolder = { ...(currentFolder as any), ...(data.folder as any) };
        }
        return;
      }
      if (evt?.type === 'comment_update') {
        if (evt.contextType !== 'folder' || evt.contextId !== folderId) return;
        scheduleCommentReload();
      }
    });
    lastFolderIdForCounts = folderId;
    hasMounted = true;
  });

  onDestroy(() => {
    if (commentCountsRetryTimer) clearTimeout(commentCountsRetryTimer);
    streamHub.delete(HUB_KEY);
    if (lockHubKey) streamHub.delete(lockHubKey);
    if (lockRefreshTimer) clearInterval(lockRefreshTimer);
    if (lockTargetId) void leavePresence('folder', lockTargetId);
    void releaseCurrentLock();
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handleLeave);
    window.removeEventListener('beforeunload', handleLeave);
  });

  $: if (hasMounted && folderId && folderId !== lastFolderIdForCounts) {
    lastFolderIdForCounts = folderId;
    currentFolderId.set(folderId);
    void loadUseCases();
    void loadCommentCounts();
  }

  const subscribeLock = (targetId: string) => {
    if (lockHubKey) streamHub.delete(lockHubKey);
    lockHubKey = `lock:folder:${targetId}`;
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
      if (isReadOnly) {
        lock = await fetchLock('folder', lockTargetId);
      } else {
        const res = await acquireLock('folder', lockTargetId);
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
      addToast({ type: 'success', message: 'Demande de déverrouillage envoyée' });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur demande de déverrouillage' });
    }
  };

  const handleForceUnlock = async () => {
    if (!lockTargetId) return;
    try {
      await forceUnlock('folder', lockTargetId);
      addToast({ type: 'success', message: 'Verrou forcé' });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur forçage verrou' });
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


  $: if (folderId && folderId !== lockTargetId) {
    if (lockTargetId) {
      void leavePresence('folder', lockTargetId);
      void releaseCurrentLock();
    }
    lock = null;
    presenceUsers = [];
    presenceTotal = 0;
    lockTargetId = folderId;
    subscribeLock(folderId);
    void syncLock();
    void hydratePresence();
    void updatePresence();
  }

  $: if (isReadOnly !== lastReadOnlyRole) {
    lastReadOnlyRole = isReadOnly;
    if (isReadOnly) {
      void releaseCurrentLock();
      void syncLock();
    } else {
      void syncLock();
    }
  }
</script>

<section class="space-y-6">
  {#if currentFolder}
    <div class="grid grid-cols-12 gap-4 items-start">
      <div class="col-span-8 min-w-0">
        {#if isReadOnly || isLockedByOther}
          <h1 class="text-3xl font-semibold mb-0 break-words">{currentFolder.name || 'Dossier'}</h1>
        {:else}
          <h1 class="text-3xl font-semibold mb-0 break-words">
            <EditableInput
              label=""
              value={editedFolderName}
              markdown={false}
              multiline={true}
              apiEndpoint={`/folders/${currentFolder.id}`}
              fullData={{ name: editedFolderName }}
              changeId={`folder-name-${currentFolder.id}`}
              originalValue={currentFolder.name || ''}
              on:change={(e) => (editedFolderName = e.detail.value)}
              on:saved={handleFolderNameSaved}
            />
          </h1>
        {/if}
      </div>
      <div class="col-span-4 flex items-center justify-end gap-2 flex-wrap pt-1">
        {#if currentFolder.organizationId}
          {@const orgId = currentFolder.organizationId}
          <button
            type="button"
            class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
            on:click={() => goto(`/organisations/${orgId}`)}
            title="Voir l'organisation"
          >
            {currentFolder.organizationName || 'Organisation'}
          </button>
        {/if}
        {#if currentFolder.model}
          <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
            {currentFolder.model}
          </span>
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
        <FileMenu
          showNew={false}
          showImport={true}
          showExport={true}
          showPrint={false}
          showDelete={!isReadOnly}
          disabledImport={isReadOnly}
          disabledExport={isReadOnly}
          onImport={() => (showImportDialog = true)}
          onExport={() => (showExportDialog = true)}
          onDelete={handleDeleteFolder}
          triggerTitle="Actions"
          triggerAriaLabel="Actions"
        />
        {#if showReadOnlyLock && !showPresenceBadge}
          <button
            class="rounded p-2 transition text-slate-400 cursor-not-allowed"
            title="Mode lecture seule : création / suppression désactivées."
            aria-label="Mode lecture seule : création / suppression désactivées."
            type="button"
            disabled
          >
            <Lock class="w-5 h-5" />
          </button>
        {/if}
      </div>
    </div>

    <!-- Contexte (entre le titre et le bloc documents) -->
    <div class="rounded border border-slate-200 bg-white p-4" data-comment-section="description">
      <div class="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2 group">
        Contexte
        <CommentBadge
          count={commentCounts?.description ?? 0}
          disabled={!openCommentsFor}
          on:click={() => openCommentsFor('description')}
        />
      </div>
      <EditableInput
        label=""
        value={editedContext}
        markdown={true}
        placeholder="Décrire le contexte métier et les objectifs…"
        apiEndpoint={`/folders/${currentFolder.id}`}
        fullData={{ description: editedContext }}
        originalValue={currentFolder.description || ''}
        changeId={`folder-context-${currentFolder.id}`}
        on:change={(e) => (editedContext = e.detail.value)}
        locked={isReadOnly || isLockedByOther}
      />
    </div>

    <DocumentsBlock
      contextType="folder"
      contextId={currentFolder.id}
      on:state={(event) => {
        hasDocuments = (event.detail?.items || []).length > 0;
      }}
    />
  {:else}
    <h1 class="text-3xl font-semibold">Dossier</h1>
  {/if}

  {#if isLoading}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <p class="text-sm text-blue-700">Chargement des cas d'usage...</p>
    </div>
  {/if}

  <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
    {#each $useCasesStore.filter((uc) => uc.folderId === folderId) as useCase}
      {@const isDetailing = useCase.status === 'detailing'}
      {@const isDraft = useCase.status === 'draft'}
      {@const isGenerating = useCase.status === 'generating'}
      {@const canClick = !(isDetailing || isGenerating)}

      <article
        {...(canClick ? { role: 'button', tabindex: 0 } : {})}
        class="rounded border border-slate-200 bg-white shadow-sm transition-shadow group flex flex-col h-full {(isDetailing || isGenerating) ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md cursor-pointer'}"
        on:click={() => canClick && handleUseCaseClick(useCase.id, useCase.status || 'completed')}
        on:keydown={(e) => {
          if (canClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handleUseCaseClick(useCase.id, useCase.status || 'completed');
          }
        }}
      >
        <div class="flex justify-between items-start p-3 sm:p-4 pb-2 border-b border-blue-200 bg-blue-50 gap-2 rounded-t-lg">
          <div class="flex-1 min-w-0">
            <h2
              class="text-lg sm:text-xl font-medium truncate {(isDetailing || isGenerating) ? 'text-slate-400' : 'text-blue-800 group-hover:text-blue-900 transition-colors'}"
            >
              {useCase?.data?.name || useCase?.name || "Cas d'usage sans nom"}
            </h2>
          </div>
          {#if !isReadOnly}
            <button
              class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              on:click|stopPropagation={() => handleDeleteUseCase(useCase.id)}
              title="Supprimer"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          {/if}
        </div>

        <div class="p-3 sm:p-4 pt-2 flex-1 min-h-0">
          {#if useCase?.data?.description || useCase?.description}
            <div class="text-sm text-slate-600 line-clamp-2 mb-3 break-words">
              {@html renderInlineMarkdown(useCase?.data?.description || useCase?.description || '')}
            </div>
          {/if}

          {#if isDetailing || isGenerating}
            <StreamMessage streamId={`usecase_${useCase.id}`} status={useCase.status} maxHistory={6} />
          {:else}
            <div class="flex flex-col sm:flex-row gap-2 sm:gap-4 text-sm text-slate-500">
              <div class="flex items-center gap-1 flex-wrap">
                <span class="whitespace-nowrap">Valeur:</span>
                {#if matrix}
                  {@const valueScores = useCase?.data?.valueScores || useCase?.valueScores}
                  {@const complexityScores = useCase?.data?.complexityScores || useCase?.complexityScores}
                  {#if valueScores && complexityScores}
                    {@const calculatedScores = calculateUseCaseScores(matrix, valueScores, complexityScores)}
                    {@const valueStars = calculatedScores.valueStars}
                    <div class="flex items-center gap-0.5">
                      {#each range(5) as i (i)}
                        {#if i < valueStars}
                          <Star class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-yellow-400 fill-yellow-400 flex-shrink-0" />
                        {:else}
                          <Star class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-300 flex-shrink-0" />
                        {/if}
                      {/each}
                    </div>
                  {:else}
                    <span class="text-gray-400">N/A</span>
                  {/if}
                {:else}
                  <span class="text-gray-400">N/A</span>
                {/if}
              </div>

              <div class="flex items-center gap-1 flex-wrap">
                <span class="whitespace-nowrap">Complexité:</span>
                {#if matrix}
                  {@const valueScores = useCase?.data?.valueScores || useCase?.valueScores}
                  {@const complexityScores = useCase?.data?.complexityScores || useCase?.complexityScores}
                  {#if valueScores && complexityScores}
                    {@const calculatedScores = calculateUseCaseScores(matrix, valueScores, complexityScores)}
                    {@const complexityStars = calculatedScores.complexityStars}
                    <div class="flex items-center gap-0.5">
                      {#each range(5) as i (i)}
                        {#if i < complexityStars}
                          <X class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-500 flex-shrink-0" />
                        {:else}
                          <Minus class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-300 flex-shrink-0" />
                        {/if}
                      {/each}
                    </div>
                  {:else}
                    <span class="text-gray-400">N/A</span>
                  {/if}
                {:else}
                  <span class="text-gray-400">N/A</span>
                {/if}
              </div>
            </div>
          {/if}
        </div>

        <div class="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-slate-100">
          <span class="text-xs text-slate-400 whitespace-nowrap">
            {#if isDetailing}
              Détail en cours...
            {:else if isGenerating}
              Génération en cours...
            {:else if isDraft}
              Brouillon
            {:else}
              Cliquez pour voir les détails
            {/if}
          </span>

          <div class="flex items-center gap-2 flex-wrap">
            {#if useCase.model}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap">
                {useCase.model}
              </span>
            {/if}
            {#if isDetailing}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 whitespace-nowrap">
                <Loader2 class="w-3 h-3 mr-1 animate-spin flex-shrink-0" />
                Détail en cours
              </span>
            {:else if isDraft}
              <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 whitespace-nowrap">
                Brouillon
              </span>
            {/if}
          </div>
        </div>
      </article>
    {/each}
  </div>
</section>

{#if currentFolder}
  <!-- Commentaires gérés par ChatWidget -->
{/if}

{#if currentFolder}
  <ImportExportDialog
    bind:open={showExportDialog}
    mode="export"
    title="Exporter le dossier"
    scope="folder"
    scopeId={currentFolder.id}
    allowScopeSelect={false}
    allowScopeIdEdit={false}
    workspaceName={workspaceName}
    objectName={currentFolder?.name || ''}
    commentsAvailable={commentsTotal > 0}
    documentsAvailable={hasDocuments}
    includeOptions={
      [
        ...(currentFolder?.organizationId
          ? [{ id: 'organization', label: "Inclure l'organisation", defaultChecked: true }]
          : []),
        { id: 'usecases', label: "Inclure les cas d'usage", defaultChecked: true },
        { id: 'matrix', label: 'Inclure la matrice', defaultChecked: true },
      ]
    }
    includeAffectsComments={['organization', 'usecases', 'matrix']}
    includeAffectsDocuments={['organization', 'usecases', 'matrix']}
  />
  <ImportExportDialog
    bind:open={showImportDialog}
    mode="import"
    title="Importer un cas d'usage"
    scope="folder"
    defaultTargetWorkspaceId={getScopedWorkspaceIdForUser()}
    importObjectTypes={['usecases']}
    importTargetType="folder"
    importTargetLabel="Dossier cible"
    importTargetOptions={[{ id: currentFolder.id, label: currentFolder.name }]}
    defaultImportTargetId={currentFolder.id}
    on:imported={handleImportComplete}
  />
{/if}


