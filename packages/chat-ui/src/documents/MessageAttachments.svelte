<script lang="ts">
  /**
   * MessageAttachments — sent-message attachment rendering: image thumbnails
   * (click opens a lightbox via `onEnlarge`) and file download links.
   *
   * Generic documents-module component: URL resolution is delegated to the
   * host via `onResolveSrc` (e.g. documentId -> download URL); without it the
   * component falls back to previewUrl/url. Pairs with ImageLightbox.
   *
   * ZERO sentropic domain strings. ZERO google-drive code.
   */
  import type { ChatMessageAttachment } from '../state/chatProjection.js';

  interface Props {
    /** The sent message's attachments to render. */
    attachments: ChatMessageAttachment[];

    /**
     * Resolve a display/download URL for an attachment.
     * Falls back to previewUrl, then url, when not provided.
     */
    onResolveSrc?: (attachment: ChatMessageAttachment) => string;

    /**
     * Open a lightbox / enlargement for an image attachment.
     * Called when the user clicks an image thumbnail.
     */
    onEnlarge?: (src: string, alt: string) => void;

    /** Label for the enlarge button. Defaults to 'Enlarge'. */
    enlargeLabel?: string;
  }

  let { attachments, onResolveSrc, onEnlarge, enlargeLabel = 'Enlarge' }: Props = $props();

  function getSrc(attachment: ChatMessageAttachment): string {
    if (onResolveSrc) return onResolveSrc(attachment);
    if (attachment.previewUrl) return attachment.previewUrl;
    if (attachment.url) return attachment.url;
    return '';
  }
</script>

{#if attachments.length > 0}
  <div class="mt-1 flex justify-end" data-testid="chat-message-attachments">
    <div class="grid max-w-[85%] grid-cols-2 gap-1">
      {#each attachments as attachment (attachment.id ?? attachment.documentId ?? attachment.url ?? attachment.fileName)}
        {#if attachment.kind === 'image'}
          {@const imageSrc = getSrc(attachment)}
          <div class="overflow-hidden rounded border border-primary/20 bg-white/10">
            {#if imageSrc}
              <button
                type="button"
                class="block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                aria-label={enlargeLabel}
                title={enlargeLabel}
                onclick={() => onEnlarge?.(imageSrc, attachment.fileName ?? 'image')}
              >
                <img
                  src={imageSrc}
                  alt={attachment.fileName ?? 'image'}
                  class="block h-24 w-24 object-cover"
                  loading="lazy"
                />
              </button>
            {:else}
              <div class="flex h-24 w-24 items-center justify-center bg-slate-100 text-slate-500">
                <!-- image placeholder icon -->
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
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
              </div>
            {/if}
          </div>
        {:else if attachment.kind === 'file'}
          <a
            class="col-span-2 flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
            href={getSrc(attachment)}
            download={attachment.fileName ?? 'document'}
            target="_blank"
            rel="noopener noreferrer"
            title={attachment.fileName ?? 'document'}
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
              aria-hidden="true"
              class="shrink-0 text-primary"
            >
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            </svg>
            <span class="truncate">{attachment.fileName ?? 'document'}</span>
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
              aria-hidden="true"
              class="ml-auto shrink-0 text-slate-400"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
          </a>
        {/if}
      {/each}
    </div>
  </div>
{/if}
