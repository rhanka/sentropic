<script lang="ts">
  import { onMount } from 'svelte';
  import type { IdentityManagementScreenPorts, IdentityAdminUserView as AdminUserRow } from './management-ports.js';
  export let ports: IdentityManagementScreenPorts;

  export let embeddedTitle: string | null = null;

  type AccountStatus = AdminUserRow['accountStatus'];
  type Role = AdminUserRow['role'];
  const operations = new Map<string, string>();

  let loading = false;
  let statusFilter: AccountStatus | '' = '';
  let roleOnApprove: Role = 'editor';
  let items: AdminUserRow[] = [];

  const t = (key: string, options?: { values?: Record<string, string> }) => ports.text(key, options);

  const isAdminApp = () => ports.role === 'admin_app';
  const isProtectedAdminUser = (u: AdminUserRow): boolean => u.role === 'admin_app' || u.role === 'admin_org';
  const canDisable = (u: AdminUserRow): boolean => !isProtectedAdminUser(u) && u.id !== (ports.userId ?? '');
  const isDisabled = (u: AdminUserRow): boolean => u.accountStatus === 'disabled_by_admin' || u.accountStatus === 'disabled_by_user';
  const canDelete = (u: AdminUserRow): boolean => canDisable(u); // same safety gates, plus server requires disabled

  async function load() {
    loading = true;
    try {
      const data = await ports.transport.listUsers(statusFilter || undefined);
      // Defensive: avoid keyed each crash if server returns duplicates (e.g. multiple owned workspaces).
      const uniq = new Map<string, AdminUserRow>();
      for (const u of data.items ?? []) {
        if (!u?.id) continue;
        if (!uniq.has(u.id)) uniq.set(u.id, u);
      }
      items = Array.from(uniq.values());
    } catch {
      ports.notify({ type: 'error', message: t('adminUsers.errors.load') });
    } finally {
      loading = false;
    }
  }

  async function approve(userId: string) {
    try {
      await ports.transport.approveUser(userId, roleOnApprove);
      ports.notify({ type: 'success', message: t('adminUsers.toasts.approved') });
      await load();
    } catch {
      ports.notify({ type: 'error', message: t('adminUsers.errors.approve') });
    }
  }

  async function disable(userId: string) {
    if (!await ports.confirm(t('adminUsers.confirm.disable'))) return;
    try {
      await ports.transport.disableUser(userId);
      ports.notify({ type: 'success', message: t('adminUsers.toasts.disabled') });
      await load();
    } catch {
      ports.notify({ type: 'error', message: t('adminUsers.errors.disable') });
    }
  }

  async function reactivate(userId: string) {
    try {
      await ports.transport.reactivateUser(userId);
      ports.notify({ type: 'success', message: t('adminUsers.toasts.reactivated') });
      await load();
    } catch {
      ports.notify({ type: 'error', message: t('adminUsers.errors.reactivate') });
    }
  }

  async function deleteUser(u: AdminUserRow) {
    if (!canDelete(u)) return;
    if (!isDisabled(u)) {
      ports.notify({ type: 'error', message: t('adminUsers.errors.mustDisableBeforeDelete') });
      return;
    }
    if (!await ports.confirm(t('adminUsers.confirm.deletePermanently', { values: { target: u.email ?? u.id } }))) return;
    try {
      const operationId = operations.get(u.id) ?? ports.operationId();
      operations.set(u.id, operationId);
      const receipt = await ports.transport.deleteUser(u.id, operationId);
      ports.notify({ type: receipt.complete ? 'success' : 'info',
        message: t(receipt.complete ? 'adminUsers.toasts.deleted' : 'adminUsers.toasts.deletionPending') });
      await load();
    } catch {
      ports.notify({ type: 'error', message: t('adminUsers.errors.delete') });
    }
  }

  onMount(load);
</script>

{#if !ports.userId}
  <div class="text-slate-600">{ports.text('common.loading')}</div>
{:else if !isAdminApp()}
  <div class="rounded border border-slate-200 bg-white p-4">
    <h2 class="text-sm font-semibold text-slate-800">{ports.text('adminUsers.accessDenied.title')}</h2>
    <p class="mt-2 text-sm text-slate-600">{ports.text('adminUsers.accessDenied.body')}</p>
  </div>
{:else}
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="text-lg font-semibold text-slate-800">{embeddedTitle ?? ports.text('adminUsers.title')}</h2>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <label class="text-sm text-slate-600">
          {ports.text('common.status')}:
          <select class="ml-2 rounded border border-slate-200 px-2 py-1" bind:value={statusFilter} on:change={load}>
            <option value="">{ports.text('common.all')}</option>
            <option value="pending_admin_approval">{ports.text('adminUsers.status.pending_admin_approval')}</option>
            <option value="approval_expired_readonly">{ports.text('adminUsers.status.approval_expired_readonly')}</option>
            <option value="active">{ports.text('adminUsers.status.active')}</option>
            <option value="disabled_by_admin">{ports.text('adminUsers.status.disabled_by_admin')}</option>
            <option value="disabled_by_user">{ports.text('adminUsers.status.disabled_by_user')}</option>
          </select>
        </label>
        <label class="text-sm text-slate-600">
          {ports.text('adminUsers.roleOnApprove')}:
          <select class="ml-2 rounded border border-slate-200 px-2 py-1" bind:value={roleOnApprove}>
            <option value="editor">{ports.text('adminUsers.role.editor')}</option>
            <option value="guest">{ports.text('adminUsers.role.guest')}</option>
            <option value="admin_org">{ports.text('adminUsers.role.admin_org')}</option>
            <option value="admin_app">{ports.text('adminUsers.role.admin_app')}</option>
          </select>
        </label>
        <button class="rounded bg-primary px-3 py-1.5 text-sm text-white" on:click={load} disabled={loading}>
          {ports.text('common.refresh')}
        </button>
      </div>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4">
      {#if loading}
        <div class="text-sm text-slate-600">{ports.text('common.loading')}</div>
      {:else if items.length === 0}
        <div class="text-sm text-slate-600">{ports.text('adminUsers.empty')}</div>
      {:else}
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b border-slate-200 text-left text-slate-600">
                <th class="py-2 pr-3">{ports.text('common.email')}</th>
                <th class="py-2 pr-3">{ports.text('common.name')}</th>
                <th class="py-2 pr-3">{ports.text('common.role')}</th>
                <th class="py-2 pr-3">{ports.text('common.status')}</th>
                <th class="py-2 pr-3">{ports.text('adminUsers.table.emailVerified')}</th>
                <th class="py-2 pr-3">{ports.text('common.workspace')}</th>
                <th class="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {#each items as u (u.id)}
                <tr class="border-b border-slate-100">
                  <td class="py-2 pr-3">{u.email ?? '—'}</td>
                  <td class="py-2 pr-3">{u.displayName ?? '—'}</td>
                  <td class="py-2 pr-3">{ports.text(`adminUsers.role.${u.role}`)}</td>
                  <td class="py-2 pr-3">{ports.text(`adminUsers.status.${u.accountStatus}`)}</td>
                  <td class="py-2 pr-3">{u.emailVerified ? ports.text('common.yes') : ports.text('common.no')}</td>
                  <td class="py-2 pr-3">{u.workspaceName ?? u.workspaceId ?? '—'}</td>
                  <td class="py-2 pr-3">
                    <div class="flex flex-wrap gap-2">
                      {#if u.accountStatus === 'pending_admin_approval' || u.accountStatus === 'approval_expired_readonly'}
                        <button class="rounded bg-emerald-600 px-2 py-1 text-white" on:click={() => approve(u.id)}>
                          {ports.text('adminUsers.actions.approve')}
                        </button>
                      {/if}
                      {#if isDisabled(u)}
                        <button class="rounded bg-amber-600 px-2 py-1 text-white" on:click={() => reactivate(u.id)}>
                          {ports.text('adminUsers.actions.reactivate')}
                        </button>
                      {/if}
                      {#if canDisable(u)}
                        {#if !isDisabled(u)}
                          <button class="rounded bg-rose-600 px-2 py-1 text-white" on:click={() => disable(u.id)}>
                            {ports.text('adminUsers.actions.disable')}
                          </button>
                        {/if}
                        {#if isDisabled(u)}
                          <button class="rounded bg-rose-700 px-2 py-1 text-white" on:click={() => deleteUser(u)}>
                            {ports.text('common.delete')}
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
