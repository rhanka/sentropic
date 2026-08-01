<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { Mail } from '@lucide/svelte';

  import { resolveGmailConnectorCardState } from '$lib/utils/document-source-menu';
  import type { GmailConnection } from '$lib/utils/gmail';

  export let connection: GmailConnection | null = null;
  export let loading = false;
  export let actionInFlight = false;
  export let error = '';

  const dispatch = createEventDispatcher<{
    connect: void;
    disconnect: void;
  }>();

  $: connectorState = resolveGmailConnectorCardState(connection);
  $: isConnected = connectorState.connected;
  const statusClass = isConnected
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-50 text-slate-700 border-slate-200';
</script>

<div
  id="gmail-connectors"
  class="space-y-4 rounded border border-slate-200 bg-white p-6"
  data-testid="gmail-connectors-card"
  tabindex="-1"
>
  <div>
    <h2 class="text-lg font-semibold text-slate-800">{$_('settings.connectors.title')}</h2>
    <p class="mt-1 text-sm text-slate-600">{$_('settings.connectors.description')}</p>
  </div>

  {#if loading}
    <p class="text-sm text-slate-600">{$_('common.loading')}</p>
  {:else}
    <div class="rounded border border-slate-200 bg-slate-50 p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-600">
            <Mail class="h-4 w-4" />
          </span>
          <div>
            <div class="text-sm font-semibold text-slate-800">{$_('settings.connectors.gmail.title')}</div>
            <div class="text-xs text-slate-500">{$_('settings.connectors.gmail.subtitle')}</div>
          </div>
        </div>
        <span class={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass}`}>
          {isConnected
            ? $_('settings.connectors.status.connected')
            : $_('settings.connectors.status.disconnected')}
        </span>
      </div>

      <div class="mt-3 text-sm text-slate-700">
        {#if isConnected}
          {$_('settings.connectors.gmail.connectedAs', {
            values: {
              email: connectorState.accountLabel ?? $_('settings.connectors.gmail.connectedAccount'),
            },
          })}
        {:else}
          {$_('settings.connectors.gmail.disconnectedHint')}
        {/if}
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        {#if isConnected}
          <button
            type="button"
            class="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionInFlight}
            on:click={() => dispatch('disconnect')}
          >
            {$_('settings.connectors.gmail.disconnect')}
          </button>
        {:else}
          <button
            type="button"
            class="inline-flex items-center justify-center rounded bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionInFlight}
            on:click={() => dispatch('connect')}
          >
            {#if actionInFlight}
              {$_('settings.connectors.gmail.loading')}
            {:else}
              {$_('settings.connectors.gmail.connect')}
            {/if}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  {#if error}
    <p class="text-sm text-rose-700">{error}</p>
  {/if}
</div>
