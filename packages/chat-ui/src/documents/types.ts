/**
 * @sentropic/chat-ui/documents — canonical types (D7 documents module).
 *
 * This file is the single source of truth for:
 *   - ChatComposerAttachmentDraft (deduped from state/chatAttachments + hosts/types)
 *   - GeneratedFileCard / ChatGeneratedFileCard (moved from ui document-adapter)
 *   - UnifiedAttachmentItem (moved from ui documents utils)
 *   - DocumentHost interface (new published seam for app-side document adapters)
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

// ---------------------------------------------------------------------------
// DocumentHost interface — published seam for app-side document adapters
//
// This is the IRREVERSIBLE shape — review carefully before changing.
// The host implements all domain-specific logic (Drive, REST, workspace scope).
// The package only calls these methods generically.
// ---------------------------------------------------------------------------

/**
 * App-side document host adapter.
 *
 * The app implements this interface to wire drive/REST/docx download into
 * the generic AttachmentBand and GeneratedFileCardTray components.
 *
 * All methods are framework-neutral (no Svelte imports, no DOM references
 * in the contract itself — implementations may use the DOM internally).
 *
 * uploadFile: upload a file for the draft id, returns the updated draft
 *   (state 'ready' on success, 'failed' on error).
 * deleteUploadedFile: delete a previously uploaded file by documentId.
 *   The host should swallow errors gracefully if the file no longer exists.
 * pickExternalFiles: optional — open an external file picker (e.g. Drive).
 *   Returns an array of new drafts to add to the composer. Omit if the host
 *   does not support external pickers.
 * resolveAttachmentSrc: return a URL string for a given attachment so the
 *   band can render an image preview. May be synchronous or async.
 * downloadGeneratedFile: trigger a download for a generated file card.
 * getExternalPickerState: optional — return the current state of the external
 *   picker integration (connected, loading, account label). Used for UI feedback.
 */
export interface DocumentHost {
  /**
   * Upload a file for the given draft. Returns the updated draft.
   * On success: draft.state = 'ready', draft.documentId is set.
   * On failure: draft.state = 'failed', draft.error is set.
   */
  uploadFile(
    draft: ChatComposerAttachmentDraft,
    file: File,
  ): Promise<ChatComposerAttachmentDraft>;

  /**
   * Delete an uploaded file by its documentId.
   * Should swallow 404 / already-deleted errors.
   */
  deleteUploadedFile(documentId: string): Promise<void>;

  /**
   * Optional: open an external file picker.
   * Returns new drafts to add to the composer.
   */
  pickExternalFiles?(): Promise<ChatComposerAttachmentDraft[]>;

  /**
   * Resolve a display URL for an attachment.
   * Used by AttachmentBand to render image previews.
   */
  resolveAttachmentSrc(
    attachment: Pick<ChatComposerAttachmentDraft, 'previewUrl' | 'documentId'>,
  ): string | Promise<string>;

  /**
   * Download a generated file card.
   */
  downloadGeneratedFile(card: ChatGeneratedFileCard): Promise<void>;

  /**
   * Optional: return external picker connection state for UI feedback.
   */
  getExternalPickerState?(): {
    ready: boolean;
    connected: boolean;
    busy: boolean;
    accountLabel?: string;
  };
}
