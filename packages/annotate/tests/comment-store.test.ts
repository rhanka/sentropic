import { describe, it, expect, vi } from 'vitest';
import { createInMemoryCommentStore, annotationsForAI } from '../src/comment-store';
import type { CommentUpdate } from '../src/types';

const ctx = { contextType: 'diagram', contextId: 'sess-1' };

describe('in-memory CommentStore (sentropic shape)', () => {
  it('adds a human comment anchored to a node and emits comment_update', () => {
    const store = createInMemoryCommentStore();
    const events: CommentUpdate[] = [];
    store.subscribe((e) => events.push(e));
    const c = store.add({ ...ctx, sectionKey: 'Auth', content: 'should be async', author: 'human', createdBy: 'df-1' });
    expect(c).toMatchObject({ contextType: 'diagram', sectionKey: 'Auth', author: 'human', status: 'open', toolCallId: null });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'comment_update', comment: { id: c.id } });
  });

  it('an AI reply joins the thread with a toolCallId marker', () => {
    const store = createInMemoryCommentStore();
    const head = store.add({ ...ctx, sectionKey: 'Auth', content: 'make async?', author: 'human', createdBy: 'df-1' });
    const reply = store.reply(head.threadId, 'Done — switched Auth to an async check.', 'ai', 'assistant', 'tc-9');
    expect(reply).toMatchObject({ threadId: head.threadId, author: 'ai', toolCallId: 'tc-9', sectionKey: 'Auth' });
    expect(store.list({ ...ctx })).toHaveLength(2);
  });

  it('resolve closes the whole thread and drops it from the AI feed', () => {
    const store = createInMemoryCommentStore();
    const a = store.add({ ...ctx, sectionKey: 'Auth', content: 'one', author: 'human', createdBy: 'df-1' });
    store.add({ ...ctx, sectionKey: 'Home', content: 'two', author: 'human', createdBy: 'df-1' });
    expect(annotationsForAI(store, ctx)).toHaveLength(2);
    store.resolve(a.threadId);
    const feed = annotationsForAI(store, ctx);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ objectId: 'Home', content: 'two' });
  });

  it('annotationsForAI returns structured context (objectId + content), not pixels', () => {
    const store = createInMemoryCommentStore();
    store.add({ ...ctx, sectionKey: 'Login', content: 'rename to Sign in', author: 'human', createdBy: 'df-1' });
    expect(annotationsForAI(store, ctx)).toEqual([
      { threadId: expect.any(String), objectId: 'Login', content: 'rename to Sign in', author: 'human' },
    ]);
  });

  it('reply to an unknown thread returns null', () => {
    const store = createInMemoryCommentStore();
    expect(store.reply('nope', 'x', 'human', 'df-1')).toBeNull();
  });
});
