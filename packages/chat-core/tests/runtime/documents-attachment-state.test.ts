/**
 * documents/attachmentState.test.ts
 *
 * Unit tests for the documents module attachment state helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  createComposerAttachmentId,
  composerAttachmentListReducer,
  buildSentAttachments,
  buildAttachmentBandItems,
} from '../src/documents/attachmentState.js';
import type { ChatComposerAttachmentDraft } from '../src/documents/types.js';

// ---------------------------------------------------------------------------
// createComposerAttachmentId
// ---------------------------------------------------------------------------

describe('createComposerAttachmentId', () => {
  it('should return a non-empty string', () => {
    const id = createComposerAttachmentId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should start with att_', () => {
    const id = createComposerAttachmentId();
    expect(id.startsWith('att_')).toBe(true);
  });

  it('should generate unique ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createComposerAttachmentId()));
    expect(ids.size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// composerAttachmentListReducer
// ---------------------------------------------------------------------------

const makeDraft = (overrides: Partial<ChatComposerAttachmentDraft> = {}): ChatComposerAttachmentDraft => ({
  id: 'att_test_1',
  kind: 'image',
  source: 'upload',
  fileName: 'photo.png',
  mimeType: 'image/png',
  sizeBytes: 1024,
  state: 'pending',
  ...overrides,
});

describe('composerAttachmentListReducer', () => {
  describe('add', () => {
    it('should add a draft to an empty list', () => {
      const draft = makeDraft();
      const [next] = composerAttachmentListReducer([], { type: 'add', draft });
      expect(next).toHaveLength(1);
      expect(next[0]).toEqual(draft);
    });

    it('should append to a non-empty list', () => {
      const d1 = makeDraft({ id: 'att_1' });
      const d2 = makeDraft({ id: 'att_2' });
      const [state1] = composerAttachmentListReducer([], { type: 'add', draft: d1 });
      const [state2] = composerAttachmentListReducer(state1, { type: 'add', draft: d2 });
      expect(state2).toHaveLength(2);
      expect(state2[1].id).toBe('att_2');
    });

    it('should return null as the removed item', () => {
      const [, removed] = composerAttachmentListReducer([], { type: 'add', draft: makeDraft() });
      expect(removed).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove a draft by id', () => {
      const d1 = makeDraft({ id: 'att_1' });
      const d2 = makeDraft({ id: 'att_2' });
      const state = [d1, d2];
      const [next] = composerAttachmentListReducer(state, { type: 'remove', id: 'att_1' });
      expect(next).toHaveLength(1);
      expect(next[0].id).toBe('att_2');
    });

    it('should return the removed draft', () => {
      const d1 = makeDraft({ id: 'att_1' });
      const [, removed] = composerAttachmentListReducer([d1], { type: 'remove', id: 'att_1' });
      expect(removed).toEqual(d1);
    });

    it('should return null when id not found', () => {
      const [, removed] = composerAttachmentListReducer([], { type: 'remove', id: 'not_found' });
      expect(removed).toBeNull();
    });
  });

  describe('update', () => {
    it('should patch a draft by id', () => {
      const draft = makeDraft({ id: 'att_1', state: 'pending' });
      const [next] = composerAttachmentListReducer(
        [draft],
        { type: 'update', id: 'att_1', patch: { state: 'ready', documentId: 'doc_abc' } },
      );
      expect(next[0].state).toBe('ready');
      expect(next[0].documentId).toBe('doc_abc');
    });

    it('should not mutate other drafts', () => {
      const d1 = makeDraft({ id: 'att_1', state: 'pending' });
      const d2 = makeDraft({ id: 'att_2', state: 'uploading' });
      const [next] = composerAttachmentListReducer(
        [d1, d2],
        { type: 'update', id: 'att_1', patch: { state: 'ready' } },
      );
      expect(next[1].state).toBe('uploading');
    });

    it('should return null as the removed item', () => {
      const draft = makeDraft();
      const [, removed] = composerAttachmentListReducer(
        [draft],
        { type: 'update', id: draft.id, patch: { state: 'ready' } },
      );
      expect(removed).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all drafts', () => {
      const state = [makeDraft({ id: 'att_1' }), makeDraft({ id: 'att_2' })];
      const [next] = composerAttachmentListReducer(state, { type: 'clear' });
      expect(next).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// buildSentAttachments
// ---------------------------------------------------------------------------

describe('buildSentAttachments', () => {
  it('should include only ready drafts with documentId', () => {
    const drafts: ChatComposerAttachmentDraft[] = [
      makeDraft({ id: 'att_1', state: 'ready', documentId: 'doc_1' }),
      makeDraft({ id: 'att_2', state: 'pending', documentId: 'doc_2' }),
      makeDraft({ id: 'att_3', state: 'failed', documentId: 'doc_3' }),
      makeDraft({ id: 'att_4', state: 'ready' }), // no documentId
    ];
    const result = buildSentAttachments(drafts);
    expect(result).toHaveLength(1);
    expect(result[0].documentId).toBe('doc_1');
  });

  it('should return empty array when no drafts qualify', () => {
    const result = buildSentAttachments([makeDraft({ state: 'uploading' })]);
    expect(result).toHaveLength(0);
  });

  it('should map draft fields to attachment shape', () => {
    const draft = makeDraft({ id: 'att_1', state: 'ready', documentId: 'doc_x', previewUrl: 'blob:x' });
    const [att] = buildSentAttachments([draft]);
    expect(att.documentId).toBe('doc_x');
    expect(att.kind).toBe('image');
    expect(att.fileName).toBe('photo.png');
    expect(att.previewUrl).toBe('blob:x');
  });
});

// ---------------------------------------------------------------------------
// buildAttachmentBandItems
// ---------------------------------------------------------------------------

describe('buildAttachmentBandItems', () => {
  it('should map image kind to image UnifiedAttachmentKind', () => {
    const draft = makeDraft({ id: 'att_1', kind: 'image', mimeType: 'image/png' });
    const items = buildAttachmentBandItems([draft]);
    expect(items[0].kind).toBe('image');
  });

  it('should map file kind to document UnifiedAttachmentKind', () => {
    const draft = makeDraft({ id: 'att_1', kind: 'file', mimeType: 'application/pdf' });
    const items = buildAttachmentBandItems([draft]);
    expect(items[0].kind).toBe('document');
  });

  it('should infer image from mimeType when kind is absent', () => {
    const draft = { id: 'att_1', fileName: 'img.jpg', mimeType: 'image/jpeg', state: 'ready' };
    const items = buildAttachmentBandItems([draft]);
    expect(items[0].kind).toBe('image');
  });

  it('should produce key with att: prefix', () => {
    const draft = makeDraft({ id: 'att_test' });
    const [item] = buildAttachmentBandItems([draft]);
    expect(item.key).toBe('att:att_test');
  });

  it('should preserve documentId and previewUrl', () => {
    const draft = makeDraft({ id: 'att_1', documentId: 'doc_a', previewUrl: 'blob:x' });
    const [item] = buildAttachmentBandItems([draft]);
    expect(item.documentId).toBe('doc_a');
    expect(item.previewUrl).toBe('blob:x');
  });
});
