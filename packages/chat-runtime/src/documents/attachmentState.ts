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
} from '@sentropic/chat-ui/documents';

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
