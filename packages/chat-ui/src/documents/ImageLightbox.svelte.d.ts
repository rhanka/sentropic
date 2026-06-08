import type { Component } from 'svelte';

export type ImageLightboxProps = {
  /** The image to preview, or null when the lightbox is closed. */
  image: { src: string; alt: string } | null;
  /** Called on backdrop click, close button, or Escape. */
  onClose?: () => void;
  /** Label for the close controls. Defaults to 'Close'. */
  closeLabel?: string;
  /** Label for the download link. Defaults to 'Download'. */
  downloadLabel?: string;
};

declare const ImageLightbox: Component<ImageLightboxProps>;

export default ImageLightbox;
