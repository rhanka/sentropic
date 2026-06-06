/**
 * @sentropic/chat-ui/documents — attachment state helpers.
 *
 * Generic, framework-neutral helpers for managing the composer attachment list.
 * No sentropic domain strings. No google-drive code.
 *
 * Extracted from inline logic in AppChatPanel and ui/utils/documents.ts.
 */

import type {
  ChatComposerAttachmentDraft,
  ChatAttachmentKind,
  ChatAttachmentSource,
  ChatAttachmentState,
  UnifiedAttachmentItem,
} from './types.js';

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Create a unique, opaque id for a new composer attachment draft.
 */
export const createComposerAttachmentId = (): string =>
  `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Reducer actions
// ---------------------------------------------------------------------------

export type ComposerAttachmentAction =
  | { type: 'add'; draft: ChatComposerAttachmentDraft }
  | { type: 'remove'; id: string }
  | {
      type: 'update';
      id: string;
      patch: Partial<ChatComposerAttachmentDraft>;
    }
  | { type: 'clear' };

/**
 * Pure reducer for the composer attachment list.
 * All mutations go through this function; the caller owns the state.
 *
 * The 'remove' action returns the removed draft (if any) via the second
 * element of the tuple so callers can revoke object URLs.
 */
export function composerAttachmentListReducer(
  state: readonly ChatComposerAttachmentDraft[],
  action: ComposerAttachmentAction,
): [readonly ChatComposerAttachmentDraft[], ChatComposerAttachmentDraft | null] {
  switch (action.type) {
    case 'add':
      return [[...state, action.draft], null];
    case 'remove': {
      const removed = state.find((a) => a.id === action.id) ?? null;
      return [state.filter((a) => a.id !== action.id), removed];
    }
    case 'update':
      return [
        state.map((a) =>
          a.id === action.id ? { ...a, ...action.patch } : a,
        ),
        null,
      ];
    case 'clear':
      return [[], null];
    default:
      return [state, null];
  }
}

// ---------------------------------------------------------------------------
// buildSentAttachments
// ---------------------------------------------------------------------------

import type { ChatMessageAttachment } from '../state/chatProjection.js';

/**
 * Build the array of ChatMessageAttachment[] to send with a chat message.
 * Only 'ready' attachments with a documentId are included.
 */
export function buildSentAttachments(
  composerAttachments: readonly ChatComposerAttachmentDraft[],
): ChatMessageAttachment[] {
  return composerAttachments
    .filter((a): a is ChatComposerAttachmentDraft & { documentId: string } =>
      a.state === 'ready' && typeof a.documentId === 'string' && a.documentId.length > 0,
    )
    .map((a) => ({
      documentId: a.documentId,
      kind: a.kind,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      previewUrl: a.previewUrl,
    }));
}

// ---------------------------------------------------------------------------
// Paste image helper
// ---------------------------------------------------------------------------

/**
 * Filter clipboard files to supported image types.
 * Returns { handled: true, files } when at least one image was found.
 * Returns { handled: false } when no supported images were found.
 *
 * The SUPPORTED_IMAGE_MIME_TYPES set is parameterized so callers can extend it.
 */
const DEFAULT_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function handleComposerPasteImages(
  event: ClipboardEvent,
  opts?: { supportedMimeTypes?: Set<string> },
): { handled: boolean; files: File[] } {
  const supported = opts?.supportedMimeTypes ?? DEFAULT_IMAGE_MIME_TYPES;
  const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
    supported.has(f.type.trim().toLowerCase()),
  );
  if (files.length === 0) return { handled: false, files: [] };
  return { handled: true, files };
}

// ---------------------------------------------------------------------------
// buildAttachmentBandItems
// ---------------------------------------------------------------------------

/** Minimal structural shape — avoids tight coupling to the full draft type. */
export type ComposerAttachmentLike = {
  id: string;
  kind?: ChatAttachmentKind;
  documentId?: string;
  fileName: string;
  mimeType: string;
  state: ChatAttachmentState | string;
  previewUrl?: string;
};

function isImageMimeType(mimeType: string): boolean {
  return mimeType.trim().toLowerCase().startsWith('image/');
}

/**
 * Build the composer attachment band items from the current draft list.
 * Keeps the same key shape as the previous composerBandItems() helper in
 * ui/utils/documents.ts so AppChatPanel migration is a drop-in swap.
 */
export function buildAttachmentBandItems(
  composerAttachments: readonly ComposerAttachmentLike[],
): UnifiedAttachmentItem[] {
  return composerAttachments.map((att) => ({
    key: `att:${att.id}`,
    kind:
      att.kind === 'file'
        ? 'document'
        : att.kind === 'image' || isImageMimeType(att.mimeType)
          ? 'image'
          : 'document',
    fileName: att.fileName,
    mimeType: att.mimeType,
    status: att.state,
    documentId: att.documentId,
    composerAttachmentId: att.id,
    previewUrl: att.previewUrl,
  }));
}
