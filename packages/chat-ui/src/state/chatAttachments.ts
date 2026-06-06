/**
 * state/chatAttachments.ts
 *
 * Backward-compatible re-export facade for ChatComposerAttachmentDraft and
 * related attachment types. The canonical definitions now live in
 * packages/chat-ui/src/documents/types.ts (D7 documents module).
 *
 * All existing imports of these types from this path continue to resolve
 * without modification. Local helpers (createImageAttachmentDraft,
 * summarizeComposerAttachments, isSupportedImageAttachmentMimeType,
 * ComposerAttachmentSummary) remain here as they are not duplicated.
 */

// Re-export canonical types from documents/types (dedup chain)
export type {
  ChatAttachmentKind,
  ChatAttachmentSource,
  ChatAttachmentState,
  ChatComposerAttachmentDraft,
} from '../documents/types.js';

// Local types that remain in this module (not duplicated elsewhere)

export type ComposerAttachmentSummary = {
  total: number;
  ready: number;
  pending: number;
  uploading: number;
  failed: number;
  images: number;
};

// Local imports for helper implementations
import type {
  ChatAttachmentSource,
  ChatAttachmentState,
  ChatComposerAttachmentDraft,
} from '../documents/types.js';

const SUPPORTED_IMAGE_ATTACHMENT_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const isSupportedImageAttachmentMimeType = (mimeType: string): boolean =>
  SUPPORTED_IMAGE_ATTACHMENT_MIME_TYPES.has(mimeType.trim().toLowerCase());

export const createImageAttachmentDraft = (input: {
  id: string;
  source: ChatAttachmentSource;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  state?: ChatAttachmentState;
  documentId?: string;
  previewUrl?: string;
  error?: string;
}): ChatComposerAttachmentDraft => ({
  id: input.id,
  kind: 'image',
  source: input.source,
  fileName: input.fileName.trim() || 'image',
  mimeType: input.mimeType.trim().toLowerCase(),
  sizeBytes: Math.max(0, Math.floor(input.sizeBytes)),
  state: input.state ?? 'pending',
  ...(input.documentId ? { documentId: input.documentId } : {}),
  ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
  ...(input.error ? { error: input.error } : {}),
});

export const summarizeComposerAttachments = (
  attachments: readonly ChatComposerAttachmentDraft[],
): ComposerAttachmentSummary => ({
  total: attachments.length,
  ready: attachments.filter((attachment) => attachment.state === 'ready').length,
  pending: attachments.filter((attachment) => attachment.state === 'pending').length,
  uploading: attachments.filter((attachment) => attachment.state === 'uploading').length,
  failed: attachments.filter((attachment) => attachment.state === 'failed').length,
  images: attachments.filter((attachment) => attachment.kind === 'image').length,
});
