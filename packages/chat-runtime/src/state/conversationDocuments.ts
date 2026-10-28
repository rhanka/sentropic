import type { ChatComposerAttachmentDraft, DocumentHost } from '@sentropic/chat-ui/documents';
import type { ChatSessionRuntime } from './chatSessionRuntime.js';

/** Retain upload inputs and owned preview URLs with the session, never with a view. */
export function createConversationDocuments(session: ChatSessionRuntime, host?: DocumentHost) {
  const files = new Map<string, File>();
  const urls = new Map<string, string>();
  let disposed = false;
  const release = (id: string) => {
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id); files.delete(id);
  };
  const update = (draft: ChatComposerAttachmentDraft) => {
    if (disposed) return;
    session.setAttachments(session.snapshot().attachments.map((entry) => entry.id === draft.id ? draft : entry));
  };
  const upload = async (draft: ChatComposerAttachmentDraft, file: File) => {
    if (!host) throw new Error('Attachment host unavailable');
    update({ ...draft, state: 'uploading', error: undefined });
    try {
      let next = await host.uploadFile({ ...draft, state: 'uploading', error: undefined }, file);
      if (disposed || !session.snapshot().attachments.some((entry) => entry.id === draft.id)) {
        if (next.documentId) await host.deleteUploadedFile(next.documentId);
        return;
      }
      if (next.kind === 'image' && !next.previewUrl) next = { ...next, previewUrl: await host.resolveAttachmentSrc(next) };
      update(next);
    } catch (error) {
      update({ ...draft, state: 'failed', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const unsubscribe = session.subscribe((snapshot) => {
    const retained = new Set(snapshot.attachments.map((entry) => entry.id));
    for (const id of files.keys()) if (!retained.has(id)) release(id);
  });
  return {
    async attach(filesToAdd: File[], source: 'upload' | 'paste' = 'upload') {
      if (!host) throw new Error('Attachment host unavailable');
      for (const file of filesToAdd) {
        if (disposed) return;
        const id = crypto.randomUUID();
        const previewUrl = file.type.startsWith('image/') && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(file) : undefined;
        files.set(id, file);
        if (previewUrl) urls.set(id, previewUrl);
        const draft: ChatComposerAttachmentDraft = { id, kind: file.type.startsWith('image/') ? 'image' : 'file',
          source, fileName: file.name, mimeType: file.type, sizeBytes: file.size, state: 'pending', previewUrl };
        session.setAttachments([...session.snapshot().attachments, draft]);
        await upload(draft, file);
      }
    },
    async retry(id: string) {
      const draft = session.snapshot().attachments.find((entry) => entry.id === id);
      const file = files.get(id);
      if (draft && file && draft.state === 'failed') await upload(draft, file);
    },
    async remove(id: string) {
      const draft = session.snapshot().attachments.find((entry) => entry.id === id);
      if (!draft || disposed) return;
      if (draft.documentId) await host?.deleteUploadedFile(draft.documentId);
      if (!disposed) session.setAttachments(session.snapshot().attachments.filter((entry) => entry.id !== id));
    },
    dispose() { disposed = true; unsubscribe(); for (const id of files.keys()) release(id); },
  };
}
