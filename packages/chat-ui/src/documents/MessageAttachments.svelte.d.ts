import type { Component } from 'svelte';
import type { ChatMessageAttachment } from '../state/chatProjection.js';

export type MessageAttachmentsProps = {
  /** The sent message's attachments to render. */
  attachments: ChatMessageAttachment[];
  /** Resolve a display/download URL for an attachment (fallback: previewUrl, then url). */
  onResolveSrc?: (attachment: ChatMessageAttachment) => string;
  /** Open a lightbox / enlargement for an image attachment. */
  onEnlarge?: (src: string, alt: string) => void;
  /** Label for the enlarge button. Defaults to 'Enlarge'. */
  enlargeLabel?: string;
};

declare const MessageAttachments: Component<MessageAttachmentsProps>;

export default MessageAttachments;
