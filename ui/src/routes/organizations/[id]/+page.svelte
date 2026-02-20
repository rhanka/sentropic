<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import {
    organizationsStore,
    fetchOrganizationById,
    deleteOrganization,
    type Organization,
    openOrganizationExport,
    closeOrganizationExport,
    organizationExportState,
  } from '$lib/stores/organizations';
  import { goto } from '$app/navigation';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import { streamHub } from '$lib/stores/streamHub';
  import { addToast } from '$lib/stores/toast';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import References from '$lib/components/References.svelte';
  import DocumentsBlock from '$lib/components/DocumentsBlock.svelte';
  import OrganizationForm from '$lib/components/OrganizationForm.svelte';
  import type { OrgField } from '$lib/components/organization-form.types';
  import CommentBadge from '$lib/components/CommentBadge.svelte';
  import LockPresenceBadge from '$lib/components/LockPresenceBadge.svelte';
  import FileMenu from '$lib/components/FileMenu.svelte';
  import ImportExportDialog from '$lib/components/ImportExportDialog.svelte';
  import { workspaceReadOnlyScope, workspaceScopeHydrated, selectedWorkspaceRole, workspaceScope } from '$lib/stores/workspaceScope';
  import { session } from '$lib/stores/session';
  import { acceptUnlock, acquireLock, fetchLock, forceUnlock, releaseLock, requestUnlock, sendPresence, fetchPresence, leavePresence, type LockSnapshot, type PresenceUser } from '$lib/utils/object-lock';
  import { listComments } from '$lib/utils/comments';
  import { buildOpenCommentCounts } from '$lib/utils/comment-counts';
  import { fetchFolders } from '$lib/stores/folders';
  import { Lock } from '@lucide/svelte';
  import { normalizeMarkdownLineEndings } from '$lib/utils/markdown';

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
  let hasDocuments = false;
  let organizationFolderCount = 0;
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
  const ORGA_DEBUG_STORAGE_KEY = 'topai:debug:orga-loop';

  const ORG_FIELDS: OrgField[] = [
    'name',
    'industry',
    'size',
    'technologies',
    'products',
    'processes',
    'challenges',
    'objectives',
    'kpis',
  ];
  const MARKDOWN_FIELDS = new Set<OrgField>([
    'size',
    'technologies',
    'products',
    'processes',
    'challenges',
    'objectives',
    'kpis',
  ]);

  const emptyFieldRecord = (): Record<OrgField, string> => ({
    name: '',
    industry: '',
    size: '',
    technologies: '',
    products: '',
    processes: '',
    challenges: '',
    objectives: '',
    kpis: '',
  });

  let organizationData: Record<OrgField, string> = emptyFieldRecord();
  let fieldBuffers: Record<OrgField, string> = emptyFieldRecord();
  let fieldOriginals: Record<OrgField, string> = emptyFieldRecord();
  let lastOrganizationDataId: string | null = null;
  let orgaDebugEnabled = false;

  const refreshOrgaDebugFlag = () => {
    if (typeof window === 'undefined') {
      orgaDebugEnabled = false;
      return;
    }
    orgaDebugEnabled = window.localStorage.getItem(ORGA_DEBUG_STORAGE_KEY) === '1';
  };

  const logOrgaDebug = (event: string, details: Record<string, unknown> = {}) => {
    if (!orgaDebugEnabled) return;
    const now = new Date().toISOString();
    console.debug(`[ORGA-LOOP][${now}] ${event}`, details);
  };

  const formatFieldForEditor = (field: OrgField, value: unknown): string => {
    const text = typeof value === 'string' ? value : value == null ? '' : String(value);
    return MARKDOWN_FIELDS.has(field) ? normalizeMarkdownLineEndings(text) : text;
  };

  const normalizeOrganizationFields = (source: Organization | null | undefined): Record<OrgField, string> => {
    const base = emptyFieldRecord();
    if (!source) return base;
    for (const field of ORG_FIELDS) {
      base[field] = formatFieldForEditor(field, (source as Record<string, unknown>)[field]);
    }
    return base;
  };

  const getChangedOrgFields = (
    previous: Record<OrgField, string>,
    next: Record<OrgField, string>
  ): OrgField[] => {
    return ORG_FIELDS.filter((field) => previous[field] !== next[field]);
  };

  const applyOrganizationSnapshot = (
    source: Organization | null | undefined,
    origin: 'load' | 'sse' | 'local'
  ) => {
    const incoming = normalizeOrganizationFields(source);
    if (!source?.id || source.id !== lastOrganizationDataId) {
      lastOrganizationDataId = source?.id ?? null;
      fieldBuffers = { ...incoming };
      fieldOriginals = { ...incoming };
      organizationData = { ...incoming };
      logOrgaDebug('snapshot.reset', {
        origin,
        organizationId: source?.id ?? null,
      });
      return;
    }

    const nextBuffers = { ...fieldBuffers };
    const nextOriginals = { ...fieldOriginals };
    const changedByServer: OrgField[] = [];

    for (const field of ORG_FIELDS) {
      if (incoming[field] !== fieldOriginals[field]) {
        nextBuffers[field] = incoming[field];
        nextOriginals[field] = incoming[field];
        changedByServer.push(field);
      }
    }

    if (changedByServer.length > 0) {
      fieldBuffers = nextBuffers;
      fieldOriginals = nextOriginals;
    }
    organizationData = { ...nextBuffers };
    logOrgaDebug('snapshot.merge', {
      origin,
      organizationId: source?.id ?? null,
      changedByServer,
    });
  };

  $: organizationId = $page.params.id;
  $: workspaceId = $workspaceScope.selectedId ?? null;
  $: commentUserId = $session.user?.id ?? null;
  $: workspaceName =
    ($workspaceScope.items || []).find((w) => w.id === $workspaceScope.selectedId)?.name ?? '';
  $: commentsTotal = Object.values(commentCounts).reduce((sum, v) => sum + v, 0);

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

  onMount(async () => {
    refreshOrgaDebugFlag();
    void loadOrganization();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('beforeunload', handleLeave);

    if (organizationId) {
      setupOrganizationHub(organizationId);
      lastOrganizationIdForCounts = organizationId;
    }
    if (organizationId) {
      try {
        const folders = await fetchFolders({ organizationId });
        organizationFolderCount = folders.length;
      } catch (error) {
        console.error('Failed to load folders:', error);
      }
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
        const previous = normalizeOrganizationFields(organization as Organization);
        const nextOrganization = { ...(organization || ({} as any)), ...updated } as Organization;
        organization = nextOrganization;
        organizationsStore.update((items) => {
          const idx = items.findIndex((o) => o.id === currentId);
          if (idx === -1) return [nextOrganization, ...items];
          const nextItems = [...items];
          nextItems[idx] = { ...nextItems[idx], ...updated };
          return nextItems;
        });
        const next = normalizeOrganizationFields(nextOrganization);
        applyOrganizationSnapshot(nextOrganization, 'sse');
        logOrgaDebug('sse.organization_update', {
          organizationId: currentId,
          changedFields: getChangedOrgFields(previous, next),
          payloadKeys: Object.keys(updated || {}),
        });
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
      applyOrganizationSnapshot(organization as Organization, 'load');
      logOrgaDebug('loadOrganization.success', {
        organizationId,
      });
      error = '';
      unsavedChangesStore.reset();
      await loadCommentCounts();
      return;
    } catch {
      const organizations = $organizationsStore;
      organization = organizations.find((o) => o.id === organizationId) || null;
      if (!organization) {
        error = get(_)('organizations.errors.load');
        return;
      }
      applyOrganizationSnapshot(organization as Organization, 'load');
      logOrgaDebug('loadOrganization.fallback', {
        organizationId,
      });
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
      const res = await listComments({ contextType: 'organization', contextId: organizationId! });
      commentCounts = buildOpenCommentCounts(res.items || []);
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
      addToast({ type: 'success', message: get(_)('locks.unlockRequestSent') });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? get(_)('locks.unlockRequestError') });
    }
  };

  const handleForceUnlock = async () => {
    if (!lockTargetId) return;
    try {
      await forceUnlock('organization', lockTargetId);
      addToast({ type: 'success', message: get(_)('locks.lockForced') });
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? get(_)('locks.lockForceError') });
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

  const handleFieldUpdate = (field: OrgField, value: string) => {
    fieldBuffers = { ...fieldBuffers, [field]: value };
    organizationData = { ...fieldBuffers };
    logOrgaDebug('field.change', {
      organizationId,
      field,
      valueLength: value.length,
    });
  };

  const getFieldPayload = (field: OrgField): Record<string, unknown> => {
    const payload = { [field]: fieldBuffers[field] };
    logOrgaDebug('field.payload', {
      organizationId,
      field,
      payloadKeys: Object.keys(payload),
      valueLength: String(payload[field] ?? '').length,
    });
    return payload;
  };

  const getFieldOriginal = (field: OrgField): string => {
    return fieldOriginals[field] || '';
  };

  const handleFieldSaved = (field: OrgField, value: string) => {
    fieldOriginals = { ...fieldOriginals, [field]: value };
    organizationData = { ...fieldBuffers };
    if (organization) {
      organization = { ...organization, [field]: value };
      organizationsStore.update((items) =>
        items.map((o) => (o.id === organization?.id ? { ...o, [field]: value } : o))
      );
    }
    logOrgaDebug('field.saved', {
      organizationId,
      field,
      valueLength: value.length,
    });
  };

  const handleDelete = async () => {
    if (!organization) return;
    if (!canDelete) return;

    if (!confirm($_('organizations.confirmDelete'))) return;

    try {
      await deleteOrganization(organization.id);
      unsavedChangesStore.reset();
      goto('/organizations');
    } catch (err) {
      error = err instanceof Error ? err.message : $_('organizations.deleteError');
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
    organization={organization}
    {organizationData}
    apiEndpoint={`/organizations/${organization.id}`}
    locked={isLockedByOther || isReadOnlyRole}
    onFieldUpdate={handleFieldUpdate}
    onFieldSaved={handleFieldSaved}
    getFieldPayload={getFieldPayload}
    getFieldOriginal={getFieldOriginal}
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
      <FileMenu
        showNew={false}
        showImport={false}
        showExport={true}
        showPrint={false}
        showDelete={canDelete}
        disabledImport={isReadOnlyRole}
        disabledExport={isReadOnlyRole}
        onExport={() => organization && openOrganizationExport(organization.id)}
        onDelete={handleDelete}
        triggerTitle={$_('common.actions')}
        triggerAriaLabel={$_('common.actions')}
      />
	      {#if !canDelete && showReadOnlyLock && !showPresenceBadge}
	        <button
	          class="rounded p-2 transition text-slate-400 cursor-not-allowed"
	          title={$_('common.readOnlyDisabled')}
	          aria-label={$_('common.readOnlyDisabled')}
	          type="button"
	          disabled
	        >
          <Lock class="w-5 h-5" />
        </button>
      {/if}
    </div>

    <div slot="underHeader">
      <DocumentsBlock
        contextType="organization"
        contextId={organization.id}
        on:state={(event) => {
          hasDocuments = (event.detail?.items || []).length > 0;
        }}
      />
    </div>

    <div slot="bottom">
	      <!-- References (read-only, end of page) -->
      {#if organization.references && organization.references.length > 0}
        <div class="rounded border border-slate-200 bg-white p-4" data-comment-section="references">
          <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
	            <h3 class="font-semibold flex items-center gap-2 group">
	              {$_('common.references')}
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
    <p class="text-slate-500">{$_('common.loading')}</p>
  </div>
{/if}

{#if organization}
  <ImportExportDialog
    bind:open={$organizationExportState.open}
    mode="export"
    title={$_('organizations.export.singleTitle')}
    scope="organization"
    scopeId={$organizationExportState.organizationId ?? organization.id}
    allowScopeSelect={false}
    allowScopeIdEdit={false}
    workspaceName={workspaceName}
    objectName={organization?.name || ''}
    commentsAvailable={commentsTotal > 0}
    documentsAvailable={hasDocuments}
    includeOptions={
      organizationFolderCount > 0
        ? [{ id: 'folders', label: $_('organizations.export.include.folders'), defaultChecked: false }]
        : []
    }
    includeAffectsComments={['folders']}
    includeAffectsDocuments={['folders']}
    on:close={closeOrganizationExport}
  />
{/if}
