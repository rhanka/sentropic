<script lang="ts">
  import { Alert, Button, Input } from '@sentropic/design-system-svelte';
  import type { IdentityManagementScreenPorts, IdentityMembershipView } from './management-ports.js';
  export let ports: IdentityManagementScreenPorts;
  let tenantId = '', loadedTenantId = '', loading = false, error = '', notice = '';
  let items: IdentityMembershipView[] = [];
  let generation = 0;
  $: if (tenantId.trim() !== loadedTenantId) items = [];

  async function load() {
    const scope = tenantId.trim(), attempt = ++generation;
    if (!scope) return;
    loading = true; error = ''; notice = '';
    try {
      const result = await ports.transport.listMemberships(scope);
      if (attempt === generation && tenantId.trim() === scope) { loadedTenantId = scope; items = result.items; }
    } catch { if (attempt === generation) error = ports.text('identity.membershipLoadFailed'); }
    finally { if (attempt === generation) loading = false; }
  }
  async function request() {
    const scope = tenantId.trim();
    if (!scope) return;
    loading = true; error = ''; notice = '';
    try {
      await ports.transport.requestMembership(scope);
      notice = ports.text('identity.requestReceived'); // Same public result for unknown tenants.
    } catch { error = ports.text('identity.actionFailed'); }
    finally { loading = false; }
  }
  async function decide(member: IdentityMembershipView, decision: 'approve' | 'reject' | 'suspend') {
    const scope = loadedTenantId;
    if (!scope || scope !== tenantId.trim() || (member.userId === ports.userId && decision !== 'suspend')) return;
    loading = true; error = ''; notice = '';
    try {
      await ports.transport.decideMembership(scope, member.userId, decision);
      await load();
    } catch { error = ports.text('identity.actionFailed'); }
    finally { loading = false; }
  }
</script>

<section class="space-y-4 rounded-lg border border-slate-200 bg-white p-6" aria-busy={loading}>
  <h1 class="text-lg font-semibold text-slate-800">{ports.text('identity.membershipTitle')}</h1>
  <p class="text-sm text-slate-600">{ports.text('identity.approvalsIndependent')}</p>
  <form class="flex flex-wrap items-end gap-3" onsubmit={event => { event.preventDefault(); void load(); }}>
    <Input id="cm-membership-tenant" label={ports.text('identity.tenant')} bind:value={tenantId} disabled={loading} required />
    <Button type="submit" disabled={loading || !tenantId.trim()}>{ports.text('identity.loadDecisions')}</Button>
    <Button type="button" variant="secondary" onclick={request} disabled={loading || !tenantId.trim()}>{ports.text('identity.requestMembership')}</Button>
  </form>
  {#if error}<Alert tone="error" title={error} />{/if}
  {#if notice}<Alert tone="info" title={notice} />{/if}
  {#if loadedTenantId && !loading && !items.length}<p>{ports.text('identity.noMemberships')}</p>{/if}
  <div class="overflow-x-auto">
    <table class="min-w-full text-sm">
      <thead><tr><th class="text-left">{ports.text('identity.person')}</th><th class="text-left">{ports.text('common.status')}</th><th>{ports.text('common.role')}</th><th class="text-left">{ports.text('identity.decidedBy')}</th><th></th></tr></thead>
      <tbody>{#each items as member (member.userId)}
        <tr class="border-t border-slate-200">
          <td class="p-2">{member.userId}</td><td class="p-2">{ports.text(`identity.membershipStatus.${member.status}`)}</td>
          <td class="p-2">{ports.text(`identity.tenantRole.${member.role}`)}</td>
          <td class="p-2">{member.decidedBy ?? '—'} {member.decidedAt ?? ''}</td>
          <td class="flex flex-wrap gap-2 p-2">
            {#if ['invited','requested','suspended'].includes(member.status)}
              <Button type="button" onclick={() => decide(member, 'approve')} disabled={loading || member.userId === ports.userId}>{ports.text('adminUsers.actions.approve')}</Button>
            {/if}
            {#if ['invited','requested'].includes(member.status)}
              <Button type="button" variant="secondary" onclick={() => decide(member, 'reject')} disabled={loading || member.userId === ports.userId}>{ports.text('identity.reject')}</Button>
            {/if}
            {#if member.status === 'approved'}
              <Button type="button" variant="secondary" onclick={() => decide(member, 'suspend')} disabled={loading}>{ports.text('identity.suspend')}</Button>
            {/if}
          </td>
        </tr>
      {/each}</tbody>
    </table>
  </div>
</section>
