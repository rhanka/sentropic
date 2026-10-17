import type { CanonicalCommandStore } from '@sentropic/comments';
import type { CommentsContext } from './context.js';
import type { createCommentsServices } from './services.js';
const bindings = new WeakMap<CanonicalCommandStore, { readonly context: CommentsContext; readonly services: ReturnType<typeof createCommentsServices> }>();
export const registerCommentsRouterBinding = (store: CanonicalCommandStore, binding: NonNullable<ReturnType<typeof commentsRouterBinding>>): void => { bindings.set(store, binding); };
export const commentsRouterBinding = (store: CanonicalCommandStore) => bindings.get(store);
