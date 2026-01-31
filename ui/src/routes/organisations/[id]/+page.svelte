<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { organizationsStore, fetchOrganizationById, deleteOrganization, type Organization } from '$lib/stores/organizations';
  import { goto } from '$app/navigation';
  import { API_BASE_URL } from '$lib/config';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import { streamHub } from '$lib/stores/streamHub';
  import { addToast } from '$lib/stores/toast';
  import References from '$lib/components/References.svelte';
  import DocumentsBlock from '$lib/components/DocumentsBlock.svelte';
  import OrganizationForm from '$lib/components/OrganizationForm.svelte';
  import CommentBadge from '$lib/components/CommentBadge.svelte';
  import LockPresenceBadge from '$lib/components/LockPresenceBadge.svelte';
  import { workspaceReadOnlyScope, workspaceScopeHydrated, selectedWorkspaceRole, workspaceScope } from '$lib/stores/workspaceScope';
  import { session } from '$lib/stores/session';
  import { acceptUnlock, acquireLock, fetchLock, forceUnlock, releaseLock, requestUnlock, sendPresence, fetchPresence, leavePresence, type LockSnapshot, type PresenceUser } from '$lib/utils/object-lock';
  import { listComments } from '$lib/utils/comments';
  import { Trash2, Lock } from '@lucide/svelte';

  let organization: Organization | null = null;
  let error = '';
  let organizationId: string | null = null;
  let hubKey: string | null = null;
  let lastOrganizationIdForCounts: string | null = null;
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
  let commentCounts: Record<string, number> = {};
  let workspaceId: string | null = null;
  let commentUserId: string | null = null;
  let lastCommentCountsKey = '';
  let commentCountsLoading = false;
  let commentCountsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let commentCountsRetryAttempts = 0;
  let commentReloadTimer: ReturnType<typeof setTimeout> | null = null;
  $: canDelete = $workspaceScopeHydrated && !$workspaceReadOnlyScope && !isLockedByOther;
  $: showReadOnlyLock = $workspaceScopeHydrated && $workspaceReadOnlyScope;
  $: isWorkspaceAdmin = $selectedWorkspaceRole === 'admin';
  $: isLockedByMe = !!lock && lock.lockedBy.userId === $session.user?.id;
  $: isLockedByOther = !!lock && lock.lockedBy.userId !== $session.user?.id;
  $: lockOwnerLabel = lock?.lockedBy?.displayName || lock?.lockedBy?.email || 'Utilisateur';
  $: lockRequestedByMe = !!lock && lock.unlockRequestedByUserId === $session.user?.id;
  $: isReadOnlyRole = $workspaceReadOnlyScope;
  $: showPresenceBadge = lockLoading || lockError || !!lock || presenceUsers.length > 0 || presenceTotal > 0;
  let lastReadOnlyRole = isReadOnlyRole;
  const LOCK_REFRESH_MS = 10 * 1000;

  const fixMarkdownLineBreaks = (text: string | null | undefined): string => {
    if (!text) return '';
    return text.replace(/\n/g, '\n\n');
  };

  $: organizationData = organization
    ? {
        name: organization.name,
        industry: organization.industry,
        size: organization.size,
        technologies: fixMarkdownLineBreaks(organization.technologies),
        products: fixMarkdownLineBreaks(organization.products),
        processes: fixMarkdownLineBreaks(organization.processes),
        kpis: fixMarkdownLineBreaks(organization.kpis),
        challenges: fixMarkdownLineBreaks(organization.challenges),
        objectives: fixMarkdownLineBreaks(organization.objectives),
      }
    : {};

  $: organizationId = $page.params.id;
  $: workspaceId = $workspaceScope.selectedId ?? null;
  $: commentUserId = $session.user?.id ?? null;

  const subscribeLock = (organizationId: string) => {
    if (lockHubKey) streamHub.delete(lockHubKey);
    lockHubKey = `lock:organization:${organizationId}`;
    streamHub.set(lockHubKey, (evt: any) => {
      if (evt?.type === 'lock_update') {
        if (evt.objectType !== 'organization') return;
        if (evt.objectId !== organizationId) return;
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
        if (evt.objectType !== 'organization') return;
        if (evt.objectId !== organizationId) return;
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

  onMount(() => {
    void loadOrganization();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('beforeunload', handleLeave);

    if (organizationId) {
      setupOrganizationHub(organizationId);
      lastOrganizationIdForCounts = organizationId;
    }
    hasMounted = true;
  });

  const handleOrganizationHubEvent = (evt: any, currentId: string) => {
    if (evt?.type === 'organization_update') {
      const id: string = evt.organizationId;
      const data: any = evt.data ?? {};
      if (!id || id !== currentId) return;
      if (data?.deleted) return;
      if (data?.organization) {
        const updated = data.organization;
        organization = { ...(organization || ({} as any)), ...updated };
      }
      return;
    }
    if (evt?.type === 'comment_update') {
      if (evt.contextType !== 'organization' || evt.contextId !== currentId) return;
      scheduleCommentReload();
    }
  };

  const setupOrganizationHub = (currentId: string) => {
    if (hubKey) streamHub.delete(hubKey);
    hubKey = `organizationDetail:${currentId}`;
    streamHub.set(hubKey, (evt: any) => handleOrganizationHubEvent(evt, currentId));
  };

  onDestroy(() => {
    if (commentCountsRetryTimer) clearTimeout(commentCountsRetryTimer);
    if (hubKey) streamHub.delete(hubKey);
    if (lockHubKey) streamHub.delete(lockHubKey);
    if (lockRefreshTimer) clearInterval(lockRefreshTimer);
    if (lockTargetId) void leavePresence('organization', lockTargetId);
    void releaseCurrentLock();
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handleLeave);
    window.removeEventListener('beforeunload', handleLeave);
  });

  $: if (hasMounted && organizationId && organizationId !== lastOrganizationIdForCounts) {
    lastOrganizationIdForCounts = organizationId;
    void loadOrganization();
    setupOrganizationHub(organizationId);
  }

  $: if (organizationId && organizationId !== lockTargetId) {
    if (lockTargetId) {
      void leavePresence('organization', lockTargetId);
      void releaseCurrentLock();
    }
    lock = null;
    presenceUsers = [];
    presenceTotal = 0;
    lockTargetId = organizationId;
    subscribeLock(lockTargetId);
    void syncLock();
    void hydratePresence();
    void updatePresence();
  }

  const loadOrganization = async () => {
    if (!organizationId) return;

    try {
      organization = await fetchOrganizationById(organizationId);
      error = '';
      unsavedChangesStore.reset();
      await loadCommentCounts();
      return;
    } catch {
      const organizations = $organizationsStore;
      organization = organizations.find((o) => o.id === organizationId) || null;
      if (!organization) {
        error = "Erreur lors du chargement de l'organisation";
        return;
      }
      error = '';
      unsavedChangesStore.reset();
      await loadCommentCounts();
    }
  };

  const canLoadCommentCounts = () =>
    Boolean(organizationId && workspaceId && commentUserId && !$session.loading);

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
      const res = await listComments({ contextType: 'organization', contextId: organizationId });
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

  $: if (organizationId && workspaceId && commentUserId && !$session.loading) {
    const key = `${organizationId}:${workspaceId}:${commentUserId}`;
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
    const detail = { contextType: 'organization', contextId: organizationId, sectionKey };
    window.dispatchEvent(new CustomEvent('topai:open-comments', { detail }));
  };

  const syncLock = async () => {
    if (!lockTargetId) return;
    lockLoading = true;
    lockError = null;
    try {
      if (isReadOnlyRole) {
        lock = await fetchLock('organization', lockTargetId);
      } else {
        const res = await acquireLock('organization', lockTargetId);
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
      const res = await acquireLock('organization', lockTargetId);
      lock = res.lock;
    } catch {
      // ignore refresh errors
    }
  };

  const releaseCurrentLock = async () => {
    if (!lockTargetId || !isLockedByMe) return;
    try {
      await releaseLock('organization', lockTargetId);
    } catch {
      // ignore release errors
    }
  };

  const handleRequestUnlock = async () => {
    if (!lockTargetId) return;
    try {
      const res = await requestUnlock('organization', lockTargetId);
      lock = res.lock;
      addToast({ type: 'success', message: 'Demande de déverrouillage envoyée' });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur demande de déverrouillage' });
    }
  };

  const handleForceUnlock = async () => {
    if (!lockTargetId) return;
    try {
      await forceUnlock('organization', lockTargetId);
      addToast({ type: 'success', message: 'Verrou forcé' });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur forçage verrou' });
    }
  };

  const handleReleaseLock = async () => {
    if (!lockTargetId) return;
    if (lock?.unlockRequestedByUserId) {
      suppressAutoLock = true;
      await acceptUnlock('organization', lockTargetId);
      return;
    }
    suppressAutoLock = true;
    await releaseCurrentLock();
  };

  const hydratePresence = async () => {
    if (!lockTargetId) return;
    try {
      const res = await fetchPresence('organization', lockTargetId);
      presenceTotal = res.total;
      presenceUsers = res.users.filter((u) => u.userId !== $session.user?.id);
    } catch {
      // ignore
    }
  };

  const updatePresence = async () => {
    if (!lockTargetId) return;
    try {
      const res = await sendPresence('organization', lockTargetId);
      presenceTotal = res.total;
      presenceUsers = res.users.filter((u) => u.userId !== $session.user?.id);
    } catch {
      // ignore
    }
  };

  const handleVisibility = () => {
    if (!lockTargetId) return;
    if (document.hidden) {
      void leavePresence('organization', lockTargetId);
    } else {
      void updatePresence();
    }
  };

  const handleLeave = () => {
    if (!lockTargetId) return;
    void leavePresence('organization', lockTargetId);
  };


  $: if (isReadOnlyRole !== lastReadOnlyRole) {
    lastReadOnlyRole = isReadOnlyRole;
    if (isReadOnlyRole) {
      void releaseCurrentLock();
      void syncLock();
    } else {
      void syncLock();
    }
  }

  const handleFieldUpdate = (field: string, value: string) => {
    if (!organization) return;
    organization = { ...organization, [field]: value };
    organizationData = { ...organizationData, [field]: value };
  };

  const handleDelete = async () => {
    if (!organization) return;
    if (!canDelete) return;

    if (!confirm("Êtes-vous sûr de vouloir supprimer cette organisation ?")) return;

    try {
      await deleteOrganization(organization.id);
      unsavedChangesStore.reset();
      goto('/organisations');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Erreur lors de la suppression';
    }
  };
</script>

{#if error}
  <div class="rounded bg-red-50 border border-red-200 p-4 text-red-700 mb-6">
    {error}
  </div>
{/if}

{#if organization}
  <OrganizationForm
    organization={organization as any}
    {organizationData}
    apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
    locked={isLockedByOther || isReadOnlyRole}
    onFieldUpdate={(field, value) => handleFieldUpdate(field, value)}
    showKpis={true}
    nameLabel=""
    {commentCounts}
    onOpenComments={openCommentsFor}
  >
    <div slot="actions" class="flex items-center gap-2">
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
        canRequestUnlock={!isReadOnlyRole}
        showHeaderLock={!isLockedByMe}
        on:requestUnlock={handleRequestUnlock}
        on:forceUnlock={handleForceUnlock}
        on:releaseLock={handleReleaseLock}
      />
      {#if canDelete}
        <button
          class="rounded p-2 transition text-warning hover:bg-slate-100"
          title="Supprimer"
          aria-label="Supprimer"
          on:click={handleDelete}
        >
          <Trash2 class="w-5 h-5" />
        </button>
      {:else if showReadOnlyLock && !showPresenceBadge}
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

    <div slot="underHeader">
      <DocumentsBlock contextType="organization" contextId={organization.id} />
    </div>

    <div slot="bottom">
      <!-- Références (lecture seule, en fin de page) -->
      {#if organization.references && organization.references.length > 0}
        <div class="rounded border border-slate-200 bg-white p-4" data-comment-section="references">
          <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
            <h3 class="font-semibold flex items-center gap-2 group">
              Références
              <CommentBadge
                count={commentCounts?.references ?? 0}
                disabled={!openCommentsFor}
                on:click={() => openCommentsFor('references')}
              />
            </h3>
          </div>
          <References references={organization.references} referencesScaleFactor={1} />
        </div>
      {/if}
    </div>
  </OrganizationForm>
  <!-- Commentaires gérés par ChatWidget -->
{:else if !error}
  <div class="text-center py-12">
    <p class="text-slate-500">Chargement...</p>
  </div>
{/if}


