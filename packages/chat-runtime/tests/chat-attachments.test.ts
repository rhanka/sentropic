import { describe, expect, it } from 'vitest';
import {
  createImageAttachmentDraft,
  isSupportedImageAttachmentMimeType,
  summarizeComposerAttachments,
} from '../src/state/chatAttachments.js';

describe('chat attachment state', () => {
  it('creates normalized image attachment drafts for host-managed uploads', () => {
    expect(
      createImageAttachmentDraft({
        id: 'att_1',
        source: 'paste',
        fileName: ' Screenshot.PNG ',
        mimeType: ' IMAGE/PNG ',
        sizeBytes: 12_345,
        previewUrl: 'blob:preview',
      }),
    ).toEqual({
      id: 'att_1',
      kind: 'image',
      source: 'paste',
      fileName: 'Screenshot.PNG',
      mimeType: 'image/png',
      sizeBytes: 12_345,
      state: 'pending',
      previewUrl: 'blob:preview',
    });
  });

  it('summarizes attachment readiness separately from raw attachment count', () => {
    const ready = createImageAttachmentDraft({
      id: 'ready',
      source: 'upload',
      fileName: 'ready.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      state: 'ready',
      documentId: 'doc_1',
    });
    const uploading = createImageAttachmentDraft({
      id: 'uploading',
      source: 'drive',
      fileName: 'uploading.webp',
      mimeType: 'image/webp',
      sizeBytes: 200,
      state: 'uploading',
    });
    const failed = createImageAttachmentDraft({
      id: 'failed',
      source: 'paste',
      fileName: 'failed.gif',
      mimeType: 'image/gif',
      sizeBytes: 300,
      state: 'failed',
      error: 'Upload failed',
    });

    expect(summarizeComposerAttachments([ready, uploading, failed])).toEqual({
      total: 3,
      ready: 1,
      pending: 0,
      uploading: 1,
      failed: 1,
      images: 3,
    });
  });

  it('limits image attachment MIME types to explicit vision-safe browser images', () => {
    expect(isSupportedImageAttachmentMimeType('image/png')).toBe(true);
    expect(isSupportedImageAttachmentMimeType('image/jpeg')).toBe(true);
    expect(isSupportedImageAttachmentMimeType('image/webp')).toBe(true);
    expect(isSupportedImageAttachmentMimeType('image/gif')).toBe(true);
    expect(isSupportedImageAttachmentMimeType('image/svg+xml')).toBe(false);
    expect(isSupportedImageAttachmentMimeType('application/pdf')).toBe(false);
  });
});
