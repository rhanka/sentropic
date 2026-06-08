<script lang="ts">
  /**
   * ImageLightbox — full-screen overlay preview for a single image.
   *
   * Generic documents-module component: the host owns which image is open
   * (the `image` prop) and reacts to `onClose` (backdrop click, close button,
   * Escape). Pairs with the `onEnlarge` callbacks of AttachmentBand and
   * MessageAttachments. Image-only by design.
   *
   * ZERO sentropic domain strings. ZERO google-drive code.
   */

  interface Props {
    /** The image to preview, or null when the lightbox is closed. */
    image: { src: string; alt: string } | null;

    /** Called on backdrop click, close button, or Escape. */
    onClose?: () => void;

    /** Label for the close controls. Defaults to 'Close'. */
    closeLabel?: string;

    /** Label for the download link. Defaults to 'Download'. */
    downloadLabel?: string;
  }

  let { image, onClose, closeLabel = 'Close', downloadLabel = 'Download' }: Props = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (!image) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if image}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    data-testid="chat-image-lightbox"
  >
    <button
      type="button"
      class="absolute inset-0 h-full w-full cursor-default"
      aria-label={closeLabel}
      onclick={() => onClose?.()}
    ></button>
    <div class="relative z-10 flex max-h-full max-w-full flex-col items-center gap-2">
      <div class="flex items-center gap-2 self-end">
        <a
          class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          href={image.src}
          download={image.alt}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={downloadLabel}
          title={downloadLabel}
        >
          <!-- download icon -->
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
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
          </svg>
        </a>
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label={closeLabel}
          title={closeLabel}
          onclick={() => onClose?.()}
        >
          <!-- X icon -->
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
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <img
        src={image.src}
        alt={image.alt}
        class="max-h-[80vh] max-w-[90vw] rounded object-contain shadow-2xl"
      />
    </div>
  </div>
{/if}
