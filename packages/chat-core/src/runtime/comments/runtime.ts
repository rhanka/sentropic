import type { CommentHost } from './host.js';
import { createCommentState } from './state.js';
import type { CommentPresentation } from './utils.js';

/** Hosts retain comment state and update subscriptions above view instances. */
export function createCommentRuntime(host: CommentHost, presentation: CommentPresentation) {
  const state = createCommentState(host, presentation);
  let unsubscribe: (() => void) | undefined;
  let contextKey = '';
  let disposed = false;
  return {
    subscribe: state.subscribe,
    actions: {
      ...state.actions,
      setContext(params: Parameters<typeof state.actions.setContext>[0]) {
        if (disposed) return;
        state.actions.setContext(params);
        const next = `${params.contextType ?? ''}:${params.contextId ?? ''}`;
        if (next === contextKey) return;
        contextKey = next;
        unsubscribe?.();
        unsubscribe = state.actions.subscribeUpdates();
        void state.actions.loadMentionMembers();
      },
    },
    dispose() { disposed = true; unsubscribe?.(); },
  };
}
