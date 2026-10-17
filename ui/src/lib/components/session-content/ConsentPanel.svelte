<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { Button } from '@sentropic/design-system-svelte';
  import { contentApi, type RetainedHandle, type SessionsMetadata } from '$lib/session-content/api';

  export let cleanup = false;
  export let metadata: SessionsMetadata | null = null;
  export let onchanged: () => void = () => {};
  let handles: RetainedHandle[] = [];
  let statuses: Record<string, string> = {};
  let busy = false;
  let failed = false;
  let disposed = false;

  async function loadRetained() {
    busy = true; failed = false;
    try {
      const result = await contentApi.retained();
      if (!disposed) handles = result.items;
    } catch { if (!disposed) failed = true; }
    finally { if (!disposed) busy = false; }
  }
  async function purge(handle: RetainedHandle) {
    busy = true; failed = false;
    try {
      const result = await contentApi.purge(handle);
      if (!disposed) statuses = { ...statuses,
        [handle.retainedScopeId]: result.complete ? 'purge_completed' : 'purge_pending' };
    } catch { if (!disposed) failed = true; }
    finally { if (!disposed) busy = false; }
  }
  onMount(() => { if (cleanup) void loadRetained(); });
  onDestroy(() => { disposed = true; handles = []; });
</script>

<section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-4" aria-label={$_(cleanup ? 'sessionContent.cleanup' : 'sessionContent.consent')}>
  {#if failed}<p role="alert" class="text-red-600">{$_('sessionContent.requestFailed')}</p>{/if}
  {#if cleanup}
    <h2 class="text-lg font-semibold text-slate-900">{$_('sessionContent.cleanup')}</h2>
    <p class="text-sm text-slate-700">{$_('sessionContent.cleanupNotice')}</p>
    <Button variant="secondary" onclick={loadRetained} disabled={busy}>{$_('sessionContent.refresh')}</Button>
    {#if !busy && !handles.length}<p>{$_('sessionContent.cleanupEmpty')}</p>{/if}
    {#each handles as handle (handle.retainedScopeId)}
      <div class="rounded border border-slate-200 p-3 space-y-2">
        <p class="font-mono text-sm break-all">{handle.bindingId}</p>
        <p>{handle.bytes} {$_('sessionContent.bytes')}</p>
        <p role="status">{$_(`sessionContent.states.${statuses[handle.retainedScopeId] || handle.status}`)}</p>
        <Button variant="danger" onclick={() => purge(handle)} disabled={busy || statuses[handle.retainedScopeId] === 'purge_completed'}>
          {$_('sessionContent.purge')}
        </Button>
      </div>
    {/each}
  {/if}
</section>
