<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { fetchOrganizations, fetchOrganizationById, deleteOrganization, type Organization } from '$lib/stores/organizations';
  import { goto } from '$app/navigation';
  import { API_BASE_URL } from '$lib/config';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import { streamHub } from '$lib/stores/streamHub';
  import { addToast } from '$lib/stores/toast';
  import References from '$lib/components/References.svelte';
  import DocumentsBlock from '$lib/components/DocumentsBlock.svelte';
  import OrganizationForm from '$lib/components/OrganizationForm.svelte';
  import LockPresenceBadge from '$lib/components/LockPresenceBadge.svelte';
  import { adminReadOnlyScope } from '$lib/stores/adminWorkspaceScope';
  import { workspaceReadOnlyScope, workspaceScopeHydrated, selectedWorkspaceRole } from '$lib/stores/workspaceScope';
  import { session } from '$lib/stores/session';
  import { acquireLock, fetchLock, forceUnlock, releaseLock, requestUnlock, type LockSnapshot } from '$lib/utils/object-lock';
  import { Trash2, Lock } from '@lucide/svelte';

  let organization: Organization | null = null;
  let error = '';
  let lastLoadedId: string | null = null;
  let hubKey: string | null = null;
  let lockHubKey: string | null = null;
  let lockRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let lockTargetId: string | null = null;
  let lock: LockSnapshot | null = null;
  let lockLoading = false;
  let lockError: string | null = null;
  $: canDelete = !$adminReadOnlyScope && $workspaceScopeHydrated && !$workspaceReadOnlyScope && !isLockedByOther;
  $: showReadOnlyLock = $adminReadOnlyScope || ($workspaceScopeHydrated && $workspaceReadOnlyScope);
  $: isWorkspaceAdmin = $selectedWorkspaceRole === 'admin';
  $: isLockedByMe = !!lock && lock.lockedBy.userId === $session.user?.id;
  $: isLockedByOther = !!lock && lock.lockedBy.userId !== $session.user?.id;
  $: lockOwnerLabel = lock?.lockedBy?.displayName || lock?.lockedBy?.email || 'Utilisateur';
  $: lockRequestedByMe = !!lock && lock.unlockRequestedByUserId === $session.user?.id;
  const LOCK_REFRESH_MS = 10 * 60 * 1000;

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

  const subscribeOrganization = (organizationId: string) => {
    if (hubKey) streamHub.delete(hubKey);
    hubKey = `organizationDetail:${organizationId}`;
    streamHub.set(hubKey, (evt: any) => {
      if (evt?.type !== 'organization_update') return;
      const id: string = evt.organizationId;
      const data: any = evt.data ?? {};
      if (!id || id !== organizationId) return;
      if (data?.deleted) return;
      if (data?.organization) {
        const updated = data.organization;
        organization = { ...(organization || ({} as any)), ...updated };
      }
    });
  };

  const subscribeLock = (organizationId: string) => {
    if (lockHubKey) streamHub.delete(lockHubKey);
    lockHubKey = `lock:organization:${organizationId}`;
    streamHub.set(lockHubKey, (evt: any) => {
      if (evt?.type !== 'lock_update') return;
      if (evt.objectType !== 'organization') return;
      if (evt.objectId !== organizationId) return;
      lock = evt?.data?.lock ?? null;
      if (!lock && !$adminReadOnlyScope && !$workspaceReadOnlyScope) {
        void syncLock();
      }
    });
  };

  onMount(async () => {
    await loadOrganization();
  });

  onDestroy(() => {
    if (hubKey) streamHub.delete(hubKey);
    if (lockHubKey) streamHub.delete(lockHubKey);
    if (lockRefreshTimer) clearInterval(lockRefreshTimer);
    void releaseCurrentLock();
  });

  $: if ($page.params.id && $page.params.id !== lastLoadedId) {
    loadOrganization();
  }

  const loadOrganization = async () => {
    const organizationId = $page.params.id;
    if (!organizationId) return;
    if (lastLoadedId === organizationId) return;

    try {
      if (lockTargetId && lockTargetId !== organizationId) {
        void releaseCurrentLock();
        lock = null;
        lockTargetId = null;
      }
      lastLoadedId = organizationId;
      organization = await fetchOrganizationById(organizationId);
      subscribeOrganization(organizationId);
      subscribeLock(organizationId);
      lockTargetId = organizationId;
      void syncLock();
      error = '';
      unsavedChangesStore.reset();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
      try {
        organization = await fetchOrganizationById(organizationId);
        subscribeOrganization(organizationId);
        subscribeLock(organizationId);
        lockTargetId = organizationId;
        void syncLock();
        error = '';
        return;
      } catch {
        try {
          const organizations = await fetchOrganizations();
          organization = organizations.find((o) => o.id === organizationId) || null;
          error = organization ? '' : 'Organisation non trouvée';
          unsavedChangesStore.reset();
        } catch {
          error = "Erreur lors du chargement de l'organisation";
        }
      }
    }
  };

  const syncLock = async () => {
    if (!lockTargetId) return;
    lockLoading = true;
    lockError = null;
    try {
      if ($adminReadOnlyScope || $workspaceReadOnlyScope) {
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
    locked={isLockedByOther}
    onFieldUpdate={(field, value) => handleFieldUpdate(field, value)}
    showKpis={true}
    nameLabel=""
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
        on:requestUnlock={handleRequestUnlock}
        on:forceUnlock={handleForceUnlock}
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
      {:else if showReadOnlyLock}
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
        <div class="rounded border border-slate-200 bg-white p-4">
          <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
            <h3 class="font-semibold">Références</h3>
          </div>
          <References references={organization.references} referencesScaleFactor={1} />
        </div>
      {/if}
    </div>
  </OrganizationForm>
{:else if !error}
  <div class="text-center py-12">
    <p class="text-slate-500">Chargement...</p>
  </div>
{/if}


