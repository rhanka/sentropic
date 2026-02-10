<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { session } from '$lib/stores/session';
  import { addToast } from '$lib/stores/toast';
  import { apiGet, apiPost, apiDelete } from '$lib/utils/api';

  export let embeddedTitle: string | null = null;

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
  };

  let loading = false;
  let statusFilter: AccountStatus | '' = '';
  let roleOnApprove: Role = 'editor';
  let items: AdminUserRow[] = [];

  const t = (key: string, options?: any) => get(_)(key, options);

  const isAdminApp = () => $session.user?.role === 'admin_app';
  const isProtectedAdminUser = (u: AdminUserRow): boolean => u.role === 'admin_app' || u.role === 'admin_org';
  const canDisable = (u: AdminUserRow): boolean => !isProtectedAdminUser(u) && u.id !== ($session.user?.id ?? '');
  const isDisabled = (u: AdminUserRow): boolean => u.accountStatus === 'disabled_by_admin' || u.accountStatus === 'disabled_by_user';
  const canDelete = (u: AdminUserRow): boolean => canDisable(u); // same safety gates, plus server requires disabled

  async function load() {
    loading = true;
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const data = await apiGet<{ items: AdminUserRow[] }>(`/admin/users${qs}`);
      // Defensive: avoid keyed each crash if server returns duplicates (e.g. multiple owned workspaces).
      const uniq = new Map<string, AdminUserRow>();
      for (const u of data.items ?? []) {
        if (!u?.id) continue;
        if (!uniq.has(u.id)) uniq.set(u.id, u);
      }
      items = Array.from(uniq.values());
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('adminUsers.errors.load') });
    } finally {
      loading = false;
    }
  }

  async function approve(userId: string) {
    try {
      await apiPost(`/admin/users/${userId}/approve`, { role: roleOnApprove });
      addToast({ type: 'success', message: t('adminUsers.toasts.approved') });
      await load();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('adminUsers.errors.approve') });
    }
  }

  async function disable(userId: string) {
    if (!confirm(t('adminUsers.confirm.disable'))) return;
    try {
      await apiPost(`/admin/users/${userId}/disable`, {});
      addToast({ type: 'success', message: t('adminUsers.toasts.disabled') });
      await load();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('adminUsers.errors.disable') });
    }
  }

  async function reactivate(userId: string) {
    try {
      await apiPost(`/admin/users/${userId}/reactivate`, {});
      addToast({ type: 'success', message: t('adminUsers.toasts.reactivated') });
      await load();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('adminUsers.errors.reactivate') });
    }
  }

  async function deleteUser(u: AdminUserRow) {
    if (!canDelete(u)) return;
    if (!isDisabled(u)) {
      addToast({ type: 'error', message: t('adminUsers.errors.mustDisableBeforeDelete') });
      return;
    }
    if (!confirm(t('adminUsers.confirm.deletePermanently', { values: { target: u.email ?? u.id } }))) return;
    try {
      await apiDelete(`/admin/users/${u.id}`);
      addToast({ type: 'success', message: t('adminUsers.toasts.deleted') });
      await load();
    } catch (e: any) {
      addToast({ type: 'error', message: e?.message ?? t('adminUsers.errors.delete') });
    }
  }

  onMount(load);
</script>

{#if !$session.user}
  <div class="text-slate-600">{$_('common.loading')}</div>
{:else if !isAdminApp()}
  <div class="rounded border border-slate-200 bg-white p-4">
    <h2 class="text-sm font-semibold text-slate-800">{$_('adminUsers.accessDenied.title')}</h2>
    <p class="mt-2 text-sm text-slate-600">{$_('adminUsers.accessDenied.body')}</p>
  </div>
{:else}
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="text-lg font-semibold text-slate-800">{embeddedTitle ?? $_('adminUsers.title')}</h2>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <label class="text-sm text-slate-600">
          {$_('common.status')}:
          <select class="ml-2 rounded border border-slate-200 px-2 py-1" bind:value={statusFilter} on:change={load}>
            <option value="">{$_('common.all')}</option>
            <option value="pending_admin_approval">{$_('adminUsers.status.pending_admin_approval')}</option>
            <option value="approval_expired_readonly">{$_('adminUsers.status.approval_expired_readonly')}</option>
            <option value="active">{$_('adminUsers.status.active')}</option>
            <option value="disabled_by_admin">{$_('adminUsers.status.disabled_by_admin')}</option>
            <option value="disabled_by_user">{$_('adminUsers.status.disabled_by_user')}</option>
          </select>
        </label>
        <label class="text-sm text-slate-600">
          {$_('adminUsers.roleOnApprove')}:
          <select class="ml-2 rounded border border-slate-200 px-2 py-1" bind:value={roleOnApprove}>
            <option value="editor">{$_('adminUsers.role.editor')}</option>
            <option value="guest">{$_('adminUsers.role.guest')}</option>
            <option value="admin_org">{$_('adminUsers.role.admin_org')}</option>
            <option value="admin_app">{$_('adminUsers.role.admin_app')}</option>
          </select>
        </label>
        <button class="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" on:click={load} disabled={loading}>
          {$_('common.refresh')}
        </button>
      </div>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4">
      {#if loading}
        <div class="text-sm text-slate-600">{$_('common.loading')}</div>
      {:else if items.length === 0}
        <div class="text-sm text-slate-600">{$_('adminUsers.empty')}</div>
      {:else}
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b border-slate-200 text-left text-slate-600">
                <th class="py-2 pr-3">{$_('common.email')}</th>
                <th class="py-2 pr-3">{$_('common.name')}</th>
                <th class="py-2 pr-3">{$_('common.role')}</th>
                <th class="py-2 pr-3">{$_('common.status')}</th>
                <th class="py-2 pr-3">{$_('adminUsers.table.emailVerified')}</th>
                <th class="py-2 pr-3">{$_('common.workspace')}</th>
                <th class="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {#each items as u (u.id)}
                <tr class="border-b border-slate-100">
                  <td class="py-2 pr-3">{u.email ?? '—'}</td>
                  <td class="py-2 pr-3">{u.displayName ?? '—'}</td>
                  <td class="py-2 pr-3">{$_(`adminUsers.role.${u.role}`)}</td>
                  <td class="py-2 pr-3">{$_(`adminUsers.status.${u.accountStatus}`)}</td>
                  <td class="py-2 pr-3">{u.emailVerified ? $_('common.yes') : $_('common.no')}</td>
                  <td class="py-2 pr-3">{u.workspaceName ?? u.workspaceId ?? '—'}</td>
                  <td class="py-2 pr-3">
                    <div class="flex flex-wrap gap-2">
                      {#if u.accountStatus === 'pending_admin_approval' || u.accountStatus === 'approval_expired_readonly'}
                        <button class="rounded bg-emerald-600 px-2 py-1 text-white" on:click={() => approve(u.id)}>
                          {$_('adminUsers.actions.approve')}
                        </button>
                      {/if}
                      {#if isDisabled(u)}
                        <button class="rounded bg-amber-600 px-2 py-1 text-white" on:click={() => reactivate(u.id)}>
                          {$_('adminUsers.actions.reactivate')}
                        </button>
                      {/if}
                      {#if canDisable(u)}
                        {#if !isDisabled(u)}
                          <button class="rounded bg-rose-600 px-2 py-1 text-white" on:click={() => disable(u.id)}>
                            {$_('adminUsers.actions.disable')}
                          </button>
                        {/if}
                        {#if isDisabled(u)}
                          <button class="rounded bg-rose-700 px-2 py-1 text-white" on:click={() => deleteUser(u)}>
                            {$_('common.delete')}
                          </button>
                        {/if}
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

  </div>
{/if}
