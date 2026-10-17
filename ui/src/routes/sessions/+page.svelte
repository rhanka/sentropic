<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { Button } from '@sentropic/design-system-svelte';
  import { session } from '$lib/stores/session';
  import { selectedWorkspace, setWorkspaceScope, workspaceScope } from '$lib/stores/workspaceScope';
  import { contentApi, type SessionsMetadata } from '$lib/session-content/api';
  import ConsentPanel from '$lib/components/session-content/ConsentPanel.svelte';
  import SessionViewer from '$lib/components/session-content/SessionViewer.svelte';
  import KeyboardPanel from '$lib/components/session-content/KeyboardPanel.svelte';
  let metadata: SessionsMetadata | null = null;
  let mounted = false; let busy = false; let failed = false; let revision = 0;
  let selection = '';
  $: synchronize($session.user?.id, $selectedWorkspace?.id, mounted);
  function synchronize(ownerId: string | undefined, workspaceId: string | undefined, ready: boolean) {
    const next = JSON.stringify([ownerId, workspaceId]);
    if (!ready || next === selection) return;
    selection = next; revision++; metadata = null;
    if (ownerId && workspaceId) void load();
  }
  async function load() {
    const ownerId = $session.user?.id; const workspaceId = $selectedWorkspace?.id;
    if (!ownerId || !workspaceId) return;
    const current = ++revision; busy = true; failed = false; metadata = null;
    try {
      const result = await contentApi.metadata(workspaceId);
      if (result.ownerId !== ownerId || result.workspaceId !== workspaceId) throw new Error('scope_mismatch');
      if (current === revision) metadata = result;
    } catch { if (current === revision) failed = true; }
    finally { if (current === revision) busy = false; }
  }
  async function attach(sessionId: string, sourceId: string) {
    if (!metadata?.sourceVerified) return;
    busy = true; failed = false;
    try { await contentApi.attach(metadata.workspaceId, sessionId, sourceId); await load(); }
    catch { failed = true; }
    finally { busy = false; }
  }
  onMount(() => { mounted = true; });
  onDestroy(() => { revision++; metadata = null; });
</script>

<div class="mx-auto max-w-5xl p-4 space-y-6">
  <h1 class="text-2xl font-semibold text-slate-900">{$_('sessionContent.title')}</h1>
  <label class="block space-y-1"><span>{$_('sessionContent.workspace')}</span>
    <select class="min-h-9 w-full rounded border border-slate-300 bg-white p-2 focus:ring-2 focus:ring-primary/30" value={$workspaceScope.selectedId ?? ''} on:change={(e) => setWorkspaceScope(e.currentTarget.value)}>
      {#each $workspaceScope.items as workspace}<option value={workspace.id}>{workspace.name}</option>{/each}
    </select>
  </label>
  <a class="inline-flex min-h-9 items-center rounded text-primary focus-visible:ring-2 focus-visible:ring-primary/30" href="/settings">{$_('sessionContent.settings')}</a>
  <Button variant="secondary" onclick={load} disabled={busy || !$selectedWorkspace}>{$_('sessionContent.refresh')}</Button>
  {#if failed}<p role="alert" class="text-red-600">{$_('sessionContent.requestFailed')}</p>{/if}
  {#if metadata?.reason}<p role="status" class="rounded border border-yellow-200 bg-yellow-50 p-3 text-yellow-800">{$_('sessionContent.unavailable')}</p>{/if}
  {#key selection}
    {#if $session.user}
      <ConsentPanel {metadata} onchanged={() => void load()} />
      {#each metadata?.eligibleSources ?? [] as source}
        <Button variant="secondary" onclick={() => attach(source.sessionId, source.sourceId)} disabled={busy || !metadata?.sourceVerified}>{$_('sessionContent.attach')} · {source.sessionId}</Button>
      {/each}
      {#each metadata?.items ?? [] as row (row.bindingId)}
        {#if metadata}<SessionViewer {row} scope={metadata} credentials={metadata.credentials} onchanged={() => void load()} />{/if}
        <KeyboardPanel context={row.bindingId ? metadata?.controls?.[row.bindingId] ?? null : null} credentials={metadata?.credentials ?? []} />
      {:else}
        {#if !busy}<p>{$_('sessionContent.empty')}</p>{/if}
        <KeyboardPanel />
      {/each}
    {/if}
  {/key}
</div>
