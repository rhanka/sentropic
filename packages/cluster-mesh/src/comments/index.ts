import { validateCapacityDescriptor } from '@sentropic/comments';
import type { ScopeGrant } from '../storage/authority.js';
import type { CommentsModuleOptions } from './storage-contracts.js';
import { CommentsContext } from './context.js';
import { CommentsAdapter } from './storage-adapter.js';
import { createCanonicalStore } from './store.js';
import { own, invalid } from './storage-schema.js';
export const createCommentsModule = (options: CommentsModuleOptions) => {
  const capacity = own(options.capacity); validateCapacityDescriptor(capacity);
  if (options.storage.moduleId !== 'comments') invalid('comments requires its own generic storage binding');
  const binding = Object.freeze({ moduleId: 'comments', bind: options.storage.bind.bind(options.storage) });
  const context = new CommentsContext(binding); const adapter = new CommentsAdapter(context, capacity);
  const store = createCanonicalStore(context, adapter);
  return Object.freeze({ store, withContext: <T>(grant: ScopeGrant<unknown>, operation: () => Promise<T>) => context.enter(grant, operation) });
};
export type { CommentsModuleOptions, CommentsStorageBinding, CommentsStorage } from './storage-contracts.js';
export { createCommentsPostgresRegistration, createCommentsPostgresStorage, COMMENTS_DESCRIPTOR, COMMENTS_CONTRACT_DIGEST } from './postgres.js';
