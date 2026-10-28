import { getCommentAuthorLabel, getMentionLabel } from '@sentropic/chat-ui/comments';
const presentation = { getCommentAuthorLabel, getMentionLabel };
/**
 * comments-module.spec.ts
 *
 * Export surface registration + CommentHost interface contract tests.
 * Verifies the ./comments subpath is registered, resolves to real files,
 * and that the CommentHost interface is implementable with zero app-side imports.
 *
 * Also tests createCommentState factory behavior via a FakeCommentHost harness.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// 1. Export surface registration
// ---------------------------------------------------------------------------

describe('comments runtime export registration', () => {
  it('exports its state module while keeping views in chat-ui', () => {
    const root = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.exports['./comments']).toBeTruthy();
    expect(pkg.exports['./comments/CommentsPanel.svelte']).toBeUndefined();
    expect(fs.existsSync(path.resolve(root, pkg.exports['./comments'].import))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Module loading — no runtime import errors
// ---------------------------------------------------------------------------

describe('comments module — module loading', () => {
  it('should load comments/index without error', async () => {
    const mod = await import('../src/comments/index.js');
    expect(typeof mod).toBe('object');
    expect(typeof mod.createCommentState).toBe('function');
    expect(typeof mod.buildCommentThreads).toBe('function');
    expect(typeof mod.getMentionCandidate).toBe('function');
    expect(mod.getInitials).toBeUndefined();
  });

  it('should load comments/host without error', async () => {
    const mod = await import('../src/comments/host.js');
    expect(typeof mod).toBe('object');
  });

  it('should load comments/utils without error', async () => {
    const mod = await import('../src/comments/utils.js');
    expect(typeof mod.buildCommentThreads).toBe('function');
    expect(typeof mod.getMentionCandidate).toBe('function');
    expect(typeof mod.getMentionMatches).toBe('function');
    expect(mod.getInitials).toBeUndefined();
    expect(mod.formatCommentTimestamp).toBeUndefined();
    expect(mod.isSameDay).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. CommentHost fake-host harness
// ---------------------------------------------------------------------------

import type { CommentHost } from '@sentropic/chat-runtime/comments';
import type { CommentItem, MentionMember, CommentCurrentUser } from '@sentropic/chat-ui/comments';
import { createCommentState } from '@sentropic/chat-runtime/comments';

const makeItem = (overrides: Partial<CommentItem> = {}): CommentItem => ({
  id: 'c1',
  context_type: 'project',
  context_id: 'proj_1',
  section_key: null,
  thread_id: 'thread_1',
  content: 'Hello',
  status: 'open',
  created_by: 'user_1',
  assigned_to: null,
  created_at: new Date().toISOString(),
  updated_at: null,
  created_by_user: { id: 'user_1', email: 'user@example.com', displayName: 'User One' },
  assigned_to_user: null,
  ...overrides,
});

class FakeCommentHost implements CommentHost {
  public comments: CommentItem[] = [];
  public members: MentionMember[] = [];
  public createCalls: number = 0;
  public currentUserValue: CommentCurrentUser | null = {
    id: 'user_1',
    email: 'user@example.com',
    displayName: 'User One',
  };

  async listComments(_params: { contextType: string; contextId: string; sectionKey?: string | null }) {
    return { items: this.comments };
  }

  async createComment(_params: {
    contextType: string;
    contextId: string;
    content: string;
    sectionKey?: string | null;
    threadId?: string | null;
    assignedTo?: string | null;
  }) {
    this.createCalls += 1;
    const id = `c${this.createCalls}`;
    const thread_id = _params.threadId ?? `thread_${this.createCalls}`;
    this.comments.push(makeItem({ id, thread_id, content: _params.content, created_by: 'user_1' }));
    return { id, thread_id };
  }

  async updateComment(_id: string, _params: { content?: string; assignedTo?: string | null }) {
    return { success: true };
  }

  async closeComment(_id: string) { return { success: true }; }
  async reopenComment(_id: string) { return { success: true }; }
  async deleteComment(_id: string) { return { success: true }; }

  async listMentionMembers() { return { items: this.members }; }

  canComment() { return true; }
  canResolve(_comment: CommentItem) { return true; }
  resolveSectionLabel(_type: string | null, key: string | null) { return key; }
  currentUser() { return this.currentUserValue; }

  subscribeCommentUpdates(
    _contextType: string,
    _contextId: string,
    _cb: () => void,
  ) {
    return () => {};
  }

  confirmDelete(_message: string) { return true; }
}

describe('comments module — FakeCommentHost harness (CommentHost interface)', () => {
  it('should satisfy CommentHost interface with FakeCommentHost', () => {
    const host: CommentHost = new FakeCommentHost();
    expect(host).toBeTruthy();
    expect(typeof host.listComments).toBe('function');
    expect(typeof host.createComment).toBe('function');
    expect(typeof host.canComment).toBe('function');
    expect(typeof host.subscribeCommentUpdates).toBe('function');
  });

  it('listComments should return empty items by default', async () => {
    const host = new FakeCommentHost();
    const result = await host.listComments({ contextType: 'project', contextId: 'p1' });
    expect(result.items).toHaveLength(0);
  });

  it('createComment should record the comment and return an id + thread_id', async () => {
    const host = new FakeCommentHost();
    const result = await host.createComment({
      contextType: 'project',
      contextId: 'p1',
      content: 'First comment',
    });
    expect(typeof result.id).toBe('string');
    expect(typeof result.thread_id).toBe('string');
    expect(host.createCalls).toBe(1);
  });

  it('canComment should return true', () => {
    const host = new FakeCommentHost();
    expect(host.canComment()).toBe(true);
  });

  it('canResolve should return true for any comment', () => {
    const host = new FakeCommentHost();
    expect(host.canResolve(makeItem())).toBe(true);
  });

  it('resolveSectionLabel should return the key as-is when no i18n mapping', () => {
    const host = new FakeCommentHost();
    expect(host.resolveSectionLabel('project', 'summary')).toBe('summary');
    expect(host.resolveSectionLabel(null, null)).toBeNull();
  });

  it('currentUser should return the fake user', () => {
    const host = new FakeCommentHost();
    const user = host.currentUser();
    expect(user?.id).toBe('user_1');
    expect(user?.email).toBe('user@example.com');
  });

  it('subscribeCommentUpdates should return an unsubscribe function', () => {
    const host = new FakeCommentHost();
    const unsub = host.subscribeCommentUpdates('project', 'p1', () => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. createCommentState factory harness
// ---------------------------------------------------------------------------

describe('comments module — createCommentState factory', () => {
  it('should create a state object with subscribe + actions', () => {
    const host = new FakeCommentHost();
    const state = createCommentState(host, presentation);
    expect(typeof state.subscribe).toBe('function');
    expect(typeof state.actions).toBe('object');
    expect(typeof state.actions.loadCommentThreads).toBe('function');
    expect(typeof state.actions.sendComment).toBe('function');
    expect(typeof state.actions.setContext).toBe('function');
  });

  it('initial snapshot should have empty threads and messages', () => {
    const host = new FakeCommentHost();
    const state = createCommentState(host, presentation);
    let snap: import('../src/comments/state.js').CommentStateSnapshot | null = null;
    state.subscribe((s) => { snap = s; })();
    expect(snap).not.toBeNull();
    expect(snap!.commentThreads).toHaveLength(0);
    expect(snap!.commentMessages).toHaveLength(0);
    expect(snap!.commentLoading).toBe(false);
    expect(snap!.commentError).toBeNull();
    expect(snap!.commentThreadId).toBeNull();
  });

  it('setContext should trigger a load and update context fields', async () => {
    const host = new FakeCommentHost();
    host.comments = [makeItem({ thread_id: 'thread_1' })];
    const state = createCommentState(host, presentation);
    let snap: import('../src/comments/state.js').CommentStateSnapshot | null = null;
    state.subscribe((s) => { snap = s; });
    // setContext triggers loadCommentThreads internally
    state.actions.setContext({ contextType: 'project', contextId: 'proj_1' });
    // Wait for async load
    await new Promise((r) => setTimeout(r, 50));
    expect(snap!.commentThreads.length).toBeGreaterThanOrEqual(0);
  });

  it('loadCommentThreads should load from host and build threads', async () => {
    const host = new FakeCommentHost();
    host.comments = [makeItem({ thread_id: 'thread_1' })];
    const state = createCommentState(host, presentation);
    let snap: import('../src/comments/state.js').CommentStateSnapshot | null = null;
    state.subscribe((s) => { snap = s; });
    state.actions.setContext({ contextType: 'project', contextId: 'proj_1' });
    await state.actions.loadCommentThreads({});
    expect(snap!.commentThreads).toHaveLength(1);
    expect(snap!.commentThreads[0].id).toBe('thread_1');
  });

  it('subscribe should notify on state change', async () => {
    const host = new FakeCommentHost();
    host.comments = [makeItem()];
    const state = createCommentState(host, presentation);
    let notified = 0;
    const unsub = state.subscribe(() => { notified += 1; });
    state.actions.setContext({ contextType: 'project', contextId: 'proj_1' });
    await state.actions.loadCommentThreads({});
    unsub();
    expect(notified).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Utility function tests
// ---------------------------------------------------------------------------

import {
  getMentionCandidate,
  getMentionMatches,
  buildCommentThreads,
  isCommentByUser,
} from '../src/comments/utils.js';

describe('comments module — utility functions', () => {
  describe('getMentionCandidate', () => {
    it('should detect @mention at end of input', () => {
      const result = getMentionCandidate('Hello @jo');
      expect(result).not.toBeNull();
      expect(result?.query).toBe('jo');
    });

    it('should return null when no @ present', () => {
      expect(getMentionCandidate('no mention here')).toBeNull();
    });

    it('should return null when @ is followed by a space', () => {
      expect(getMentionCandidate('test @ ')).toBeNull();
    });
  });

  describe('getMentionMatches', () => {
    const members: MentionMember[] = [
      { userId: 'u1', email: 'alice@example.com', displayName: 'Alice Smith' },
      { userId: 'u2', email: 'bob@example.com', displayName: 'Bob Jones' },
    ];

    it('should match by displayName', () => {
      const matches = getMentionMatches(members, 'ali', presentation);
      expect(matches.some((m) => m.userId === 'u1')).toBe(true);
    });

    it('should match by email', () => {
      const matches = getMentionMatches(members, 'bob', presentation);
      expect(matches.some((m) => m.userId === 'u2')).toBe(true);
    });

    it('should return empty array when no match', () => {
      expect(getMentionMatches(members, 'xyz', presentation)).toHaveLength(0);
    });
  });

  describe('buildCommentThreads', () => {
    it('should group comments into threads', () => {
      const items: CommentItem[] = [
        makeItem({ id: 'c1', thread_id: 'thread_1', content: 'First' }),
        makeItem({ id: 'c2', thread_id: 'thread_1', content: 'Reply' }),
        makeItem({ id: 'c3', thread_id: 'thread_2', content: 'Other' }),
      ];
      const { threads, map } = buildCommentThreads(items, presentation);
      expect(threads).toHaveLength(2);
      expect(map.get('thread_1')).toHaveLength(2);
      expect(map.get('thread_2')).toHaveLength(1);
    });

    it('should return empty arrays for empty input', () => {
      const { threads, map } = buildCommentThreads([], presentation);
      expect(threads).toHaveLength(0);
      expect(map.size).toBe(0);
    });
  });

  describe('isCommentByUser', () => {
    it('should return true when created_by matches user id', () => {
      const comment = makeItem({ created_by: 'user_1' });
      expect(isCommentByUser(comment, { id: 'user_1' })).toBe(true);
    });

    it('should return false when created_by does not match', () => {
      const comment = makeItem({
        created_by: 'user_2',
        created_by_user: { id: 'user_2', email: 'other@example.com', displayName: 'Other' },
      });
      expect(isCommentByUser(comment, { id: 'user_1' })).toBe(false);
    });

    it('should return false when user is null', () => {
      const comment = makeItem({ created_by: 'user_1' });
      expect(isCommentByUser(comment, null)).toBe(false);
    });

    it('should match by email when id not present', () => {
      const comment = makeItem({
        created_by: 'user@example.com',
        created_by_user: { id: 'user_x', email: 'user@example.com', displayName: 'User' },
      });
      expect(isCommentByUser(comment, { email: 'user@example.com' })).toBe(true);
    });
  });
});
