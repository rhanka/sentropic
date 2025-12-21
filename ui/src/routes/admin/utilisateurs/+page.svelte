<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from '$lib/stores/session';
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPost } from '$lib/utils/api';

  type AccountStatus =
    | 'active'
    | 'pending_admin_approval'
    | 'approval_expired_readonly'
    | 'disabled_by_user'
    | 'disabled_by_admin';
  type Role = 'admin_app' | 'admin_org' | 'editor' | 'guest';

  type AdminUserRow = {
    id: string;
    email: string | null;
    displayName: string | null;
    role: Role;
    accountStatus: AccountStatus;
    approvalDueAt: string | null;
    approvedAt: string | null;
    approvedByUserId: string | null;
    disabledAt: string | null;
    disabledReason: string | null;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string | null;
    workspaceId: string | null;
    workspaceName: string | null;
    shareWithAdmin: boolean | null;
  };

  let loading = false;
  let statusFilter: AccountStatus | '' = 'pending_admin_approval';
  let roleOnApprove: Role = 'editor';
  let items: AdminUserRow[] = [];
  let activeItems: AdminUserRow[] = [];

  const isAdminApp = () => $session.user?.role === 'admin_app';

  async function load() {
    loading = true;
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const [data, active] = await Promise.all([
        apiGet<{ items: AdminUserRow[] }>(`/admin/users${qs}`),
        statusFilter === 'active' ? Promise.resolve<{ items: AdminUserRow[] }>({ items: [] }) : apiGet<{ items: AdminUserRow[] }>(`/admin/users?status=active`)
      ]);
      items = data.items;
      activeItems = statusFilter === 'active' ? data.items : active.items;
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur de chargement admin' });
    } finally {
      loading = false;
    }
  }

  async function approve(userId: string) {
    try {
      await apiPost(`/admin/users/${userId}/approve`, { role: roleOnApprove });
      addToast({ type: 'success', message: 'Utilisateur approuvé' });
      await load();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur approval' });
    }
  }

  async function disable(userId: string) {
    const reason = prompt('Raison de désactivation (optionnel) :') ?? undefined;
    try {
      await apiPost(`/admin/users/${userId}/disable`, reason ? { reason } : {});
      addToast({ type: 'success', message: 'Utilisateur désactivé' });
      await load();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur disable' });
    }
  }

  async function reactivate(userId: string) {
    try {
      await apiPost(`/admin/users/${userId}/reactivate`, {});
      addToast({ type: 'success', message: 'Utilisateur réactivé' });
      await load();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? 'Erreur reactivate' });
    }
  }

  onMount(load);
</script>

{#if !$session.user}
  <div class="text-slate-600">Chargement…</div>
{:else if !isAdminApp()}
  <div class="rounded border border-slate-200 bg-white p-4">
    <h1 class="text-lg font-semibold">Admin</h1>
    <p class="mt-2 text-sm text-slate-600">Accès refusé (admin_app requis).</p>
  </div>
{:else}
  <div class="space-y-4">
    <div class="rounded border border-slate-200 bg-white p-4">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-lg font-semibold">Admin · Utilisateurs</h1>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <label class="text-sm text-slate-600">
            Statut:
            <select class="ml-2 rounded border border-slate-200 px-2 py-1" bind:value={statusFilter} on:change={load}>
              <option value="">Tous</option>
              <option value="pending_admin_approval">pending_admin_approval</option>
              <option value="approval_expired_readonly">approval_expired_readonly</option>
              <option value="active">active</option>
              <option value="disabled_by_admin">disabled_by_admin</option>
              <option value="disabled_by_user">disabled_by_user</option>
            </select>
          </label>
          <label class="text-sm text-slate-600">
            Role à l’approbation:
            <select class="ml-2 rounded border border-slate-200 px-2 py-1" bind:value={roleOnApprove}>
              <option value="editor">editor</option>
              <option value="guest">guest</option>
              <option value="admin_org">admin_org</option>
              <option value="admin_app">admin_app</option>
            </select>
          </label>
          <button class="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" on:click={load} disabled={loading}>
            Rafraîchir
          </button>
        </div>
      </div>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4">
      {#if loading}
        <div class="text-sm text-slate-600">Chargement…</div>
      {:else if items.length === 0}
        <div class="text-sm text-slate-600">Aucun utilisateur.</div>
      {:else}
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b border-slate-200 text-left text-slate-600">
                <th class="py-2 pr-3">Email</th>
                <th class="py-2 pr-3">Nom</th>
                <th class="py-2 pr-3">Role</th>
                <th class="py-2 pr-3">Status</th>
                <th class="py-2 pr-3">Email OK</th>
                <th class="py-2 pr-3">Workspace</th>
                <th class="py-2 pr-3">Share</th>
                <th class="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {#each items as u}
                <tr class="border-b border-slate-100">
                  <td class="py-2 pr-3">{u.email ?? '—'}</td>
                  <td class="py-2 pr-3">{u.displayName ?? '—'}</td>
                  <td class="py-2 pr-3">{u.role}</td>
                  <td class="py-2 pr-3">{u.accountStatus}</td>
                  <td class="py-2 pr-3">{u.emailVerified ? 'oui' : 'non'}</td>
                  <td class="py-2 pr-3">{u.workspaceName ?? u.workspaceId ?? '—'}</td>
                  <td class="py-2 pr-3">{u.shareWithAdmin ? 'oui' : 'non'}</td>
                  <td class="py-2 pr-3">
                    <div class="flex flex-wrap gap-2">
                      <button class="rounded bg-emerald-600 px-2 py-1 text-white" on:click={() => approve(u.id)}>
                        Approve
                      </button>
                      <button class="rounded bg-amber-600 px-2 py-1 text-white" on:click={() => reactivate(u.id)}>
                        Reactivate
                      </button>
                      <button class="rounded bg-rose-600 px-2 py-1 text-white" on:click={() => disable(u.id)}>
                        Disable
                      </button>
                      {#if u.workspaceId && u.shareWithAdmin}
                        <a
                          class="rounded bg-slate-900 px-2 py-1 text-white"
                          href={`/admin/workspaces/${u.workspaceId}`}
                          title="Ouvrir ce workspace (partagé)"
                        >
                          Voir workspace
                        </a>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    {#if statusFilter !== 'active'}
      <div class="rounded border border-slate-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-800">Utilisateurs actifs</h2>
          <span class="text-xs text-slate-500">{activeItems.length} actif(s)</span>
        </div>
        {#if loading}
          <div class="text-sm text-slate-600">Chargement…</div>
        {:else if activeItems.length === 0}
          <div class="text-sm text-slate-600">Aucun utilisateur actif.</div>
        {:else}
          <div class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead>
                <tr class="border-b border-slate-200 text-left text-slate-600">
                  <th class="py-2 pr-3">Email</th>
                  <th class="py-2 pr-3">Nom</th>
                  <th class="py-2 pr-3">Role</th>
                  <th class="py-2 pr-3">Email OK</th>
                  <th class="py-2 pr-3">Workspace</th>
                  <th class="py-2 pr-3">Share</th>
                </tr>
              </thead>
              <tbody>
                {#each activeItems as u}
                  <tr class="border-b border-slate-100">
                    <td class="py-2 pr-3">{u.email ?? '—'}</td>
                    <td class="py-2 pr-3">{u.displayName ?? '—'}</td>
                    <td class="py-2 pr-3">{u.role}</td>
                    <td class="py-2 pr-3">{u.emailVerified ? 'oui' : 'non'}</td>
                    <td class="py-2 pr-3">{u.workspaceName ?? u.workspaceId ?? '—'}</td>
                    <td class="py-2 pr-3">{u.shareWithAdmin ? 'oui' : 'non'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}


