import { describe, expect, it } from 'vitest';

import {
  isComment,
  isCommentEvent,
  isCommentTarget,
  isCommentThreadSummary,
  targetFromLive,
  targetToLive,
  type Comment,
  type CommentEvent,
  type CommentTarget,
  type CommentThreadSummary,
  type LiveCommentTarget,
} from '../src/index.js';

const tenant = {
  tenantId: 'tnt_1',
  workspaceId: 'wsp_1',
  userId: 'usr_1',
};

describe('domain guards', () => {
  it('accepts a well-formed Comment and rejects malformed input', () => {
    const comment: Comment = {
      id: 'cmt_1',
      tenant,
      target: { kind: 'message', id: 'msg_1' },
      threadId: 'thr_1',
      author: { id: 'usr_1', kind: 'human' },
      state: 'open',
      body: 'hello',
      createdAt: '2026-06-02T10:00:00.000Z',
    };
    expect(isComment(comment)).toBe(true);
    expect(isComment({ ...comment, state: 'closed' })).toBe(false);
    expect(isComment({ ...comment, target: { kind: 'usecase', id: 'x' } })).toBe(
      false,
    );
    expect(isComment({ ...comment, id: 42 })).toBe(false);
  });

  it('validates every CommentTargetKind including record/field with sectionKey', () => {
    const kinds: CommentTarget[] = [
      { kind: 'message', id: 'm', sectionKey: 'range:1-3' },
      { kind: 'canvas', id: 'c', sectionKey: 'block.2' },
      { kind: 'artifact', id: 'a' },
      { kind: 'field', id: 'f', recordType: 'matrix', sectionKey: 'description' },
      {
        kind: 'record',
        id: 'r',
        recordType: 'matrix',
        sectionKey: 'matrix.cell.x.y',
      },
    ];
    for (const target of kinds) {
      expect(isCommentTarget(target)).toBe(true);
    }
    expect(isCommentTarget({ kind: 'usecase', id: 'x' })).toBe(false);
  });

  it('parses a CommentEvent and a CommentThreadSummary', () => {
    const event: CommentEvent = {
      type: 'reassigned',
      tenant,
      target: { kind: 'record', id: 'r', recordType: 'folder' },
      commentId: 'cmt_1',
      threadId: 'thr_1',
    };
    expect(isCommentEvent(event)).toBe(true);
    expect(isCommentEvent({ ...event, type: 'closed' })).toBe(false);

    const summary: CommentThreadSummary = {
      threadId: 'thr_1',
      contextType: 'folder',
      target: { kind: 'record', id: 'r', recordType: 'folder' },
      rootMessage: 'root',
      rootMessageAt: '2026-06-02T10:00:00.000Z',
      lastMessage: 'last',
      lastMessageAt: '2026-06-02T10:05:00.000Z',
      messageCount: 2,
      status: 'open',
    };
    expect(isCommentThreadSummary(summary)).toBe(true);
    expect(isCommentThreadSummary({ ...summary, messageCount: '2' })).toBe(false);
  });
});

describe('target round-trip (lossless)', () => {
  it('round-trips the live {contextType, contextId, sectionKey} with no loss', () => {
    const cases: LiveCommentTarget[] = [
      { contextType: 'organization', contextId: 'org_1', sectionKey: null },
      { contextType: 'folder', contextId: 'fld_1', sectionKey: 'description' },
      { contextType: 'initiative', contextId: 'ini_1', sectionKey: null },
      { contextType: 'matrix', contextId: 'mtx_1', sectionKey: 'matrix.cell.2.3' },
      {
        contextType: 'executive_summary',
        contextId: 'exs_1',
        sectionKey: 'summary',
      },
    ];
    for (const live of cases) {
      const target = targetFromLive(live);
      expect(target.kind).toBe('record');
      expect(target.recordType).toBe(live.contextType);
      expect(target.id).toBe(live.contextId);
      expect(targetToLive(target)).toEqual(live);
    }
  });

  it('preserves sectionKey verbatim and maps absent sectionKey to null', () => {
    const withSection = targetFromLive({
      contextType: 'matrix',
      contextId: 'm',
      sectionKey: 'matrix.cell.x.y',
    });
    expect(withSection.sectionKey).toBe('matrix.cell.x.y');

    const withoutSection = targetFromLive({
      contextType: 'folder',
      contextId: 'f',
      sectionKey: null,
    });
    expect(withoutSection.sectionKey).toBeUndefined();
    expect(targetToLive(withoutSection).sectionKey).toBeNull();
  });
});
