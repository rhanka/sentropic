/**
 * @sentropic/chat-ui/documents — canonical types (D7 documents module).
 *
 * This file is the single source of truth for:
 *   - ChatComposerAttachmentDraft (deduped from state/chatAttachments + hosts/types)
 *   - GeneratedFileCard / ChatGeneratedFileCard (moved from ui document-adapter)
 *   - UnifiedAttachmentItem (moved from ui documents utils)
 *
 * ZERO sentropic domain strings. ZERO google-drive code.
 * App-side concerns (Drive, REST, workspace scoping) belong in the host adapter.
 */

// ---------------------------------------------------------------------------
// Attachment draft — canonical definition (deduped from state/chatAttachments
// and hosts/types; old locations re-export from here to avoid breaking consumers)
// ---------------------------------------------------------------------------

export type ChatAttachmentKind = 'image' | 'file';

export type ChatAttachmentSource = 'paste' | 'upload' | 'drive' | 'context_document' | 'external_url';

export type ChatAttachmentState = 'pending' | 'uploading' | 'ready' | 'failed';

/**
 * Canonical definition of a composer attachment draft.
 * Previously duplicated in state/chatAttachments.ts and hosts/types.ts;
 * both locations now re-export from here.
 */
export type ChatComposerAttachmentDraft = {
  id: string;
  kind: ChatAttachmentKind;
  source: ChatAttachmentSource;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  state: ChatAttachmentState;
  documentId?: string;
  previewUrl?: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// Generated file card — moved from ui/src/lib/chat/document-adapter.ts
// ---------------------------------------------------------------------------

/**
 * A generated file card produced by the document_generate tool (or equivalent).
 * Previously defined in ui/src/lib/utils/docx.ts and ui/src/lib/chat/document-adapter.ts;
 * this is the canonical package-level definition.
 */
export type ChatGeneratedFileCard = {
  jobId: string;
  fileName: string;
  format?: string;
  mimeType?: string;
  downloadUrl?: string;
};

export type ChatRuntimeSummaryWithGeneratedFiles = {
  generatedFileCards?: Array<
    Partial<ChatGeneratedFileCard> & Pick<ChatGeneratedFileCard, 'jobId' | 'fileName'>
  >;
  docxCards?: Array<Pick<ChatGeneratedFileCard, 'jobId' | 'fileName'>>;
};

// ---------------------------------------------------------------------------
// Unified attachment item — generic chip tray row shape
// ---------------------------------------------------------------------------

export type UnifiedAttachmentKind = 'image' | 'document';

/**
 * A single item rendered in the attachment band (composer chip tray).
 * Kind is 'image' or 'document' (not 'file') to avoid leaking wire protocol kinds.
 */
export type UnifiedAttachmentItem = {
  key: string;
  kind: UnifiedAttachmentKind;
  fileName: string;
  mimeType: string;
  status: string;
  documentId?: string;
  composerAttachmentId: string;
  previewUrl?: string;
};

