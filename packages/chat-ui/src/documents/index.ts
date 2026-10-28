/** Neutral attachment view contracts; assembly and uploads live in chat-runtime. */
export type {
  ChatAttachmentKind, ChatAttachmentSource, ChatAttachmentState, ChatComposerAttachmentDraft,
  ChatGeneratedFileCard, ChatRuntimeSummaryWithGeneratedFiles, UnifiedAttachmentKind,
  UnifiedAttachmentItem, DocumentHost,
} from './types.js';
export { getGeneratedFileFormatLabel } from './file-format.js';
