<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { Cloud, Loader2, Paperclip } from '@lucide/svelte';

  import {
    resolveDocumentSourceGoogleDriveMode,
    resolveGoogleDriveAccountLabel,
  } from '$lib/utils/document-source-menu';
  import { DOCUMENT_UPLOAD_ACCEPT } from '$lib/utils/documents';

  export let localActionLabel = '';
  export let localUploading = false;
  export let googleDriveReady = false;
  export let googleDriveConnected = false;
  export let googleDriveBusy = false;
  export let googleDriveAccountLabel: string | null = null;

  const dispatch = createEventDispatcher<{
    pickLocal: { file: File };
    importGoogleDrive: void;
    openConnectors: void;
  }>();

  $: googleDriveMode = resolveDocumentSourceGoogleDriveMode({
    ready: googleDriveReady,
    connected: googleDriveConnected,
    busy: googleDriveBusy,
  });
  $: normalizedAccountLabel = resolveGoogleDriveAccountLabel({
    accountEmail: googleDriveAccountLabel,
    accountSubject: null,
  });

  const rowClass =
    'flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-700 hover:bg-slate-50';
  const disabledRowClass = `${rowClass} opacity-50 pointer-events-none`;

  const onPickLocalFile = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    dispatch('pickLocal', { file });
  };

  const importGoogleDrive = () => {
    if (googleDriveBusy || !googleDriveConnected) return;
    dispatch('importGoogleDrive');
  };

  const openConnectors = () => {
    if (googleDriveBusy || !googleDriveReady || googleDriveConnected) return;
    dispatch('openConnectors');
  };
</script>

<div class="space-y-2">
  <label
    class={`${rowClass} ${localUploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
    aria-label={localActionLabel}
    title={localActionLabel}
  >
    <input
      class="hidden"
      type="file"
      accept={DOCUMENT_UPLOAD_ACCEPT}
      disabled={localUploading}
      on:change={onPickLocalFile}
    />
    {#if localUploading}
      <Loader2 class="h-4 w-4 animate-spin" />
    {:else}
      <Paperclip class="h-4 w-4" />
    {/if}
    <span>{localUploading ? $_('documents.upload.loading') : localActionLabel}</span>
  </label>

  {#if googleDriveMode === 'connected'}
    <button
      class={`${rowClass} ${googleDriveBusy ? 'opacity-50 pointer-events-none' : ''}`}
      type="button"
      disabled={googleDriveBusy}
      aria-label={$_('chat.documents.googleDrive.import')}
      title={$_('chat.documents.googleDrive.import')}
      on:click={importGoogleDrive}
    >
      <Cloud class="h-4 w-4" />
      <span>
        {googleDriveBusy
          ? $_('chat.documents.googleDrive.loading')
          : $_('chat.documents.googleDrive.import')}
      </span>
    </button>
    <div class="px-1 text-[10px] text-slate-500 truncate">
      {$_('chat.documents.googleDrive.connectedAs', {
        values: {
          email: normalizedAccountLabel ?? $_('chat.documents.googleDrive.connectedAccount'),
        },
      })}
    </div>
  {:else if googleDriveMode === 'loading'}
    <div class={disabledRowClass}>
      <Cloud class="h-4 w-4" />
      <span>{$_('chat.documents.googleDrive.loading')}</span>
    </div>
  {:else}
    <button
      class={rowClass}
      type="button"
      aria-label={$_('documents.googleDrive.manageInSettings')}
      title={$_('documents.googleDrive.manageInSettings')}
      on:click={openConnectors}
    >
      <Cloud class="h-4 w-4" />
      <span>{$_('documents.googleDrive.manageInSettings')}</span>
    </button>
    <div class="px-1 text-[10px] text-slate-500">
      {$_('documents.googleDrive.manageHint')}
    </div>
  {/if}
</div>
