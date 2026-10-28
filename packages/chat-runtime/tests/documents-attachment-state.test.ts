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
