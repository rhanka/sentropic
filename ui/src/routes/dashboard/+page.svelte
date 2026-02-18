<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // {@html} usage in this file is routed through renderMarkdownWithRefs(),
  // which sanitizes HTML via DOMPurify to protect against XSS.
  
  import { onMount, onDestroy, tick } from 'svelte';
  import { useCasesStore, fetchUseCases } from '$lib/stores/useCases';
  import { foldersStore, fetchFolders, currentFolderId } from '$lib/stores/folders';
  import { addToast, removeToast } from '$lib/stores/toast';
  import { apiGet, apiPost } from '$lib/utils/api';
  import { streamHub } from '$lib/stores/streamHub';
  import UseCaseScatterPlot from '$lib/components/UseCaseScatterPlot.svelte';
  import UseCaseDetail from '$lib/components/UseCaseDetail.svelte';
  import CommentBadge from '$lib/components/CommentBadge.svelte';
  import type { MatrixConfig } from '$lib/types/matrix';
  import References from '$lib/components/References.svelte';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import FileMenu from '$lib/components/FileMenu.svelte';
  import { listComments } from '$lib/utils/comments';
  import LockPresenceBadge from '$lib/components/LockPresenceBadge.svelte';
  import { normalizeMarkdownLineEndings, renderMarkdownWithRefs } from '$lib/utils/markdown';
  import { workspaceReadOnlyScope, workspaceScopeHydrated, workspaceScope, selectedWorkspaceRole } from '$lib/stores/workspaceScope';
  import { session } from '$lib/stores/session';
  import {
    acceptUnlock,
    acquireLock,
    fetchLock,
    forceUnlock,
    releaseLock,
    requestUnlock,
    sendPresence,
    fetchPresence,
    leavePresence,
    type LockSnapshot,
    type PresenceUser,
  } from '$lib/utils/object-lock';
  import {
    downloadCompletedDocxJob,
    startDocxGeneration,
    waitForDocxJobCompletion,
  } from '$lib/utils/docx';
  import {
    getDashboardDocxMenuState,
    reduceDashboardDocxState,
    type DashboardDocxEvent,
  } from '$lib/utils/dashboard-docx-state';
  import { FileText, TrendingUp, Settings, X, Lock } from '@lucide/svelte';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';

  let isLoading = false;
  let summaryBox: HTMLElement | null = null;
  let summaryContent: HTMLElement | null = null;
  let matrix: MatrixConfig | null = null;
  let selectedFolderId: string | null = null;
  let currentFolder: any = null;
  let executiveSummary: any = null;
  let isGeneratingSummary = false;
  let dashboardDocxState: 'idle' | 'preparing' | 'ready' = 'idle';
  let dashboardDocxJobId: string | null = null;
  let dashboardDocxWatchToken = 0;
  let lastDocxStateFolderId: string | null = null;
  let dashboardDocxMenuLabel = '';
  let dashboardDocxActionDisabled = true;
  let dashboardDocxReadyToastId: string | null = null;
  let scatterPlotRef:
    | {
        getDocxBitmapSnapshot?: () =>
          | { dataUrl: string; widthPx: number; heightPx: number }
          | null;
      }
    | null = null;
  const HUB_KEY = 'dashboardPage';
  let lockHubKey: string | null = null;
  let lockRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let lockTargetId: string | null = null;
  let lock: LockSnapshot | null = null;
  let lockLoading = false;
  let lockError: string | null = null;
  let suppressAutoLock = false;
  let presenceUsers: PresenceUser[] = [];
  let presenceTotal = 0;
  let commentCounts: Record<string, number> = {};
  let folderCommentCounts: Record<string, number> = {};
  let workspaceId: string | null = null;
  let commentUserId: string | null = null;
  let lastCommentCountsKey = '';
  let commentCountsLoading = false;
  let commentCountsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let commentCountsRetryAttempts = 0;
  let commentReloadTimer: ReturnType<typeof setTimeout> | null = null;
  const LOCK_REFRESH_MS = 10 * 1000;
  $: isWorkspaceAdmin = $selectedWorkspaceRole === 'admin';
  $: isLockedByMe = !!lock && lock.lockedBy.userId === $session.user?.id;
  $: isLockedByOther = !!lock && lock.lockedBy.userId !== $session.user?.id;
  $: lockOwnerLabel = lock?.lockedBy?.displayName || lock?.lockedBy?.email || 'Utilisateur';
  $: lockRequestedByMe = !!lock && lock.unlockRequestedByUserId === $session.user?.id;
  $: showPresenceBadge = lockLoading || lockError || !!lock || presenceUsers.length > 0 || presenceTotal > 0;
  $: isDashboardReadOnly = $workspaceReadOnlyScope || isLockedByOther;
  let lastReadOnlyRole = isDashboardReadOnly;
  $: showWorkspaceReadOnlyLock = $workspaceScopeHydrated && $workspaceReadOnlyScope;

  const parseJsonObject = (value: unknown): Record<string, any> | null => {
    if (!value) return null;
    if (typeof value === 'object') return value as Record<string, any>;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
      } catch {
        return null;
      }
    }
    return null;
  };

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

  const applyFolderSnapshot = (folderId: string, folderData: any) => {
    if (!folderData || !selectedFolderId || folderId !== selectedFolderId) return;

    const normalizedFolder = { ...folderData };
    const rawMatrixConfig = folderData.matrixConfig ?? folderData.matrix_config;
    if (rawMatrixConfig !== undefined) {
      const incomingMatrix = parseOptionalObject(rawMatrixConfig);
      if (incomingMatrix === undefined) {
        delete (normalizedFolder as any).matrixConfig;
      } else {
        normalizedFolder.matrixConfig = incomingMatrix;
        matrix = incomingMatrix as MatrixConfig | null;
      }
    }
    const rawExecutiveSummary =
      folderData.executiveSummary ?? folderData.executive_summary ?? folderData.exec_summary;
    if (rawExecutiveSummary !== undefined) {
      const incomingExecutiveSummary = parseOptionalObject(rawExecutiveSummary);
      if (incomingExecutiveSummary === null) {
        normalizedFolder.executiveSummary = null;
        executiveSummary = null;
        applyExecutiveSummarySnapshot(folderId, null);
      } else if (incomingExecutiveSummary && typeof incomingExecutiveSummary === 'object') {
        const previousSummary =
          executiveSummary && typeof executiveSummary === 'object' ? executiveSummary : {};
        const mergedExecutiveSummary = {
          ...previousSummary,
          ...incomingExecutiveSummary,
          references:
            incomingExecutiveSummary.references !== undefined
              ? incomingExecutiveSummary.references
              : previousSummary.references || []
        };
        normalizedFolder.executiveSummary = mergedExecutiveSummary;
        executiveSummary = mergedExecutiveSummary;
        applyExecutiveSummarySnapshot(folderId, mergedExecutiveSummary);
      } else {
        // Ignore malformed partial payloads instead of wiping local executive summary state.
        delete (normalizedFolder as any).executiveSummary;
      }
    }
    currentFolder = { ...(currentFolder || {}), ...normalizedFolder };
    if (typeof folderData.name === 'string') {
      editedFolderName = folderData.name;
    }

    foldersStore.update((folders) =>
      folders.map((f) => (f.id === folderId ? { ...f, ...(normalizedFolder as any) } : f))
    );
  };

  const subscribeLock = (targetId: string) => {
    if (lockHubKey) streamHub.delete(lockHubKey);
    lockHubKey = `lock:dashboard-folder:${targetId}`;
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
      if (isDashboardReadOnly) {
        lock = await fetchLock('folder', lockTargetId);
      } else {
        const res = await acquireLock('folder', lockTargetId);
        lock = res.lock;
      }
      scheduleLockRefresh();
    } catch (e: any) {
      lockError = e?.message ?? get(_)('locks.lockError');
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
      addToast({ type: 'success', message: get(_)('locks.unlockRequestSent') });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? get(_)('locks.unlockRequestError') });
    }
  };

  const handleForceUnlock = async () => {
    if (!lockTargetId) return;
    try {
      await forceUnlock('folder', lockTargetId);
      addToast({ type: 'success', message: get(_)('locks.lockForced') });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? get(_)('locks.lockForceError') });
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

  $: if (selectedFolderId && selectedFolderId !== lockTargetId) {
    if (lockTargetId) {
      void leavePresence('folder', lockTargetId);
      void releaseCurrentLock();
    }
    lock = null;
    presenceUsers = [];
    presenceTotal = 0;
    lockTargetId = selectedFolderId;
    subscribeLock(lockTargetId);
    void syncLock();
    void hydratePresence();
    void updatePresence();
  }

  $: if (!selectedFolderId && lockTargetId) {
    void leavePresence('folder', lockTargetId);
    void releaseCurrentLock();
    if (lockHubKey) streamHub.delete(lockHubKey);
    lockHubKey = null;
    lockTargetId = null;
    lock = null;
    presenceUsers = [];
    presenceTotal = 0;
  }

  $: if (isDashboardReadOnly !== lastReadOnlyRole) {
    lastReadOnlyRole = isDashboardReadOnly;
    if (lastReadOnlyRole) {
      void releaseCurrentLock();
      void syncLock();
    } else {
      void syncLock();
    }
  }
  
  type ExecutiveSummaryField = 'introduction' | 'analyse' | 'recommandation' | 'synthese_executive';
  const EXECUTIVE_SUMMARY_FIELDS: ExecutiveSummaryField[] = [
    'introduction',
    'analyse',
    'recommandation',
    'synthese_executive',
  ];
  const emptyExecutiveSummaryRecord = (): Record<ExecutiveSummaryField, string> => ({
    introduction: '',
    analyse: '',
    recommandation: '',
    synthese_executive: '',
  });

  let executiveSummaryData: Record<ExecutiveSummaryField, string> = emptyExecutiveSummaryRecord();
  let executiveSummaryBuffers: Record<ExecutiveSummaryField, string> = emptyExecutiveSummaryRecord();
  let executiveSummaryOriginals: Record<ExecutiveSummaryField, string> = emptyExecutiveSummaryRecord();
  let lastExecutiveSummaryFolderId: string | null = null;

  const openExecutiveSummaryComments = (sectionKey: ExecutiveSummaryField | 'references') => {
    if (!selectedFolderId) return;
    const detail = { contextType: 'executive_summary', contextId: selectedFolderId, sectionKey };
    window.dispatchEvent(new CustomEvent('topai:open-comments', { detail }));
  };

  const openFolderComments = (sectionKey: 'name') => {
    if (!selectedFolderId) return;
    const detail = { contextType: 'folder', contextId: selectedFolderId, sectionKey };
    window.dispatchEvent(new CustomEvent('topai:open-comments', { detail }));
  };

  const buildCommentCounts = (items: Array<any>): Record<string, number> => {
    const counts: Record<string, number> = {};
    const threads = new Map<string, { status: string; count: number; sectionKey: string | null }>();
    for (const item of items) {
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
    return counts;
  };

  const canLoadCommentCounts = () =>
    Boolean(selectedFolderId && workspaceId && commentUserId && !$session.loading);

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
    if (!canLoadCommentCounts() || !selectedFolderId) return;
    if (commentCountsLoading) return;
    commentCountsLoading = true;
    try {
      const [executiveSummaryComments, folderComments] = await Promise.all([
        listComments({ contextType: 'executive_summary', contextId: selectedFolderId }),
        listComments({ contextType: 'folder', contextId: selectedFolderId }),
      ]);
      commentCounts = buildCommentCounts(executiveSummaryComments.items || []);
      folderCommentCounts = buildCommentCounts(folderComments.items || []);
      commentCountsRetryAttempts = 0;
    } catch {
      commentCountsRetryAttempts += 1;
      scheduleCommentCountsRetry();
    } finally {
      commentCountsLoading = false;
    }
  };

  const scheduleCommentReload = () => {
    if (commentReloadTimer) return;
    commentReloadTimer = setTimeout(() => {
      commentReloadTimer = null;
      void loadCommentCounts();
    }, 150);
  };

  const normalizeExecutiveSummaryFields = (
    summary: Record<string, any> | null | undefined
  ): Record<ExecutiveSummaryField, string> => {
    const normalized = emptyExecutiveSummaryRecord();
    if (!summary) return normalized;
    for (const field of EXECUTIVE_SUMMARY_FIELDS) {
      normalized[field] = normalizeMarkdownLineEndings(summary[field]);
    }
    return normalized;
  };

  const applyExecutiveSummarySnapshot = (
    folderId: string | null | undefined,
    summary: Record<string, any> | null | undefined
  ) => {
    const incoming = normalizeExecutiveSummaryFields(summary);
    if (!folderId || folderId !== lastExecutiveSummaryFolderId) {
      lastExecutiveSummaryFolderId = folderId ?? null;
      executiveSummaryBuffers = { ...incoming };
      executiveSummaryOriginals = { ...incoming };
      executiveSummaryData = { ...incoming };
      return;
    }

    const nextBuffers = { ...executiveSummaryBuffers };
    const nextOriginals = { ...executiveSummaryOriginals };
    let changed = false;

    for (const field of EXECUTIVE_SUMMARY_FIELDS) {
      if (incoming[field] !== executiveSummaryOriginals[field]) {
        nextBuffers[field] = incoming[field];
        nextOriginals[field] = incoming[field];
        changed = true;
      }
    }

    if (changed) {
      executiveSummaryBuffers = nextBuffers;
      executiveSummaryOriginals = nextOriginals;
    }
    executiveSummaryData = { ...(changed ? nextBuffers : executiveSummaryBuffers) };
  };
  
  // Numéros de page statiques pour le sommaire
  const basePageNumbers = {
    introduction: 2,
    sommaire: 3,
    analyse: 4,
    recommandations: 5,
    references: 6,
    annexes: 7
  };

  // Détecter si on a plus de 23 cas d'usage (nécessite un saut de page supplémentaire)
  $: hasMoreThan23UseCases = filteredUseCases.length > 23;
  $: pageOffset = hasMoreThan23UseCases ? 1 : 0;

  // Numéros de page ajustés (incrémentés de 1 si plus de 23 cas d'usage)
  $: pageNumbers = {
    introduction: basePageNumbers.introduction,
    sommaire: basePageNumbers.sommaire,
    analyse: basePageNumbers.analyse + pageOffset,
    recommandations: basePageNumbers.recommandations + pageOffset,
    references: basePageNumbers.references + pageOffset,
    annexes: basePageNumbers.annexes + pageOffset
  };

  // Calculer les numéros de page des cas d'usage (statique : page annexes + index + 1)
  // Si plus de 23 cas d'usage, le 24ème et suivants sont incrémentés de 1
  $: useCasePages = filteredUseCases.map((uc, index) => {
    const basePage = pageNumbers.annexes + index + 1;
    // Les cas d'usage après le 23ème ont déjà leur page incrémentée via pageOffset
    // Donc pas besoin d'ajustement supplémentaire ici
    return {
      name: uc.data?.name || uc.name || 'Cas d\'usage',
      page: basePage,
      id: uc.id,
      is24thOrLater: index >= 23
    };
  });

  onMount(() => {
    loadConfig();
    void (async () => {
    await loadData();
    })();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('beforeunload', handleLeave);

    // SSE: keep dashboard data synced with optimistic updates and collaborative edits.
    streamHub.set(HUB_KEY, (evt: any) => {
      if (evt?.type === 'folder_update') {
        const folderId: string = evt.folderId;
        const data: any = evt.data ?? {};
        if (!folderId || !selectedFolderId || folderId !== selectedFolderId) return;
        if (data?.deleted) return;
        if (data?.folder) {
          applyFolderSnapshot(folderId, data.folder);
          return;
        }
        // Fallback only when SSE payload has no folder snapshot.
        void loadMatrix(folderId);
        return;
      }
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
      }
      if (evt?.type === 'comment_update') {
        if (evt.contextType !== 'executive_summary' && evt.contextType !== 'folder') return;
        const contextId = String(evt.contextId ?? '');
        if (!selectedFolderId || contextId !== selectedFolderId) return;
        scheduleCommentReload();
      }
    });

    // Reload on workspace selection change
    let lastScope = $workspaceScope.selectedId;
    const unsub = workspaceScope.subscribe((s) => {
      const nextScope = s.selectedId ?? null;
      const previousScope = lastScope ?? null;
      // Ignore transient scope clear while workspace list is reloading.
      if (s.loading && !nextScope && !!previousScope) {
        return;
      }
      if (nextScope !== previousScope) {
        lastScope = s.selectedId;
        void loadData();
      }
    });
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handleLeave);
      window.removeEventListener('beforeunload', handleLeave);
    };
  });

  onDestroy(() => {
    streamHub.delete(HUB_KEY);
    if (lockHubKey) streamHub.delete(lockHubKey);
    if (lockRefreshTimer) clearInterval(lockRefreshTimer);
    if (commentCountsRetryTimer) clearTimeout(commentCountsRetryTimer);
    if (commentReloadTimer) clearTimeout(commentReloadTimer);
    if (lockTargetId) void leavePresence('folder', lockTargetId);
    void releaseCurrentLock();
    clearDashboardDocxReadyToast();
  });

  $: if (selectedFolderId && workspaceId && commentUserId && !$session.loading) {
    const key = `${selectedFolderId}:${workspaceId}:${commentUserId}`;
    if (key !== lastCommentCountsKey) {
      lastCommentCountsKey = key;
      void loadCommentCounts();
    }
  }

  $: if (!selectedFolderId && Object.keys(commentCounts).length) {
    commentCounts = {};
    folderCommentCounts = {};
    lastCommentCountsKey = '';
  }

  const loadData = async () => {
    isLoading = true;
    try {
      // Charger les dossiers
      const folders = await fetchFolders();
      foldersStore.set(folders);
      
      // Charger les cas d'usage
      const useCases = await fetchUseCases();
      useCasesStore.set(useCases);
      
      // Sélectionner le dossier persistant uniquement s'il existe dans le scope courant
      const persistedFolderId = $currentFolderId;
      const hasPersistedFolder = !!persistedFolderId && folders.some((f) => f.id === persistedFolderId);
      selectedFolderId = hasPersistedFolder ? persistedFolderId : (folders.length > 0 ? folders[0].id : null);
      
      if (selectedFolderId) {
        // Ensure global context is set (used by chat context detection)
        currentFolderId.set(selectedFolderId);
        await loadMatrix(selectedFolderId);
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      addToast({
        type: 'error',
        message: get(_)('dashboard.errors.load')
      });
    } finally {
      isLoading = false;
    }
  };

  const loadMatrix = async (folderId: string) => {
    try {
      const folder = await apiGet(`/folders/${folderId}`);
      const normalizedFolder = { ...folder };
      normalizedFolder.matrixConfig =
        typeof folder.matrixConfig === 'string'
          ? parseJsonObject(folder.matrixConfig)
          : folder.matrixConfig;
      normalizedFolder.executiveSummary =
        typeof folder.executiveSummary === 'string'
          ? parseJsonObject(folder.executiveSummary)
          : folder.executiveSummary;

      currentFolder = normalizedFolder;
      matrix = normalizedFolder.matrixConfig;
      executiveSummary = normalizedFolder.executiveSummary || null;
      applyExecutiveSummarySnapshot(folderId, executiveSummary as Record<string, any> | null);
      
      // Mettre à jour le folder dans le store pour refléter les changements de statut
      foldersStore.update(folders =>
        folders.map((f) =>
          f.id === folderId
            ? {
                ...f,
                status: normalizedFolder.status,
                executiveSummary: normalizedFolder.executiveSummary,
                name: normalizedFolder.name
              }
            : f
        )
      );
      
      // Mettre à jour le titre édité si c'est le dossier actuel
      if (folderId === selectedFolderId) {
        editedFolderName = normalizedFolder.name || '';
      }
    } catch (error) {
      console.error('Failed to load matrix:', error);
    }
  };

  const generateExecutiveSummary = async () => {
    if (!selectedFolderId) return;
    if (isDashboardReadOnly) {
      addToast({ type: 'warning', message: get(_)('dashboard.readOnlyGenerationDisabled') });
      return;
    }
    
    isGeneratingSummary = true;
    try {
      const result = await apiPost('/analytics/executive-summary', {
        folder_id: selectedFolderId,
        value_threshold: valueThreshold,
        complexity_threshold: complexityThreshold
      });
      
      addToast({
        type: 'success',
        message: result.message || get(_)('dashboard.toast.generationStarted')
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
        message: error?.data?.message || get(_)('dashboard.errors.generate')
      });
    } finally {
      isGeneratingSummary = false;
    }
  };

  const handleExecutiveSummaryFieldChange = (field: ExecutiveSummaryField, value: string) => {
    const normalizedValue = normalizeMarkdownLineEndings(value);
    executiveSummaryBuffers = { ...executiveSummaryBuffers, [field]: normalizedValue };
    executiveSummaryData = { ...executiveSummaryBuffers };
  };

  const getExecutiveSummaryPayload = (field: ExecutiveSummaryField) => {
    if (!executiveSummary || !selectedFolderId) return undefined;
    const value = executiveSummaryBuffers[field] ?? executiveSummaryData[field] ?? '';
    const fields = { ...executiveSummaryBuffers, [field]: normalizeMarkdownLineEndings(value) };
    return {
      executiveSummary: {
        ...fields,
        references: executiveSummary.references || []
      }
    };
  };

  const getExecutiveSummaryOriginal = (field: ExecutiveSummaryField): string => {
    return executiveSummaryOriginals[field] || '';
  };

  // Keep local state in sync after PUT success; SSE will reconcile without forced GET.
  const handleExecutiveSummarySaved = (field: ExecutiveSummaryField, value: string) => {
    if (!selectedFolderId) return;
    const normalizedValue = normalizeMarkdownLineEndings(value);
    const nextBuffers = { ...executiveSummaryBuffers, [field]: normalizedValue };
    executiveSummaryBuffers = nextBuffers;
    executiveSummaryOriginals = { ...executiveSummaryOriginals, [field]: normalizedValue };
    executiveSummaryData = { ...nextBuffers };

    const nextExecutiveSummary = {
      ...(executiveSummary || {}),
      ...nextBuffers,
      references: executiveSummary?.references || []
    };

    executiveSummary = nextExecutiveSummary;
    if (currentFolder) {
      currentFolder = { ...currentFolder, executiveSummary: nextExecutiveSummary };
    }
    foldersStore.update((folders) =>
      folders.map((f) =>
        f.id === selectedFolderId ? { ...f, executiveSummary: nextExecutiveSummary } : f
      )
    );

    clearDashboardDocxReadyToast();
    if (field) {
      applyDashboardDocxEvent({ type: 'content_changed' });
    }
  };

  // Variable pour le titre du dossier édité
  let editedFolderName = '';
  
  // Initialiser le titre édité quand le dossier change
  $: if (selectedFolderName !== undefined) {
    editedFolderName = selectedFolderName || '';
  }

  // Keep local state in sync after PUT success; SSE will reconcile without forced GET.
  const handleFolderNameSaved = () => {
    if (!selectedFolderId) return;

    if (currentFolder) {
      currentFolder = { ...currentFolder, name: editedFolderName };
    }
    foldersStore.update((folders) =>
      folders.map((f) => (f.id === selectedFolderId ? { ...f, name: editedFolderName } : f))
    );
    clearDashboardDocxReadyToast();
    applyDashboardDocxEvent({ type: 'content_changed' });
  };

  const clearDashboardDocxReadyToast = () => {
    if (dashboardDocxReadyToastId) {
      removeToast(dashboardDocxReadyToastId);
      dashboardDocxReadyToastId = null;
    }
  };

  const applyDashboardDocxEvent = (event: DashboardDocxEvent) => {
    const next = reduceDashboardDocxState(
      {
        state: dashboardDocxState,
        jobId: dashboardDocxJobId,
      },
      event
    );
    dashboardDocxState = next.state;
    dashboardDocxJobId = next.jobId;
  };

  const showDashboardDocxReadyToast = (jobId: string) => {
    clearDashboardDocxReadyToast();
    dashboardDocxReadyToastId = addToast({
      type: 'success',
      message: get(_)('dashboard.toast.docxReady'),
      duration: 0,
      actionLabel: get(_)('dashboard.docx.menu.download'),
      actionIcon: 'download',
      onAction: async () => {
        try {
          await downloadCompletedDocxJob(jobId, getExecutiveSynthesisFallbackName());
          clearDashboardDocxReadyToast();
          applyDashboardDocxEvent({ type: 'downloaded' });
        } catch (error) {
          addToast({
            type: 'error',
            message: error instanceof Error ? error.message : get(_)('dashboard.errors.docxPrepare'),
          });
        }
      },
    });
  };

  const getExecutiveSynthesisFallbackName = () =>
    `executive-synthesis-${(selectedFolderName || 'dashboard').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'dashboard'}.docx`;

  const findLatestExecutiveSynthesisDocxJob = async (folderId: string) => {
    const jobs = await apiGet<any[]>('/queue/jobs');
    const matches = (jobs || [])
      .filter(
        (job) =>
          job?.type === 'docx_generate' &&
          job?.data?.templateId === 'executive-synthesis-multipage' &&
          job?.data?.entityType === 'folder' &&
          job?.data?.entityId === folderId &&
          typeof job?.data?.provided?.dashboardImage === 'object'
      )
      .sort((a, b) => {
        const aTs = new Date(a?.createdAt || 0).getTime();
        const bTs = new Date(b?.createdAt || 0).getTime();
        return bTs - aTs;
      });
    return matches[0] || null;
  };

  const watchExecutiveSynthesisDocxJob = async (jobId: string, notifyOnReady: boolean) => {
    const watchToken = ++dashboardDocxWatchToken;
    try {
      const finalJob = await waitForDocxJobCompletion(jobId);
      if (watchToken !== dashboardDocxWatchToken) return;

      if (finalJob.status === 'completed') {
        applyDashboardDocxEvent({ type: 'prepare_completed', jobId });
        if (notifyOnReady) {
          showDashboardDocxReadyToast(jobId);
        }
        return;
      }

      clearDashboardDocxReadyToast();
      applyDashboardDocxEvent({ type: 'prepare_failed' });
      addToast({
        type: 'error',
        message: finalJob.error || get(_)('dashboard.errors.docxPrepare'),
      });
    } catch (error) {
      if (watchToken !== dashboardDocxWatchToken) return;
      clearDashboardDocxReadyToast();
      applyDashboardDocxEvent({ type: 'prepare_failed' });
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : get(_)('dashboard.errors.docxPrepare'),
      });
    }
  };

  const refreshExecutiveSynthesisDocxState = async (folderId: string) => {
    try {
      const latestJob = await findLatestExecutiveSynthesisDocxJob(folderId);
      if (!latestJob) {
        dashboardDocxWatchToken += 1;
        clearDashboardDocxReadyToast();
        applyDashboardDocxEvent({ type: 'cleared' });
        return;
      }

      if (latestJob.status === 'completed') {
        dashboardDocxWatchToken += 1;
        applyDashboardDocxEvent({ type: 'prepare_completed', jobId: latestJob.id });
        return;
      }

      if (latestJob.status === 'pending' || latestJob.status === 'processing') {
        clearDashboardDocxReadyToast();
        applyDashboardDocxEvent({ type: 'prepare_started', jobId: latestJob.id });
        void watchExecutiveSynthesisDocxJob(latestJob.id, false);
        return;
      }

      dashboardDocxWatchToken += 1;
      clearDashboardDocxReadyToast();
      applyDashboardDocxEvent({ type: 'cleared' });
    } catch {
      dashboardDocxWatchToken += 1;
      clearDashboardDocxReadyToast();
      applyDashboardDocxEvent({ type: 'cleared' });
    }
  };

  const startExecutiveSynthesisDocxPreparation = async () => {
    if (!selectedFolderId) return;

    try {
      const scatterSnapshot = scatterPlotRef?.getDocxBitmapSnapshot?.() ?? null;
      const base64Payload =
        scatterSnapshot?.dataUrl?.startsWith('data:')
          ? (scatterSnapshot.dataUrl.split(',', 2)[1] ?? '')
          : '';
      const provided: Record<string, unknown> = {
        dashboardImage: {
          dataBase64: base64Payload,
          mimeType: 'image/png',
          widthPx: scatterSnapshot?.widthPx ?? 0,
          heightPx: scatterSnapshot?.heightPx ?? 0,
        },
      };

      const result = await startDocxGeneration({
        templateId: 'executive-synthesis-multipage',
        entityType: 'folder',
        entityId: selectedFolderId,
        provided,
        controls: {},
      });
      if (result.status === 'completed') {
        applyDashboardDocxEvent({ type: 'prepare_completed', jobId: result.jobId });
        showDashboardDocxReadyToast(result.jobId);
      } else {
        clearDashboardDocxReadyToast();
        applyDashboardDocxEvent({ type: 'prepare_started', jobId: result.jobId });
        addToast({
          type: 'info',
          message: get(_)('dashboard.toast.docxPreparationStarted'),
        });
        void watchExecutiveSynthesisDocxJob(result.jobId, true);
      }
    } catch (error) {
      console.error('Failed to start executive synthesis DOCX preparation:', error);
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : get(_)('dashboard.errors.docxPrepare'),
      });
    }
  };

  const handleDashboardDocxMenuAction = async () => {
    if (!selectedFolderId || dashboardDocxState === 'preparing') return;

    if (dashboardDocxState === 'ready' && dashboardDocxJobId) {
      try {
        await downloadCompletedDocxJob(dashboardDocxJobId, getExecutiveSynthesisFallbackName());
      } catch (error) {
        console.error('Failed to download executive synthesis DOCX:', error);
        addToast({
          type: 'error',
          message: error instanceof Error ? error.message : get(_)('dashboard.errors.docxPrepare'),
        });
      } finally {
        clearDashboardDocxReadyToast();
        applyDashboardDocxEvent({ type: 'downloaded' });
      }
      return;
    }

    await startExecutiveSynthesisDocxPreparation();
  };

  $: {
    const menuState = getDashboardDocxMenuState(
      { state: dashboardDocxState, jobId: dashboardDocxJobId },
      Boolean(selectedFolderId)
    );
    dashboardDocxMenuLabel =
      menuState.labelKey === 'preparing'
        ? get(_)('dashboard.docx.menu.preparing')
        : menuState.labelKey === 'download'
          ? get(_)('dashboard.docx.menu.download')
          : get(_)('dashboard.docx.menu.prepare');
    dashboardDocxActionDisabled = menuState.disabled;
  }

  $: if (selectedFolderId && selectedFolderId !== lastDocxStateFolderId) {
    lastDocxStateFolderId = selectedFolderId;
    void refreshExecutiveSynthesisDocxState(selectedFolderId);
  }

  $: if (!selectedFolderId) {
    lastDocxStateFolderId = null;
    dashboardDocxWatchToken += 1;
    clearDashboardDocxReadyToast();
    applyDashboardDocxEvent({ type: 'cleared' });
  }



  // Filtrer les cas d'usage par dossier sélectionné
  $: filteredUseCases = selectedFolderId 
    ? $useCasesStore.filter(uc => uc.folderId === selectedFolderId)
    : $useCasesStore;
  $: workspaceId = $workspaceScope.selectedId ?? null;
  $: commentUserId = $session.user?.id ?? null;

  // Scatter plot: n'afficher que les cas finalisés
  $: completedUseCases = filteredUseCases.filter((uc) => uc.status === 'completed');

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

  // Keep global folder context in sync so ChatWidget (route-scoped) can enable folder tools on /dashboard.
  // This ensures the chat context matches the selected folder in the dashboard UI.
  $: if (selectedFolderId && selectedFolderId !== $currentFolderId) {
    currentFolderId.set(selectedFolderId);
  }
  
  // Vérifier si la synthèse est en cours de génération
  $: isSummaryGenerating = currentFolder?.status === 'generating' && !executiveSummary;

  // Calculer les scores pour tous les usecases du dossier
  $: useCaseScoresMap = new Map(
    filteredUseCases
      .filter(uc => {
        const valueScores = uc.data?.valueScores || uc.valueScores;
        const complexityScores = uc.data?.complexityScores || uc.complexityScores;
        return valueScores && complexityScores && matrix;
      })
      .map(uc => {
        const valueScores = uc.data?.valueScores || uc.valueScores || [];
        const complexityScores = uc.data?.complexityScores || uc.complexityScores || [];
        return [
          uc.id,
          calculateUseCaseScores(matrix!, valueScores, complexityScores)
        ];
      })
  );

  // refreshManager supprimé (no retrocompat): la réactivité passe par SSE (streamHub)

  // Ajuster automatiquement la taille de police de la synthèse exécutive
  const adjustSummaryFontSize = () => {
    if (!summaryBox || !summaryContent) return;
    
    const box = summaryBox;
    const content = summaryContent;
    
    // Taille de police initiale
    let fontSize = 8; // pt
    const minFontSize = 5; // Réduit de 6 à 5 pour permettre un scaling plus agressif
    const baseLineHeight = 1.4;
    const baseParagraphMargin = 0.15; // cm
    const baseTitleMarginBottom = 0.15; // cm (marge sous le titre h3)
    const baseTitlePaddingBottom = 0.1; // cm (padding sous le titre h3)
    
    // Fonction pour vérifier si le contenu déborde
    const checkOverflow = (): boolean => {
      const scaleFactor = fontSize / 8; // Facteur de réduction par rapport à la taille initiale
      content.style.setProperty('font-size', `${fontSize}pt`, 'important');
      content.style.setProperty('line-height', `${baseLineHeight * scaleFactor}`, 'important');
      // Réduire aussi les marges entre paragraphes
      const paragraphs = content.querySelectorAll('p');
      paragraphs.forEach((p, index) => {
        const pEl = p as HTMLElement;
        if (index === paragraphs.length - 1) {
          // Dernier paragraphe : pas de marge en bas
          pEl.style.setProperty('margin-bottom', '0', 'important');
        } else {
          pEl.style.setProperty('margin-bottom', `${baseParagraphMargin * scaleFactor}cm`, 'important');
        }
      });
      return content.scrollHeight > content.clientHeight;
    };
    
    // Réduire la taille jusqu'à ce que ça tienne (pas plus agressif : 0.2pt au lieu de 0.1pt)
    while (checkOverflow() && fontSize > minFontSize) {
      fontSize -= 0.2;
    }
    
    // Ajuster légèrement vers le bas pour être sûr que ça tienne (marge de sécurité plus grande)
    fontSize -= 0.3;
    
    // Appliquer la taille finale avec line-height et marges proportionnels
    const finalFontSize = Math.max(fontSize, minFontSize);
    const scaleFactor = finalFontSize / 8;
    content.style.setProperty('font-size', `${finalFontSize}pt`, 'important');
    content.style.setProperty('line-height', `${baseLineHeight * scaleFactor}`, 'important');
    // Appliquer les marges réduites aux paragraphes
    const paragraphs = content.querySelectorAll('p');
    paragraphs.forEach((p, index) => {
      const pEl = p as HTMLElement;
      if (index === paragraphs.length - 1) {
        // Dernier paragraphe : pas de marge en bas
        pEl.style.setProperty('margin-bottom', '0', 'important');
      } else {
        pEl.style.setProperty('margin-bottom', `${baseParagraphMargin * scaleFactor}cm`, 'important');
      }
    });
    // Appliquer les marges réduites au titre h3
    const title = box.querySelector('h3');
    if (title) {
      const titleEl = title as HTMLElement;
      titleEl.style.setProperty('margin-bottom', `${baseTitleMarginBottom * scaleFactor}cm`, 'important');
      titleEl.style.setProperty('padding-bottom', `${baseTitlePaddingBottom * scaleFactor}cm`, 'important');
    }
    // Appliquer le padding réduit à la boîte
    // box.style.setProperty('padding', `${baseBoxPadding * scaleFactor}cm`, 'important');
  };

  // Ajuster quand la synthèse change ou au montage
  $: if (executiveSummary && summaryBox && summaryContent) {
    tick().then(() => {
      adjustSummaryFontSize();
    });
  }

  // Ajuster la taille de police lors de l'impression
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeprint', () => {
      setTimeout(() => {
        adjustSummaryFontSize();
      }, 100);
    });
  }
</script>

<!-- Page de garde (visible uniquement en impression) -->
{#if selectedFolderId && executiveSummary}
  <div class="report-cover-page">
    <div class="report-cover-header">
      <h1 class="report-cover-title">{$_('dashboard.reportTitle')}</h1>
      <h2 class="report-cover-subtitle">{selectedFolderName || 'Dashboard'}</h2>
    </div>
    
    {#if executiveSummaryData.synthese_executive}
      <div class="report-cover-summary" bind:this={summaryBox}>
        <h3>{$_('dashboard.execSummary')}</h3>
        <div class="prose prose-slate max-w-none" bind:this={summaryContent}>
          <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
            {@html renderMarkdownWithRefs(executiveSummaryData.synthese_executive, executiveSummary?.references || [], {
              addListStyles: true,
              addHeadingStyles: true,
              listPadding: 1.5
            })}
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<section class="space-y-6 px-4 md:px-8 lg:px-16 xl:px-24 2xl:px-32 report-main-content">
  <div class="w-full print-hidden">
    <div class="grid grid-cols-12 items-start gap-4">
      <div class="col-span-8 min-w-0" data-comment-section="name">
        {#if selectedFolderId}
          {#if isDashboardReadOnly}
            <h1 class="text-3xl font-semibold mb-0 flex items-center gap-2 group">
              <span class="min-w-0 break-words">{selectedFolderName || 'Dashboard'}</span>
              <CommentBadge
                count={folderCommentCounts?.name ?? 0}
                on:click={() => openFolderComments('name')}
              />
            </h1>
          {:else}
            <h1 class="text-3xl font-semibold mb-0 flex items-center gap-2 group">
              <span class="min-w-0 flex-1 break-words">
                <EditableInput
                  label=""
                  value={editedFolderName}
                  markdown={false}
                  multiline={true}
                  apiEndpoint={`/folders/${selectedFolderId}`}
                  fullData={{ name: editedFolderName }}
                  changeId={`folder-name-${selectedFolderId}`}
                  originalValue={selectedFolderName || ''}
                  on:change={(e) => editedFolderName = e.detail.value}
                  on:saved={handleFolderNameSaved}
                />
              </span>
              <CommentBadge
                count={folderCommentCounts?.name ?? 0}
                on:click={() => openFolderComments('name')}
              />
            </h1>
          {/if}
        {:else}
          <h1 class="text-3xl font-semibold">{selectedFolderName || 'Dashboard'}</h1>
        {/if}
      </div>
      <div class="col-span-4 flex items-center justify-end gap-2 pt-1">
        {#if selectedFolderId}
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
        {/if}
        <FileMenu
          showNew={false}
          showImport={false}
          showExport={false}
          showDelete={false}
          showDownloadDocx={true}
          showPrint={true}
          labelDownloadDocx={dashboardDocxMenuLabel}
          disabledDownloadDocx={dashboardDocxActionDisabled}
          onDownloadDocx={handleDashboardDocxMenuAction}
          onPrint={() => window.print()}
          triggerTitle={$_('common.actions')}
          triggerAriaLabel={$_('common.actions')}
        />
        {#if showWorkspaceReadOnlyLock && !showPresenceBadge}
          <button
            class="rounded p-2 transition text-slate-400 cursor-not-allowed print-hidden"
            title={$_('dashboard.readOnlyGenerationDisabled')}
            aria-label={$_('dashboard.readOnlyGenerationDisabled')}
            type="button"
            disabled
          >
            <Lock class="w-5 h-5" />
          </button>
        {/if}
      </div>
    </div>
  </div>

  <!-- Synthèse exécutive (FIRST) - Masquée en impression (déjà sur la page de garde) -->
  {#if selectedFolderId}
    {#if isSummaryGenerating || isGeneratingSummary}
      <div class="rounded-lg border border-blue-200 bg-blue-50 p-6">
        <div class="flex items-center gap-3">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <div>
            <p class="text-sm font-medium text-blue-700">{$_('dashboard.execSummaryGenerating')}</p>
            <p class="text-xs text-blue-600 mt-1">{$_('dashboard.execSummaryGeneratingHint')}</p>
          </div>
        </div>
      </div>
    {:else if executiveSummary}
      <div data-comment-section="synthese_executive" class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-6 print-hidden">
        <div class="border-b border-slate-200 pb-4">
          <h2 class="text-2xl font-semibold text-slate-900 flex items-center gap-2 group">
            {$_('dashboard.execSummary')}
            <CommentBadge
              count={commentCounts?.synthese_executive ?? 0}
              title={`${$_('chat.tabs.comments')} - ${$_('dashboard.execSummary')}`}
              on:click={() => openExecutiveSummaryComments('synthese_executive')}
            />
          </h2>
        </div>
        
        {#if executiveSummaryData.synthese_executive}
          <EditableInput
            label=""
            value={executiveSummaryData.synthese_executive}
            markdown={true}
            locked={isDashboardReadOnly}
            apiEndpoint={selectedFolderId ? `/folders/${selectedFolderId}` : ''}
            fullData={getExecutiveSummaryPayload('synthese_executive')}
            fullDataGetter={() => getExecutiveSummaryPayload('synthese_executive')}
            changeId={selectedFolderId ? `exec-synthese-${selectedFolderId}` : ''}
            originalValue={getExecutiveSummaryOriginal('synthese_executive')}
            references={executiveSummary?.references || []}
            on:change={(e) => handleExecutiveSummaryFieldChange('synthese_executive', e.detail.value)}
            on:saved={(e) =>
              handleExecutiveSummarySaved(
                'synthese_executive',
                (e as CustomEvent<{ value?: string }>).detail?.value ??
                  executiveSummaryData.synthese_executive
              )}
          />
        {/if}
      </div>
    {:else if currentFolder}
      <div class="rounded-lg border border-slate-200 bg-slate-50 p-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold text-slate-900 mb-1">{$_('dashboard.execSummary')}</h2>
            <p class="text-sm text-slate-600">{$_('dashboard.execSummaryEmpty')}</p>
          </div>
          <button
            on:click={generateExecutiveSummary}
            disabled={isGeneratingSummary || isDashboardReadOnly}
            class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGeneratingSummary ? $_('dashboard.execSummaryGenerating') : $_('dashboard.execSummaryGenerate')}
          </button>
        </div>
      </div>
    {/if}
  {/if}

  {#if isLoading}
    <div class="rounded border border-blue-200 bg-blue-50 p-4">
      <div class="flex items-center gap-3">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
        <p class="text-sm text-blue-700 font-medium">{$_('dashboard.loadingData')}</p>
      </div>
    </div>
  {:else}
    <!-- Contenu fusionné : statistiques, graphique, introduction -->
    <!-- NOTE: le scatter plot doit être visible dès qu'un premier cas est disponible (même si le dossier / la synthèse sont en cours de génération). -->
    {#if selectedFolderId}
      <div class="report-introduction">
        <!-- Statistiques -->
        <div class="grid gap-4 md:grid-cols-2">
          <div class="rounded-lg bg-white p-4 shadow-sm border border-slate-200">
            <div class="flex items-center">
              <div class="flex-shrink-0">
                <FileText class="w-8 h-8 text-blue-500" />
              </div>
              <div class="ml-4">
                <p class="text-sm font-medium text-slate-500">{$_('dashboard.useCaseCount')}</p>
                <p class="text-2xl font-semibold text-slate-900">{stats.total}</p>
                {#if roiStats.count > 0}
                  <p class="text-xs text-green-600 mt-1">
                    {$_('dashboard.roiStats.medianValue')}: {roiStats.avgValue.toFixed(1)} {$_('common.pointsAbbr')} | {$_('dashboard.roiStats.medianComplexity')}: {roiStats.avgComplexity.toFixed(1)} {$_('common.pointsAbbr')}
                  </p>
                {/if}
              </div>
            </div>
          </div>

          {#if showROIQuadrant}
            <div class="rounded-lg bg-white p-4 shadow-sm border border-slate-200 border-green-300 bg-green-50">
              <div class="flex items-center">
                <div class="flex-shrink-0">
                  <TrendingUp class="w-8 h-8 text-green-600" />
                </div>
                <div class="ml-4 flex-1">
                  <p class="text-sm font-medium text-green-700">{$_('dashboard.quickWins')}</p>
                  <p class="text-2xl font-semibold text-green-600">{roiStats.count} cas</p>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <!-- Graphique scatter plot -->
        <div class="rounded-lg bg-white p-6 shadow-sm border border-slate-200 relative report-scatter-plot-container my-6">
          <!-- Accordéon de configuration en haut à droite -->
          <div class="absolute top-4 right-4 z-10">
            <div class="rounded-lg bg-white border border-slate-200 shadow-sm">
              <button
                on:click={() => configOpen = !configOpen}
                class="flex items-center justify-center p-2 hover:bg-slate-50 transition-colors rounded"
                title={$_('dashboard.roiConfig.buttonTitle')}
              >
                <Settings class="w-5 h-5 text-slate-500" />
                {#if valueThreshold !== null || complexityThreshold !== null}
                  <span class="ml-1 w-2 h-2 bg-primary rounded-full"></span>
                {/if}
              </button>
              
              {#if configOpen}
                <div class="absolute z-50 mt-2 right-0 w-96 rounded-lg bg-white border border-slate-200 shadow-lg p-4 space-y-4">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-sm font-medium text-slate-700">{$_('dashboard.roiQuadrantConfig')}</span>
                    <button
                      on:click={() => configOpen = false}
                      class="text-slate-400 hover:text-slate-600"
                      aria-label={$_('dashboard.roiConfig.close')}
                    >
                      <X class="w-5 h-5" />
                    </button>
                  </div>
                  <div class="grid gap-4 md:grid-cols-2">
                    <div>
                      <label for="value-threshold" class="block text-sm font-medium text-slate-700 mb-2">
                        {$_('dashboard.roiConfig.valueThreshold')}
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
                            const val = (e.target as HTMLInputElement)?.value || '';
                            valueThreshold = val === '' ? null : parseFloat(val);
                          }}
                          placeholder={medianValue.toFixed(1)}
                          class="flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          on:click={() => valueThreshold = null}
                          class="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                          title={$_('common.useMedian')}
                        >
                          {$_('common.median')} ({medianValue.toFixed(1)})
                        </button>
                      </div>
                      <p class="text-xs text-slate-500 mt-1">
                        {valueThreshold !== null
                          ? `${$_('dashboard.roiConfig.customThreshold')}: ${valueThreshold.toFixed(1)}`
                          : `${$_('dashboard.roiConfig.currentMedian')}: ${medianValue.toFixed(1)}`}
                      </p>
                    </div>
                    
                    <div>
                      <label for="complexity-threshold" class="block text-sm font-medium text-slate-700 mb-2">
                        {$_('dashboard.roiConfig.complexityThreshold')}
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
                            const val = (e.target as HTMLInputElement)?.value || '';
                            complexityThreshold = val === '' ? null : parseFloat(val);
                          }}
                          placeholder={medianComplexity.toFixed(1)}
                          class="flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          on:click={() => complexityThreshold = null}
                          class="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                          title={$_('common.useMedian')}
                        >
                          {$_('common.median')} ({medianComplexity.toFixed(1)})
                        </button>
                      </div>
                      <p class="text-xs text-slate-500 mt-1">
                        {complexityThreshold !== null
                          ? `${$_('dashboard.roiConfig.customThreshold')}: ${complexityThreshold.toFixed(1)}`
                          : `${$_('dashboard.roiConfig.currentMedian')}: ${medianComplexity.toFixed(1)}`}
                      </p>
                    </div>
                  </div>
                  
                  <div class="flex justify-end">
                    <button
                      on:click={resetToMedians}
                      class="text-sm text-slate-600 hover:text-slate-800 px-3 py-1 rounded hover:bg-slate-100 transition-colors"
                    >
                      {$_('dashboard.roiConfig.resetToMedians')}
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
          
          <div class="flex justify-center">
            <UseCaseScatterPlot 
              bind:this={scatterPlotRef}
              useCases={completedUseCases} 
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

        <!-- Introduction -->
        {#if executiveSummaryData.introduction}
          <div id="section-introduction" data-comment-section="introduction" class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm report-analyse report-analyse-with-break">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900 flex items-center gap-2 group">
                {$_('dashboard.introduction')}
                <CommentBadge
                  count={commentCounts?.introduction ?? 0}
                  title={`${$_('chat.tabs.comments')} - ${$_('dashboard.introduction')}`}
                  on:click={() => openExecutiveSummaryComments('introduction')}
                />
              </h2>
            </div>
            <div class="prose prose-slate max-w-none">
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                <EditableInput
                  label=""
                  value={executiveSummaryData.introduction}
                  markdown={true}
                  locked={isDashboardReadOnly}
                  apiEndpoint={selectedFolderId ? `/folders/${selectedFolderId}` : ''}
                  fullData={getExecutiveSummaryPayload('introduction')}
                  fullDataGetter={() => getExecutiveSummaryPayload('introduction')}
                  changeId={selectedFolderId ? `exec-intro-${selectedFolderId}` : ''}
                  originalValue={getExecutiveSummaryOriginal('introduction')}
                  references={executiveSummary?.references || []}
                  on:change={(e) => handleExecutiveSummaryFieldChange('introduction', e.detail.value)}
                  on:saved={(e) =>
                    handleExecutiveSummarySaved(
                      'introduction',
                      (e as CustomEvent<{ value?: string }>).detail?.value ??
                        executiveSummaryData.introduction
                    )}
                />
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Sommaire (page 3) -->
    {#if executiveSummary && selectedFolderId && !isSummaryGenerating}
      <div class="report-table-of-contents">
        <h2 class="text-2xl font-semibold text-slate-900 mb-6">{$_('dashboard.toc')}</h2>
        <ul class="space-y-2 text-slate-700">
          <li class="toc-item">
            <a href="#section-introduction" class="toc-title toc-link">{$_('dashboard.introduction')}</a>
            <span class="toc-dots"></span>
            <span class="toc-page">{pageNumbers.introduction || '-'}</span>
          </li>
          <li class="toc-item">
            <a href="#section-analyse" class="toc-title toc-link">{$_('dashboard.analysis')}</a>
            <span class="toc-dots"></span>
            <span class="toc-page">{pageNumbers.analyse || '-'}</span>
          </li>
          {#if executiveSummary.recommandation}
            <li class="toc-item">
              <a href="#section-recommandations" class="toc-title toc-link">{$_('dashboard.recommendations')}</a>
              <span class="toc-dots"></span>
              <span class="toc-page">{pageNumbers.recommandations || '-'}</span>
            </li>
          {/if}
          {#if executiveSummary.references && executiveSummary.references.length > 0}
            <li class="toc-item">
              <a href="#section-references" class="toc-title toc-link">{$_('dashboard.references')}</a>
              <span class="toc-dots"></span>
              <span class="toc-page">{pageNumbers.references || '-'}</span>
            </li>
          {/if}
          {#if filteredUseCases.length > 0}
            <li class="toc-item">
              <span class="toc-title">{$_('dashboard.annex')}</span>
              <span class="toc-dots"></span>
              <span class="toc-page">{pageNumbers.annexes || '-'}</span>
            </li>
            {#each useCasePages as useCasePage}
              <li class="toc-item toc-item-nested">
                <a href="#usecase-{useCasePage.id || ''}" class="toc-title toc-link">{useCasePage.name}</a>
                <span class="toc-dots"></span>
                <span class="toc-page">{useCasePage.page}</span>
              </li>
            {/each}
          {/if}
        </ul>
      </div>
    {/if}

    <!-- Analyse, Recommandations, Références (après l'introduction) -->
    {#if executiveSummary && selectedFolderId && !isSummaryGenerating}
      <div class="space-y-6">

        {#if executiveSummaryData.analyse}
          <div id="section-analyse" data-comment-section="analyse" class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm report-analyse report-analyse-with-break">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900 flex items-center gap-2 group">
                {$_('dashboard.analysis')}
                <CommentBadge
                  count={commentCounts?.analyse ?? 0}
                  title={`${$_('chat.tabs.comments')} - ${$_('dashboard.analysis')}`}
                  on:click={() => openExecutiveSummaryComments('analyse')}
                />
              </h2>
            </div>
            <div class="prose prose-slate max-w-none">
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                <EditableInput
                  label=""
                  value={executiveSummaryData.analyse}
                  markdown={true}
                  locked={isDashboardReadOnly}
                  apiEndpoint={selectedFolderId ? `/folders/${selectedFolderId}` : ''}
                  fullData={getExecutiveSummaryPayload('analyse')}
                  fullDataGetter={() => getExecutiveSummaryPayload('analyse')}
                  changeId={selectedFolderId ? `exec-analyse-${selectedFolderId}` : ''}
                  originalValue={getExecutiveSummaryOriginal('analyse')}
                  references={executiveSummary?.references || []}
                  on:change={(e) => handleExecutiveSummaryFieldChange('analyse', e.detail.value)}
                  on:saved={(e) =>
                    handleExecutiveSummarySaved(
                      'analyse',
                      (e as CustomEvent<{ value?: string }>).detail?.value ??
                        executiveSummaryData.analyse
                    )}
                />
              </div>
            </div>
          </div>
        {/if}

        {#if executiveSummaryData.recommandation}
          <div id="section-recommandations" data-comment-section="recommandation" class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm report-analyse report-analyse-with-break">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900 flex items-center gap-2 group">
                {$_('dashboard.recommendations')}
                <CommentBadge
                  count={commentCounts?.recommandation ?? 0}
                  title={`${$_('chat.tabs.comments')} - ${$_('dashboard.recommendations')}`}
                  on:click={() => openExecutiveSummaryComments('recommandation')}
                />
              </h2>
            </div>
            <div class="prose prose-slate max-w-none">
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                <EditableInput
                  label=""
                  value={executiveSummaryData.recommandation}
                  markdown={true}
                  locked={isDashboardReadOnly}
                  apiEndpoint={selectedFolderId ? `/folders/${selectedFolderId}` : ''}
                  fullData={getExecutiveSummaryPayload('recommandation')}
                  fullDataGetter={() => getExecutiveSummaryPayload('recommandation')}
                  changeId={selectedFolderId ? `exec-recommandation-${selectedFolderId}` : ''}
                  originalValue={getExecutiveSummaryOriginal('recommandation')}
                  references={executiveSummary?.references || []}
                  on:change={(e) => handleExecutiveSummaryFieldChange('recommandation', e.detail.value)}
                  on:saved={(e) =>
                    handleExecutiveSummarySaved(
                      'recommandation',
                      (e as CustomEvent<{ value?: string }>).detail?.value ??
                        executiveSummaryData.recommandation
                    )}
                />
              </div>
            </div>
          </div>
        {/if}

        {#if executiveSummary.references && executiveSummary.references.length > 0}
          <div id="section-references" data-comment-section="references" class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm report-analyse">
            <div class="border-b border-slate-200 pb-4 mb-4">
              <h2 class="text-2xl font-semibold text-slate-900 flex items-center gap-2 group">
                {$_('dashboard.references')}
                <CommentBadge
                  count={commentCounts?.references ?? 0}
                  title={`${$_('chat.tabs.comments')} - ${$_('dashboard.references')}`}
                  on:click={() => openExecutiveSummaryComments('references')}
                />
              </h2>
            </div>
            <References references={executiveSummary.references} />
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<!-- Page de séparation pour les annexes (visible uniquement en impression) -->
{#if selectedFolderId && filteredUseCases.length > 0}
  <div class="report-cover-page">
    <div class="report-cover-header">
      <h1 class="report-cover-title">{$_('dashboard.annex')}</h1>
      <h2 class="report-cover-subtitle">{$_('dashboard.annexUseCases')}</h2>
    </div>
  </div>
{/if}

<!-- Section Annexes (tous les usecases du dossier) -->
<section class="hidden print:block">
  {#if selectedFolderId && filteredUseCases.length > 0}
        {#each filteredUseCases as useCase, index (useCase.id)}
        <section 
          id="usecase-{useCase.id}" 
          class="space-y-6 usecase-annex-section {index === 23 ? 'force-page-break-before' : ''}" 
          data-usecase-id={useCase.id} 
          data-usecase-title={useCase?.data?.name || useCase?.name || $_('usecase.useCase')}>
            <UseCaseDetail
              useCase={useCase}
              matrix={matrix}
              calculatedScores={useCaseScoresMap.get(useCase.id) || null}
              isEditing={false}
              locked={isDashboardReadOnly}
            />
        </section>
        {/each}
    {/if}
</section>


<!-- Back cover -->
<div class="report-cover-page">
  <div class="report-cover-header">
    <h1 class="report-cover-title">Top AI Ideas</h1>
    <h2 class="report-cover-subtitle">{$_('dashboard.subtitle')}</h2>
  </div>
  <div class="report-cover-summary">
    <h3>{$_('dashboard.about')}</h3>
    <div class="prose prose-slate max-w-none">
      <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
        <p>
          {$_('dashboard.backCover.p1')}
        </p>
        <p>
          {$_('dashboard.backCover.p2')}
        </p>
        <p>
          {$_('dashboard.backCover.p3')}
        </p>
      </div>
    </div>
  </div>
</div>
