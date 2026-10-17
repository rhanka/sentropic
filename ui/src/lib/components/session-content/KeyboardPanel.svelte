<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { Button } from '@sentropic/design-system-svelte';
  import { browserStepUp, contentApi } from '$lib/session-content/api';
  import { exactInput, KeyboardFlow, proofExpiry, type ControlContext } from '$lib/session-content/proof';
  export let context: ControlContext | null = null;
  let flow: KeyboardFlow | null = null;
  let text = ''; let newline = false; let busy = false; let failed = false;
  let mounted = false; let online = true;
  let preview: ReturnType<typeof exactInput> | null = null;
  $: { try { preview = exactInput(text, newline); } catch { preview = null; } }
  $: synchronize(context, mounted, online);
  function synchronize(next: ControlContext | null, ready: boolean, connected: boolean) {
    if (!next) { flow?.dispose(); flow = null; text = ''; newline = false; return; }
    const current = { ...next, sourceAvailable: next.sourceAvailable && connected, confirmationAvailable: next.confirmationAvailable && ready };
    if (!flow || flow.context.bindingId !== next.bindingId) {
      flow?.dispose(); text = ''; newline = false;
      flow = new KeyboardFlow(current, { ...contentApi.keyboard(next.bindingId),
        prove: browserStepUp, newKey: () => crypto.randomUUID() });
    } else { flow.setContext(current); flow = flow; text = flow.text; newline = flow.newline; }
  }
  function edit() { flow?.edit(text, newline); flow = flow; }
  async function run(action: 'acquire' | 'prepare' | 'send' | 'reconcile') {
    busy = true; failed = false;
    try { await flow?.[action](); }
    catch { failed = true; }
    finally { busy = false; flow = flow; text = flow?.text ?? ''; newline = flow?.newline ?? false; }
  }
  onMount(() => {
    mounted = true; online = navigator.onLine;
    const update = () => { online = navigator.onLine; };
    window.addEventListener('online', update); window.addEventListener('offline', update);
    const expiry = setInterval(() => {
      if (flow && ((flow.lease && flow.lease.expiresAt <= Date.now())
        || (flow.prepared && proofExpiry(flow.prepared.proof) <= Date.now()))) {
        flow.cancel(); flow.lease = null; flow = flow; text = ''; newline = false;
      }
    }, 500);
    return () => { clearInterval(expiry); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  });
  onDestroy(() => {
    const bindingId = flow?.context.bindingId;
    const leased = !!flow?.lease;
    flow?.dispose(); text = ''; newline = false;
    if (leased && bindingId) void contentApi.releaseKeyboard(bindingId).catch(() => {});
  });
</script>

<section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3" aria-label={$_('sessionContent.keyboardTitle')}>
  <h2 class="text-lg font-semibold text-slate-900">{$_('sessionContent.keyboardTitle')}</h2>
  <p class="text-sm text-slate-700">{$_('sessionContent.keyboardDisclosure')}</p>
  {#if !flow?.available}<p role="status">{$_(`sessionContent.states.${context?.authenticationState === 'authentication_required' ? 'authentication_required' : context?.sourceAvailable ? 'step_up_required' : 'source_unavailable'}`)}</p>{/if}
  <label class="block space-y-1"><span>{$_('sessionContent.input')}</span>
    <textarea class="min-h-24 w-full rounded border border-slate-300 p-3 font-mono focus:ring-2 focus:ring-primary/30" autocomplete="off" spellcheck={false} value={text} disabled={busy || !flow?.available} on:input={(e) => { text = e.currentTarget.value; edit(); }}></textarea>
  </label>
  <label class="flex min-h-9 items-center gap-2"><input type="checkbox" checked={newline} disabled={busy || !flow?.available} on:change={(e) => { newline = e.currentTarget.checked; edit(); }} />{$_('sessionContent.newline')}</label>
  <p class="text-sm text-slate-700">{$_('sessionContent.preview')}</p>
  <pre class="whitespace-pre-wrap break-words rounded bg-slate-100 p-3">{preview?.preview ?? ''}</pre>
  <p>{preview?.byteLength ?? 0} {$_('sessionContent.bytes')}</p>
  {#if failed}<p role="alert" class="text-red-600">{$_('sessionContent.requestFailed')}</p>{/if}
  <p role="status">{$_(`sessionContent.states.${flow?.status ?? 'idle'}`)}</p>
  {#if flow?.previousUnknown}<p class="rounded bg-yellow-50 p-3 text-yellow-800">{$_('sessionContent.unknownWarning')}</p>{/if}
  <div class="flex flex-wrap gap-2">
    <Button variant="secondary" onclick={() => run('acquire')} disabled={busy || !flow?.available}>{$_('sessionContent.acquire')}</Button>
    <Button variant="secondary" onclick={() => run('prepare')} disabled={busy || !flow?.ready || !preview}>{$_('sessionContent.prepareAction')}</Button>
    <Button variant="primary" onclick={() => run('send')} disabled={busy || !flow?.prepared || !flow?.available}>{$_(flow?.prepared?.kind === 'acquire' ? 'sessionContent.confirm' : 'sessionContent.send')}</Button>
    <Button variant="ghost" onclick={() => { flow?.cancel(); flow = flow; text = ''; newline = false; }}>{$_('sessionContent.cancel')}</Button>
    <Button variant="secondary" onclick={() => run('reconcile')} disabled={busy || !flow?.lastKey || flow?.status !== 'outcome_unknown'}>{$_('sessionContent.reconcile')}</Button>
  </div>
</section>
