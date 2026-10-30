import type { CommentHost } from '@sentropic/chat-core/runtime/comments/host';
import { createCommentRuntime } from '@sentropic/chat-core/runtime/comments/runtime';
import { getCommentAuthorLabel, getMentionLabel, type CommentItem } from '@sentropic/chat-ui/comments';

/** Platform data adapter; all state and commands are the production comment runtime. */
export async function createCommentFixture() {
  const items = new Map<string, CommentItem>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  const host: CommentHost = {
    async listComments({ contextType, contextId }) {
      return { items: [...items.values()].filter((item) => item.context_type === contextType && item.context_id === contextId) };
    },
    async createComment(input) {
      const id = crypto.randomUUID(); const threadId = input.threadId ?? id;
      items.set(id, { id, thread_id: threadId, context_type: input.contextType, context_id: input.contextId,
        section_key: input.sectionKey ?? null, content: input.content, status: 'open', created_at: new Date().toISOString(),
        updated_at: null, created_by: 'member', created_by_user: { id: 'member', displayName: 'Member' },
        assigned_to: input.assignedTo ?? null, assigned_to_user: null });
      changed(); return { id, thread_id: threadId };
    },
    async updateComment(id, input) { items.set(id, { ...items.get(id)!, ...input }); changed(); return { success: true }; },
    async closeComment(id) { items.set(id, { ...items.get(id)!, status: 'closed' }); changed(); return { success: true }; },
    async reopenComment(id) { items.set(id, { ...items.get(id)!, status: 'open' }); changed(); return { success: true }; },
    async deleteComment(id) { items.delete(id); changed(); return { success: true }; },
    async listMentionMembers() { return { items: [{ userId: 'member', email: 'member@example.test', displayName: 'Member' }] }; },
    canComment: () => true, canResolve: () => true, resolveSectionLabel: () => null,
    currentUser: () => ({ id: 'member', email: 'member@example.test', displayName: 'Member' }),
    subscribeCommentUpdates(_type, _id, callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
  };
  const state = createCommentRuntime(host, { getCommentAuthorLabel, getMentionLabel });
  state.actions.setContext({ contextType: 'folder', contextId: 'comments' });
  await state.actions.loadCommentThreads();
  return { host, state, items, listeners, dispose: () => state.dispose() };
}
