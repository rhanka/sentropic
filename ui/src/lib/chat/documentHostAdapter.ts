/**
 * documentHostAdapter.ts — app-side DocumentHost implementation.
 *
 * Implements @sentropic/chat-ui/documents DocumentHost with real
 * app-side logic: REST uploads, document deletion, Drive src resolution,
 * generated file download via docx.ts.
 *
 * All sentropic domain strings, google-drive code, and workspace scoping
 * stay here — NONE of it leaks into the chat-ui package.
 */

import type { DocumentHost } from '@sentropic/chat-ui/documents';
import type { ChatComposerAttachmentDraft, ChatGeneratedFileCard } from '@sentropic/chat-ui/documents';
import {
  uploadDocument,
  deleteDocument,
  getDownloadUrl,
} from '$lib/utils/documents';
import { downloadGeneratedFile } from '$lib/utils/docx';
import { createChatSessionDocumentContext } from '$lib/chat/document-adapter';
import { getScopedWorkspaceIdForUser } from '$lib/stores/workspaceScope';

/**
 * Create a DocumentHost adapter for the Sentropic app.
 *
 * @param getSessionId - Reactive getter for the current session id.
 *   Called at invocation time (not captured at construction time) so it
 *   always reads the current session.
 * @param ensureSessionTarget - Called before upload/drive pick to guarantee
 *   a session exists. Returns the session id (may create one).
 */
export function createDocumentHostAdapter(opts: {
  getSessionId: () => string | null;
  ensureSessionTarget: () => Promise<string>;
}): DocumentHost {
  const { getSessionId, ensureSessionTarget } = opts;

  return {
    async uploadFile(
      draft: ChatComposerAttachmentDraft,
      file: File,
    ): Promise<ChatComposerAttachmentDraft> {
      const targetSessionId = await ensureSessionTarget();
      const scopedWs = getScopedWorkspaceIdForUser();
      try {
        const uploaded = await uploadDocument({
          ...createChatSessionDocumentContext(targetSessionId, scopedWs),
          file,
        });
        return { ...draft, state: 'ready', documentId: uploaded.id };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ...draft, state: 'failed', error: msg };
      }
    },

    async deleteUploadedFile(documentId: string): Promise<void> {
      try {
        await deleteDocument({
          documentId,
          workspaceId: getScopedWorkspaceIdForUser(),
        });
      } catch {
        // swallow — file may already be gone
      }
    },

    resolveAttachmentSrc(
      attachment: Pick<ChatComposerAttachmentDraft, 'previewUrl' | 'documentId'>,
    ): string {
      if (attachment.previewUrl) return attachment.previewUrl;
      if (attachment.documentId) {
        return getDownloadUrl({
          documentId: attachment.documentId,
          workspaceId: getScopedWorkspaceIdForUser(),
        });
      }
      return '';
    },

    async downloadGeneratedFile(card: ChatGeneratedFileCard): Promise<void> {
      await downloadGeneratedFile(card);
    },

    // pickExternalFiles and getExternalPickerState are not implemented here —
    // the app drives Drive picking via DocumentSourceMenu / importSessionDocsFromGoogleDrive
    // which have heavier orchestration (picker config fetch, resolve + attach + reload).
    // They remain app-side in AppChatPanel and are not routed through DocumentHost.
  };
}
