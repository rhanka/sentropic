<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, Button, Input } from '@sentropic/design-system-svelte';
  import type { IdentityManagementScreenPorts, IdentityWorkspaceMemberView } from './management-ports.js';
  export let ports: IdentityManagementScreenPorts;
  export let workspaceId: string;
  export let refreshVersion = 0;
  const roles = ['viewer', 'commenter', 'editor', 'admin'];
  let items: IdentityWorkspaceMemberView[] = [], email = '', role = 'viewer', error = '', busy = false;
  let mounted = false, requestedKey = '', loadedScope = '', generation = 0;
  $: scopeKey = JSON.stringify([workspaceId, refreshVersion, ports.userId]);
  $: canManage = items.some(member => member.userId === ports.userId && member.role === 'admin');
  $: if (mounted && scopeKey !== requestedKey) { requestedKey = scopeKey; void load(workspaceId); }
  onMount(() => { mounted = true; return () => { mounted = false; generation++; }; });

  async function load(scope: string) {
    const attempt = ++generation;
    items = []; loadedScope = ''; error = '';
    if (!scope) return;
    busy = true;
    try {
      const result = await ports.transport.listMembers(scope);
      if (attempt === generation && workspaceId === scope) { items = result.items; loadedScope = scope; }
    } catch { if (attempt === generation) error = ports.text('workspaceSettings.errors.loadMembers'); }
    finally { if (attempt === generation) busy = false; }
  }
  async function perform(scope: string, operation: () => Promise<void>, toastKey: string) {
    if (busy || loadedScope !== scope || workspaceId !== scope || !canManage) return;
    busy = true; error = '';
    try {
      await operation();
      ports.notify({ type: 'success', message: ports.text(toastKey) });
      await ports.refreshWorkspaceScope?.();
      if (workspaceId === scope) await load(scope);
    } catch { error = ports.text('identity.actionFailed'); }
    finally { busy = false; }
  }
  async function add() {
    const scope = workspaceId, address = email.trim(), selectedRole = role;
    if (!address) return;
    await perform(scope, () => ports.transport.addMember(scope, address, selectedRole), 'workspaceSettings.toasts.memberAdded');
  }
  async function changeRole(event: Event, member: IdentityWorkspaceMemberView) {
    const select = event.currentTarget;
    if (!(select instanceof HTMLSelectElement) || member.userId === ports.userId) return;
    const selectedRole = select.value, scope = workspaceId;
    select.value = member.role; // Display only committed authority.
    await perform(scope, () => ports.transport.setMemberRole(scope, member.userId, selectedRole), 'workspaceSettings.toasts.roleUpdated');
  }
  async function remove(member: IdentityWorkspaceMemberView) {
    const scope = workspaceId;
    if (member.userId === ports.userId || !await ports.confirm(ports.text('workspaceSettings.confirm.removeMember'))) return;
    await perform(scope, () => ports.transport.removeMember(scope, member.userId), 'workspaceSettings.toasts.memberRemoved');
  }
</script>

<section class="space-y-4 rounded-lg border border-slate-200 bg-white p-4" aria-busy={busy}>
  <h2 class="font-medium">{ports.text('workspaceSettings.members.title')}</h2>
  {#if error}<Alert tone="error" title={error} />{/if}
  {#if canManage}
    <form class="flex flex-wrap items-end gap-2" onsubmit={event => { event.preventDefault(); void add(); }}>
      <Input id="cm-member-email" label={ports.text('common.email')} type="email" bind:value={email} disabled={busy} required />
      <label class="text-sm">{ports.text('common.role')}
        <select class="rounded border border-slate-300 px-3 py-2" bind:value={role} disabled={busy}>
          {#each roles as value}<option value={value}>{ports.text(`roles.${value}`)}</option>{/each}
        </select>
      </label>
      <Button type="submit" disabled={busy || !email.trim()}>{ports.text('common.add')}</Button>
    </form>
  {/if}
  <div class="overflow-x-auto"><table class="min-w-full text-sm">
    <thead><tr><th class="text-left">{ports.text('common.email')}</th><th class="text-left">{ports.text('common.name')}</th><th>{ports.text('common.role')}</th><th></th></tr></thead>
    <tbody>{#each items as member (member.userId)}
      <tr class="border-t border-slate-200">
        <td class="p-2">{member.email ?? '—'}</td><td class="p-2">{member.displayName ?? '—'}</td>
        <td class="p-2"><select class="rounded border border-slate-300 px-3 py-2" value={member.role}
          aria-label={ports.text('common.role')} onchange={event => changeRole(event, member)} disabled={busy || !canManage || member.userId === ports.userId}>
          {#each roles as value}<option value={value}>{ports.text(`roles.${value}`)}</option>{/each}
        </select></td>
        <td class="p-2">{#if canManage && member.userId !== ports.userId}
          <Button type="button" variant="secondary" onclick={() => remove(member)} disabled={busy}>{ports.text('workspaceSettings.members.remove')}</Button>
        {/if}</td>
      </tr>
    {/each}</tbody>
  </table></div>
</section>
