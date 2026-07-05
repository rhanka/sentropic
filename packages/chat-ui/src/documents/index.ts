/**
 * @sentropic/chat-ui/documents
 *
 * Generic document module — pure TS helpers + generic Svelte components.
 * ZERO sentropic domain strings. ZERO google-drive code.
 *
 * Provides:
 *   - DocumentHost interface (D7 app-side adapter seam)
 *   - ChatComposerAttachmentDraft / ChatGeneratedFileCard / UnifiedAttachmentItem
 *     (canonical definitions — old locations re-export from here)
 *   - attachmentState: createComposerAttachmentId, composerAttachmentListReducer,
 *     buildSentAttachments, handleComposerPasteImages, buildAttachmentBandItems
 *   - generatedFileCards: normalizeGeneratedFileCard, extractGeneratedFileCardsFromEvents,
 *     extractGeneratedFileCardsFromRuntimeSummary, getGeneratedFileFormatLabel
 *   - AttachmentBand.svelte — generic chip tray
 *   - GeneratedFileCardTray.svelte — generic card row
 */

// Types
export type {
  ChatAttachmentKind,
  ChatAttachmentSource,
  ChatAttachmentState,
  ChatComposerAttachmentDraft,
  ChatGeneratedFileCard,
  ChatRuntimeSummaryWithGeneratedFiles,
  UnifiedAttachmentKind,
  UnifiedAttachmentItem,
  DocumentHost,
} from './types.js';

// Attachment state helpers
export {
  createComposerAttachmentId,
  composerAttachmentListReducer,
  buildSentAttachments,
  handleComposerPasteImages,
  buildAttachmentBandItems,
} from './attachmentState.js';

export type {
  ComposerAttachmentAction,
  ComposerAttachmentLike,
} from './attachmentState.js';

// Generated file card helpers
export {
  normalizeGeneratedFileCard,
  extractGeneratedFileCardsFromEvents,
  extractGeneratedFileCardsFromRuntimeSummary,
  getGeneratedFileFormatLabel,
} from './generatedFileCards.js';
