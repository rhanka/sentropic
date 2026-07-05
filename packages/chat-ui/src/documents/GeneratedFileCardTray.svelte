<script lang="ts">
  /**
   * GeneratedFileCardTray — generic generated file card row.
   *
   * Renders a list of ChatGeneratedFileCard items with a download button.
   * All download logic is delegated to the host via the onDownload callback.
   *
   * ZERO sentropic domain strings. ZERO google-drive code.
   */
  import type { ChatGeneratedFileCard } from './types.js';
  import { getGeneratedFileFormatLabel } from './generatedFileCards.js';

  interface Props {
    /** The generated file cards to render. */
    cards: ChatGeneratedFileCard[];

    /**
     * Download callback — called when the user clicks the download button.
     * The host implements the actual download logic (resolve URL, fetch, etc.).
     */
    onDownload?: (card: ChatGeneratedFileCard) => void;

    /** Label for the download button. Defaults to 'Download'. */
    downloadLabel?: string;
  }

  let {
    cards,
    onDownload,
    downloadLabel = 'Download',
  }: Props = $props();
</script>

{#each cards as card (card.jobId)}
  <div
    class="rounded border border-slate-200 bg-white px-2 py-1.5 flex items-center gap-2 max-w-[14rem] mt-1"
    data-testid="generated-file-card"
  >
    <!-- file icon -->
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="w-4 h-4 text-primary shrink-0"
      aria-hidden="true"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>

    <div class="min-w-0 flex-1">
      <div class="text-xs font-medium text-slate-900 truncate">{card.fileName}</div>
      <div class="text-[10px] text-slate-500">{getGeneratedFileFormatLabel(card.format)}</div>
    </div>

    {#if onDownload}
      <button
        class="ml-auto text-primary hover:bg-slate-100 rounded p-1"
        type="button"
        aria-label={downloadLabel}
        title={downloadLabel}
        onclick={() => onDownload?.(card)}
      >
        <!-- download icon -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="w-3.5 h-3.5"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
      </button>
    {/if}
  </div>
{/each}
