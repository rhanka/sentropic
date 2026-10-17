<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { Button } from '@sentropic/design-system-svelte';
  import { contentApi, type PreparedConsent, type RetainedHandle, type SessionsMetadata } from '$lib/session-content/api';
  import { ConsentFlow, createOffer, retentionChoice, type Channel, type RetainedChannel } from '$lib/session-content/state';
  import { browserAssertion, browserKeyAvailable } from '$lib/session-content/proof';

  export let cleanup = false;
  export let metadata: SessionsMetadata | null = null;
  export let onchanged: () => void = () => {};
  let handles: RetainedHandle[] = [];
  let statuses: Record<string, string> = {};
  let busy = false;
  let failed = false;
  let disposed = false;
  let mounted = false;
  let previousMetadata: SessionsMetadata | null = null;
  let offer = createOffer({ ownerId: '', workspaceId: '', projectId: '', sourceId: '' });
  let flow: ConsentFlow<PreparedConsent> | null = null;
  let invalidRetention = false;
  let modes: Record<RetainedChannel, 'none' | 'duration'> = { 'terminal.cache': 'none', 'native.mirror': 'none' };
  let amounts: Record<RetainedChannel, number> = { 'terminal.cache': 1, 'native.mirror': 1 };
  let units: Record<RetainedChannel, 'hours' | 'days'> = { 'terminal.cache': 'days', 'native.mirror': 'days' };
  const channels: { key: Channel; label: string }[] = [
    { key: 'terminal.live', label: 'live' }, { key: 'terminal.cache', label: 'cache' },
    { key: 'native.mirror', label: 'mirror' }, { key: 'keyboard.control', label: 'keyboard' },
  ];
  const retainedChannels: RetainedChannel[] = ['terminal.cache', 'native.mirror'];
  $: available = mounted && !!metadata?.sourceVerified && browserKeyAvailable(metadata.credentials);
  $: if (metadata !== previousMetadata) {
    flow?.cancel(); previousMetadata = metadata;
    if (metadata) {
      offer = createOffer(metadata);
      modes = { 'terminal.cache': 'none', 'native.mirror': 'none' };
      flow = new ConsentFlow(offer, {
        prepare: contentApi.prepareOffer, accept: contentApi.acceptOffer,
        prove: (prepared, signal) => browserAssertion(prepared, metadata?.credentials ?? [], signal),
        available: () => available,
      });
    } else flow = null;
  }
  $: if (!available && flow?.prepared) { flow.cancel(); flow = flow; }
  function edited() {
    invalidRetention = false;
    try {
      for (const channel of retainedChannels) {
        if (modes[channel] === 'duration' && !Number.isFinite(amounts[channel])) throw new Error('invalid_retention');
        offer.retentionByChannel[channel] = retentionChoice(modes[channel], amounts[channel], units[channel]);
      }
      flow?.edit(offer);
    } catch { invalidRetention = true; flow?.cancel(); }
    offer = { ...offer }; flow = flow;
  }
  function selectSession(sessionId: string, checked: boolean) {
    offer.selectedSessionIds = checked ? [...offer.selectedSessionIds, sessionId] : offer.selectedSessionIds.filter((id) => id !== sessionId);
    edited();
  }
  async function consentAction(action: 'prepare' | 'confirm') {
    busy = true; failed = false;
    try { await flow?.[action](); if (flow?.accepted) onchanged(); }
    catch { failed = true; }
    finally { busy = false; flow = flow; }
  }

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
  onMount(() => { mounted = true; if (cleanup) void loadRetained(); });
  onDestroy(() => { disposed = true; handles = []; flow?.cancel(); });
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
  {:else}
    <h2 class="text-lg font-semibold text-slate-900">{$_('sessionContent.consent')}</h2>
    <p>{$_('sessionContent.owner')}</p>
    <p>{$_('sessionContent.source')}: {metadata?.sourceId || $_('sessionContent.unavailable')}</p>
    <fieldset class="space-y-3" disabled={busy || !metadata}>
      {#each channels as channel}
        <label class="flex min-h-9 items-center gap-2">
          <input type="checkbox" checked={offer.channels[channel.key]} on:change={(e) => { offer.channels[channel.key] = e.currentTarget.checked; edited(); }} />
          {$_(`sessionContent.${channel.label}`)}
        </label>
      {/each}
      <label class="flex min-h-9 items-center gap-2"><input type="checkbox" checked={offer.futureSessions} on:change={(e) => { offer.futureSessions = e.currentTarget.checked; edited(); }} />{$_('sessionContent.future')}</label>
      <p class="font-medium">{$_('sessionContent.sessions')}</p>
      {#each metadata?.items ?? [] as row}
        {#if row.sessionId}<label class="flex min-h-9 items-center gap-2"><input type="checkbox" checked={offer.selectedSessionIds.includes(row.sessionId)} on:change={(e) => selectSession(row.sessionId!, e.currentTarget.checked)} />{row.sessionId}</label>{/if}
      {/each}
      <p class="font-medium">{$_('sessionContent.histories')}</p>
      {#each metadata?.namedHistories ?? [] as history}
        <label class="flex min-h-9 items-center gap-2"><input type="checkbox" checked={offer.namedHistories.includes(history)} on:change={(e) => { offer.namedHistories = e.currentTarget.checked ? [...offer.namedHistories, history] : offer.namedHistories.filter((item) => item !== history); edited(); }} />{history.provider} · {history.conversationId} · {history.lineage} · {history.checkpoint} · {history.inventoryDigest}</label>
      {:else}<p class="text-sm text-slate-700">{$_('sessionContent.noHistories')}</p>{/each}
      {#each retainedChannels as channel}
        {#if offer.channels[channel]}
          <fieldset class="rounded border border-slate-200 p-3 space-y-2">
            <legend>{$_(`sessionContent.${channel === 'terminal.cache' ? 'cache' : 'mirror'}`)} — {$_('sessionContent.retention')}</legend>
            <select class="min-h-9 rounded border border-slate-300 p-2" aria-label={$_('sessionContent.retention')} bind:value={modes[channel]} on:change={() => queueMicrotask(edited)}>
              <option value="none">{$_('sessionContent.none')}</option><option value="duration">{$_('sessionContent.duration')}</option>
            </select>
            {#if modes[channel] === 'duration'}
              <input class="min-h-9 rounded border border-slate-300 p-2" type="number" min="1" aria-label={$_('sessionContent.amount')} bind:value={amounts[channel]} on:input={() => queueMicrotask(edited)} />
              <select class="min-h-9 rounded border border-slate-300 p-2" aria-label={$_('sessionContent.amount')} bind:value={units[channel]} on:change={() => queueMicrotask(edited)}><option value="hours">{$_('sessionContent.hours')}</option><option value="days">{$_('sessionContent.days')}</option></select>
            {/if}
          </fieldset>
        {/if}
      {/each}
      <p class="text-sm text-slate-700">{$_('sessionContent.futureOnly')}</p>
      {#each Array(7) as _, index}<p class="text-sm text-slate-700">{$_(`sessionContent.disclosures.${index}`)}</p>{/each}
      <label class="flex min-h-9 items-start gap-2"><input type="checkbox" checked={offer.offlineReadAccepted} on:change={(e) => { offer.offlineReadAccepted = e.currentTarget.checked; edited(); }} />{$_('sessionContent.offlineAccept')}</label>
    </fieldset>
    {#if !available}<p role="status">{$_('sessionContent.noKey')}</p>{/if}
    {#if flow?.accepted}<p role="status">{$_('sessionContent.accepted')}</p>{/if}
    <div class="flex flex-wrap gap-2">
      <Button variant="secondary" onclick={() => consentAction('prepare')} disabled={busy || !available || invalidRetention || !offer.offlineReadAccepted || !Object.values(offer.channels).some(Boolean) || (offer.channels['terminal.cache'] && !offer.channels['terminal.live'])}>{$_('sessionContent.prepare')}</Button>
      <Button variant="primary" onclick={() => consentAction('confirm')} disabled={busy || !available || !flow?.prepared}>{$_('sessionContent.confirm')}</Button>
      <Button variant="ghost" onclick={() => { flow?.cancel(); flow = flow; }}>{$_('sessionContent.cancel')}</Button>
    </div>
  {/if}
</section>
