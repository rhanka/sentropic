<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { Cloud } from '@lucide/svelte';

  import { resolveGoogleDriveConnectorCardState } from '$lib/utils/document-source-menu';
  import type { GoogleDriveConnection } from '$lib/utils/google-drive';

  export let connection: GoogleDriveConnection | null = null;
  export let loading = false;
  export let actionInFlight = false;
  export let error = '';

  const dispatch = createEventDispatcher<{
    connect: void;
    disconnect: void;
  }>();

  $: connectorState = resolveGoogleDriveConnectorCardState(connection);
  $: isConnected = connectorState.connected;
  const statusClass = isConnected
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-50 text-slate-700 border-slate-200';
</script>

<div class="space-y-4 rounded border border-slate-200 bg-white p-6" data-testid="google-drive-connectors-card">
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
            <Cloud class="h-4 w-4" />
          </span>
          <div>
            <div class="text-sm font-semibold text-slate-800">{$_('settings.connectors.googleDrive.title')}</div>
            <div class="text-xs text-slate-500">{$_('settings.connectors.googleDrive.subtitle')}</div>
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
          {$_('settings.connectors.googleDrive.connectedAs', {
            values: {
              email: connectorState.accountLabel ?? $_('chat.documents.googleDrive.connectedAccount'),
            },
          })}
        {:else}
          {$_('settings.connectors.googleDrive.disconnectedHint')}
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
            {$_('settings.connectors.googleDrive.disconnect')}
          </button>
        {:else}
          <button
            type="button"
            class="inline-flex items-center justify-center rounded bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionInFlight}
            on:click={() => dispatch('connect')}
          >
            {#if actionInFlight}
              {$_('chat.documents.googleDrive.loading')}
            {:else}
              {$_('settings.connectors.googleDrive.connect')}
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
