<script lang="ts">
  import { onDestroy } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { Button } from '@sentropic/design-system-svelte';
  import { contentApi, type OutputPage } from '$lib/session-content/api';
  import { viewAccess, type ContentScope, type SessionView } from '$lib/session-content/state';
  import { browserAssertion, browserKeyAvailable, type EnrolledCredential } from '$lib/session-content/proof';
  export let row: SessionView;
  export let scope: ContentScope;
  export let credentials: EnrolledCredential[] = [];
  export let onchanged: () => void = () => {};
  let output: OutputPage | null = null;
  let busy = false;
  let failed = false;
  let revision = 0;
  let previousScope = '';
  let abort = new AbortController();
  $: access = viewAccess(row, scope);
  $: fingerprint = JSON.stringify([scope, row.bindingId, row.projectRevision, row.grantProjectRevision,
    row.status, row.excluded, row.revoked, row.membershipActive, row.purgeStatus]);
  $: if (fingerprint !== previousScope || (!access.live && !access.stored)) {
    previousScope = fingerprint; revision++; output = null; abort.abort(); abort = new AbortController();
  }
  async function action(kind: 'read' | 'history' | 'revoke' | 'exclude') {
    if (!row.bindingId || busy) return;
    const current = revision; busy = true; failed = false;
    try {
      if (kind === 'read' && (access.live || access.stored)) {
        const page = await contentApi.read(row.bindingId, row.status !== 'attached');
        if (page.frames.some((frame, index) => !Number.isSafeInteger(frame.seq) || frame.seq < 0
          || (index > 0 && frame.seq <= page.frames[index - 1].seq))) throw new Error('invalid_coverage');
        if (current === revision && (viewAccess(row, scope).live || viewAccess(row, scope).stored)) output = page;
      } else if (kind === 'history' && row.sourceAvailable && browserKeyAvailable(credentials)) {
        const proof = await contentApi.prepareHistory(row.bindingId);
        if (current !== revision) return;
        const assertion = await browserAssertion(proof, credentials, abort.signal);
        if (current !== revision) return;
        await contentApi.authorizeHistory(row.bindingId, proof, assertion); onchanged();
      } else if (kind === 'revoke' || kind === 'exclude') {
        output = null; revision++;
        await contentApi[kind](row.bindingId); onchanged();
      }
    } catch { failed = true; output = null; }
    finally { busy = false; }
  }
  onDestroy(() => { revision++; abort.abort(); output = null; });
</script>

<section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3" aria-label={$_('sessionContent.viewer')}>
  <h2 class="text-lg font-semibold text-slate-900">{$_('sessionContent.viewer')} · {row.sessionId}</h2>
  {#if access.reason}<p role="status" class="text-sm text-slate-700">{$_(`sessionContent.states.${access.reason}`)}</p>{/if}
  {#if row.lastReceivedAt}<p>{$_('sessionContent.lastReceived')}: {new Date(row.lastReceivedAt).toLocaleString()}</p>{/if}
  {#if row.retained && row.expiresAt !== undefined}<p>{row.expiresAt === null ? $_('sessionContent.none') : `${$_('sessionContent.deadline')}: ${new Date(row.expiresAt).toLocaleString()}`}</p>{/if}
  {#each row.copies ?? [] as copy (copy.objectId)}
    <p>{$_(`sessionContent.${copy.channel === 'terminal.cache' ? 'cache' : 'mirror'}`)} · {copy.expiresAt === null ? $_('sessionContent.none') : `${$_('sessionContent.deadline')}: ${new Date(copy.expiresAt).toLocaleString()}`}</p>
  {/each}
  {#each [...(output?.gaps ?? row.gaps ?? [])].sort((a, b) => a.from - b.from) as gap}
    <p class="rounded border border-yellow-200 bg-yellow-50 p-2 text-yellow-800">{$_('sessionContent.gap')}: {gap.from}–{gap.to} · {gap.reason}</p>
  {/each}
  {#if output}<pre class="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-3 text-sm text-slate-900">{output.frames.map((frame) => frame.text).join('')}</pre>{/if}
  {#if failed}<p role="alert" class="text-red-600">{$_('sessionContent.requestFailed')}</p>{/if}
  <div class="flex flex-wrap gap-2">
    <Button variant="secondary" onclick={() => action('read')} disabled={busy || (!access.live && !access.stored)}>{$_('sessionContent.read')}</Button>
    <Button variant="secondary" onclick={() => action('history')} disabled={busy || !row.retained || row.historyAuthorized || !row.sourceAvailable || !browserKeyAvailable(credentials)}>{$_('sessionContent.historyGrant')}</Button>
    <Button variant="danger" onclick={() => action('exclude')} disabled={busy || row.excluded}>{$_('sessionContent.exclude')}</Button>
    <Button variant="danger" onclick={() => action('revoke')} disabled={busy || row.revoked}>{$_('sessionContent.revoke')}</Button>
  </div>
</section>
