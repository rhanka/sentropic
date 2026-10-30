import type { ChatComposerAttachmentDraft, ChatGeneratedFileCard } from '@sentropic/chat-ui/documents';

/** Host-owned document I/O. Domain resolution and external pickers stay with the host. */
export interface DocumentHost {
  /** Return a ready draft with documentId, or a failed draft with error. */
  uploadFile(draft: ChatComposerAttachmentDraft, file: File): Promise<ChatComposerAttachmentDraft>;
  /** Deleting an absent file should succeed. */
  deleteUploadedFile(documentId: string): Promise<void>;
  pickExternalFiles?(): Promise<ChatComposerAttachmentDraft[]>;
  resolveAttachmentSrc(
    attachment: Pick<ChatComposerAttachmentDraft, 'previewUrl' | 'documentId'>,
  ): string | Promise<string>;
  downloadGeneratedFile(card: ChatGeneratedFileCard): Promise<void>;
  getExternalPickerState?(): {
    ready: boolean;
    connected: boolean;
    busy: boolean;
    accountLabel?: string;
  };
}
