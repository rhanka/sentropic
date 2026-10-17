import type { CanonicalChainRecord, CanonicalReadPage, ResourceRef } from '@sentropic/comments';
import { UnsupportedProfileError } from '../storage/errors.js';
import type { CommentsContext } from './context.js';
import type { CommentsReadRequest, CommentsTargetsRequest } from './read-command.js';
import type { CommentsRevisionRequest, CommentsRevisionRecord } from './command-contracts.js';
import { validateCommentsAdmission } from './admission.js';
export const createCommentsCommandServices = (context: CommentsContext) => ({
  targets: (input: CommentsTargetsRequest): Promise<readonly ResourceRef[]> => context.invoke(input.scope, async ({ storage }) => {
    if (!storage.invoke) throw new UnsupportedProfileError('comments-operational-v1');
    return await storage.invoke('comments.targets', input) as readonly ResourceRef[];
  }),
  revise: (input: CommentsRevisionRequest): Promise<CommentsRevisionRecord> => context.invoke(input.scope, async ({ storage }) => {
    if (!storage.invoke) throw new UnsupportedProfileError('comments-operational-v1');
    validateCommentsAdmission({ ...input.content, kind: `${input.kind}-revision` });
    return await storage.invoke('comments.revision', input) as CommentsRevisionRecord;
  }),
  read: (input: CommentsReadRequest): Promise<CanonicalChainRecord | CanonicalReadPage | null> => context.invoke(input.scope, async ({ storage }) => {
    if (!storage.invoke) throw new UnsupportedProfileError('comments-operational-v1');
    return await storage.invoke('comments.read', input) as CanonicalChainRecord | CanonicalReadPage | null;
  }),
});
