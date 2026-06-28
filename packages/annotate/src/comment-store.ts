import type {
  AddCommentInput,
  Comment,
  CommentAuthor,
  CommentQuery,
  CommentStore,
  CommentUpdate,
} from './types';

let seq = 0;
const nid = (p: string) => `${p}-${++seq}`;

/**
 * @deprecated DEDUP FLAG (canevas-libs-centralize) — this in-memory CommentStore and its
 * companion comment types in `./types` DUPLICATE the published thread model in
 * `@sentropic/comments` (CommentStore port + InMemoryCommentStore + transport-agnostic wire
 * events + thread summaries; its CommentTarget already covers a `canvas` kind). Per the owner
 * default, `@sentropic/annotate` must remain the GEOMETRY / CERCLAGE primitive only
 * (Anchor/Selection/SelectionCapture + geometry.ts + the Svelte AnnotationLayer) and must NOT
 * own thread lifecycle.
 *
 * FOLLOW-UP LOT (not done here — centralize-only): rewire this store to defer thread
 * lifecycle to `@sentropic/comments` (map this geometry anchor → CommentTarget{kind:'canvas',
 * sectionKey}, drop the duplicated Comment/CommentStore/CommentUpdate shapes from `./types`,
 * and re-export the comments port instead). Left in place for now to avoid breaking the diag
 * canvas adapter that consumes it; do not extend it.
 *
 * Default CommentStore — in-memory, sentropic-compatible shape. Emits `comment_update` so a
 * host can drive realtime exactly like @sentropic/chat-ui's streamHub expects.
 */
export function createInMemoryCommentStore(opts: { now?: () => string } = {}): CommentStore {
  const now = opts.now ?? (() => new Date().toISOString());
  const comments: Comment[] = [];
  const subs = new Set<(e: CommentUpdate) => void>();
  const emit = (comment: Comment) => subs.forEach((cb) => cb({ type: 'comment_update', comment }));

  const make = (
    base: Pick<Comment, 'contextType' | 'contextId' | 'sectionKey' | 'threadId'>,
    content: string,
    author: CommentAuthor,
    createdBy: string,
    toolCallId: string | null,
  ): Comment => ({
    id: nid('cmt'),
    ...base,
    content,
    author,
    toolCallId,
    status: 'open',
    createdBy,
    createdAt: now(),
  });

  return {
    list(q: CommentQuery = {}) {
      return comments.filter(
        (c) =>
          (q.contextType === undefined || c.contextType === q.contextType) &&
          (q.contextId === undefined || c.contextId === q.contextId) &&
          (q.status === undefined || c.status === q.status),
      );
    },
    add(input: AddCommentInput) {
      const c = make(
        {
          contextType: input.contextType,
          contextId: input.contextId,
          sectionKey: input.sectionKey,
          threadId: input.threadId ?? nid('thr'),
        },
        input.content,
        input.author,
        input.createdBy,
        input.toolCallId ?? null,
      );
      comments.push(c);
      emit(c);
      return c;
    },
    reply(threadId, content, author, createdBy, toolCallId = null) {
      const head = comments.find((c) => c.threadId === threadId);
      if (!head) return null;
      const c = make(
        { contextType: head.contextType, contextId: head.contextId, sectionKey: head.sectionKey, threadId },
        content,
        author,
        createdBy,
        toolCallId,
      );
      comments.push(c);
      emit(c);
      return c;
    },
    resolve(threadId) {
      let head: Comment | undefined;
      for (const c of comments) {
        if (c.threadId === threadId) {
          c.status = 'resolved';
          head ??= c;
        }
      }
      if (head) emit(head);
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/**
 * Structured annotation context for the AI (objectId + content + status, NOT pixels).
 * The chat layer decides how to inject it (via the proven render_mermaid local-tool handoff).
 */
export function annotationsForAI(
  store: CommentStore,
  ctx: { contextType: string; contextId: string },
): Array<{ threadId: string; objectId: string; content: string; author: CommentAuthor }> {
  return store
    .list({ contextType: ctx.contextType, contextId: ctx.contextId, status: 'open' })
    .map((c) => ({ threadId: c.threadId, objectId: c.sectionKey, content: c.content, author: c.author }));
}
