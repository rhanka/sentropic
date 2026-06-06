import type { Component } from 'svelte';
import type { UnifiedAttachmentItem } from './types.js';

export type AttachmentBandProps = {
  /** The attachment items to render. */
  items: UnifiedAttachmentItem[];
  /** Resolve a display URL for an image attachment (kind === 'image'). */
  onResolveSrc?: (item: UnifiedAttachmentItem) => string;
  /** Open a lightbox / enlargement for an image attachment. */
  onEnlarge?: (item: UnifiedAttachmentItem, src: string) => void;
  /** Remove an attachment from the composer. */
  onRemove?: (item: UnifiedAttachmentItem) => void;
  /** Label for the remove button. Defaults to 'Remove'. */
  removeLabel?: string;
  /** Label for the enlarge button. Defaults to 'Enlarge'. */
  enlargeLabel?: string;
  /** Label shown when the attachment is loading. Defaults to 'Loading'. */
  loadingLabel?: string;
  /** Label shown when the attachment failed. Defaults to 'Error'. */
  errorLabel?: string;
};

declare const AttachmentBand: Component<AttachmentBandProps>;

export default AttachmentBand;
