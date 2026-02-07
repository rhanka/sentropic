<script lang="ts">
  import {
    CirclePlus,
    Download,
    FileDown,
    Printer,
    Trash2,
    Upload,
  } from '@lucide/svelte';
  import MenuPopover from '$lib/components/MenuPopover.svelte';
  import MenuTriggerButton from '$lib/components/MenuTriggerButton.svelte';

  export let placement: 'up' | 'down' = 'down';
  export let align: 'left' | 'right' = 'right';
  export let widthClass = 'w-56';

  export let labelNew = 'Nouveau';
  export let labelImport = 'Importer';
  export let labelExport = 'Exporter';
  export let labelDownloadDocx = 'Download DOCX';
  export let labelPrint = 'Imprimer';
  export let labelDelete = 'Supprimer';

  export let onNew: (() => void) | null = null;
  export let onImport: (() => void) | null = null;
  export let onExport: (() => void) | null = null;
  export let onDownloadDocx: (() => void) | null = null;
  export let onPrint: (() => void) | null = null;
  export let onDelete: (() => void) | null = null;

  export let disabledNew = false;
  export let disabledImport = false;
  export let disabledExport = false;
  export let disabledDownloadDocx = false;
  export let disabledPrint = false;
  export let disabledDelete = false;

  export let showNew = true;
  export let showImport = true;
  export let showExport = true;
  export let showDownloadDocx = false;
  export let showPrint = true;
  export let showDelete = true;

  export let triggerTitle = 'Actions';
  export let triggerAriaLabel = 'Actions';
  export let triggerClassName = '';

  const itemClass =
    'w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50 flex items-center gap-2';
  const disabledClass = 'opacity-50 pointer-events-none';

  let triggerButtonRef: HTMLButtonElement | null = null;
</script>

<MenuPopover {placement} {align} {widthClass} bind:triggerRef={triggerButtonRef}>
  <svelte:fragment slot="trigger" let:toggle let:disabled>
    <MenuTriggerButton
      bind:buttonRef={triggerButtonRef}
      className={triggerClassName}
      title={triggerTitle}
      ariaLabel={triggerAriaLabel}
      on:click={toggle}
      disabled={disabled}
    />
  </svelte:fragment>
  <svelte:fragment slot="menu" let:close>
    <div class="space-y-1">
      {#if showNew}
        <button
          class={`${itemClass} ${disabledNew ? disabledClass : ''}`}
          type="button"
          on:click={() => {
            close();
            onNew?.();
          }}
          disabled={disabledNew}
        >
          <CirclePlus class="w-4 h-4" />
          <span>{labelNew}</span>
        </button>
      {/if}
      {#if showImport}
        <button
          class={`${itemClass} ${disabledImport ? disabledClass : ''}`}
          type="button"
          on:click={() => {
            close();
            onImport?.();
          }}
          disabled={disabledImport}
        >
          <Upload class="w-4 h-4" />
          <span>{labelImport}</span>
        </button>
      {/if}
      {#if showExport}
        <button
          class={`${itemClass} ${disabledExport ? disabledClass : ''}`}
          type="button"
          on:click={() => {
            close();
            onExport?.();
          }}
          disabled={disabledExport}
        >
          <Download class="w-4 h-4" />
          <span>{labelExport}</span>
        </button>
      {/if}
      {#if showDownloadDocx}
        <button
          class={`${itemClass} ${disabledDownloadDocx ? disabledClass : ''}`}
          type="button"
          on:click={() => {
            close();
            onDownloadDocx?.();
          }}
          disabled={disabledDownloadDocx}
        >
          <FileDown class="w-4 h-4" />
          <span>{labelDownloadDocx}</span>
        </button>
      {/if}
      {#if showPrint}
        <button
          class={`${itemClass} ${disabledPrint ? disabledClass : ''}`}
          type="button"
          on:click={() => {
            close();
            onPrint?.();
          }}
          disabled={disabledPrint}
        >
          <Printer class="w-4 h-4" />
          <span>{labelPrint}</span>
        </button>
      {/if}
      {#if showDelete}
        <button
          class={`${itemClass} text-red-600 hover:bg-red-50 ${disabledDelete ? disabledClass : ''}`}
          type="button"
          on:click={() => {
            close();
            onDelete?.();
          }}
          disabled={disabledDelete}
        >
          <Trash2 class="w-4 h-4" />
          <span>{labelDelete}</span>
        </button>
      {/if}
    </div>
  </svelte:fragment>
</MenuPopover>
