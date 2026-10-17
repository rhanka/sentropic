import type { CanonicalLifecycleRequest } from '@sentropic/comments';
import type { RootPurgeJob } from '../storage/staged-state.js';
import { UnsupportedProfileError } from '../storage/errors.js';
import type { CommentsContext } from './context.js';
import type { CommentsLifecycleResult } from './lifecycle-contracts.js';
export const createCommentsServices = (context: CommentsContext) => Object.freeze({
  lifecycle: (request: CanonicalLifecycleRequest): Promise<CommentsLifecycleResult> => context.invoke(request.scope, async ({ storage }) => {
    if (!storage.invoke) throw new UnsupportedProfileError('comments-operational-v1');
    return await storage.invoke('comments.lifecycle', request) as CommentsLifecycleResult;
  }),
  completePurge: (intentId: string): Promise<RootPurgeJob> => context.invoke(context.current().grant.scope, async ({ storage }) => {
    if (!storage.completePurge) throw new UnsupportedProfileError('purge-jobs-v1');
    return storage.completePurge(intentId);
  }),
});
