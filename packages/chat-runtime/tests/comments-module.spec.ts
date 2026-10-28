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
