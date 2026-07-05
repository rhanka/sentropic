<script lang="ts">
  /**
   * AttachmentBand — generic composer attachment chip tray.
   *
   * Renders a row of attachment chips (images or file icons) with optional
   * enlarge and remove callbacks. All domain-specific logic (URL resolution,
   * delete API call) is delegated to the host via callbacks.
   *
   * ZERO sentropic domain strings. ZERO google-drive code.
   */
  import type { UnifiedAttachmentItem } from './types.js';

  interface Props {
    /** The attachment items to render. */
    items: UnifiedAttachmentItem[];

    /**
     * Resolve a display URL for an image attachment.
     * Called only for items with kind === 'image'.
     */
    onResolveSrc?: (item: UnifiedAttachmentItem) => string;

    /**
     * Open a lightbox / enlargement for an image attachment.
     * Called when the user clicks the image thumbnail.
     */
    onEnlarge?: (item: UnifiedAttachmentItem, src: string) => void;

    /**
     * Remove an attachment from the composer.
     * Called when the user clicks the X button on a chip.
     */
    onRemove?: (item: UnifiedAttachmentItem) => void;

    /** Label for the remove button. Defaults to 'Remove'. */
    removeLabel?: string;

    /** Label for the enlarge button. Defaults to 'Enlarge'. */
    enlargeLabel?: string;

    /** Label shown when the attachment is loading. Defaults to 'Loading'. */
    loadingLabel?: string;

    /** Label shown when the attachment failed. Defaults to 'Error'. */
    errorLabel?: string;
  }

  let {
    items,
    onResolveSrc,
    onEnlarge,
    onRemove,
    removeLabel = 'Remove',
    enlargeLabel = 'Enlarge',
    loadingLabel = 'Loading',
    errorLabel = 'Error',
  }: Props = $props();

  function getImageSrc(item: UnifiedAttachmentItem): string {
    if (onResolveSrc) return onResolveSrc(item);
    if (item.previewUrl) return item.previewUrl;
    return '';
  }

  function getStatusLabel(item: UnifiedAttachmentItem): string {
    if (item.status === 'failed') return errorLabel;
    if (item.status === 'ready') return item.mimeType;
    return loadingLabel;
  }
</script>

{#if items.length > 0}
  <div class="mb-2 flex flex-wrap gap-2" data-testid="chat-composer-attachment-band">
    {#each items as item (item.key)}
      {@const imageSrc = item.kind === 'image' ? getImageSrc(item) : ''}
      <div
        class="flex h-14 min-w-0 max-w-[12rem] items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
      >
        {#if item.kind === 'image' && imageSrc}
          <button
            type="button"
            class="h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-label={enlargeLabel}
            title={enlargeLabel}
            onclick={() => onEnlarge?.(item, imageSrc)}
          >
            <img src={imageSrc} alt={item.fileName} class="h-10 w-10 object-cover" />
          </button>
        {:else}
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500"
          >
            {#if item.kind === 'image'}
              <!-- image placeholder icon (no lucide import in generic component) -->
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
                aria-hidden="true"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
            {:else}
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
                aria-hidden="true"
              >
                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              </svg>
            {/if}
          </div>
        {/if}

        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">{item.fileName}</div>
          <div class="truncate text-slate-400">{getStatusLabel(item)}</div>
        </div>

        {#if onRemove}
          <button
            class="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            type="button"
            aria-label={removeLabel}
            title={removeLabel}
            onclick={() => onRemove?.(item)}
          >
            <!-- X icon -->
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}
