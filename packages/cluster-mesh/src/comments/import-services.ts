import { UnsupportedProfileError } from '../storage/errors.js';
import type { CanonicalStoreScope } from '@sentropic/comments';
import type { CommentsContext } from './context.js';
import type { CommentsImportState } from './import-state.js';
import { completeCommentsReceipt } from './import-recovery.js';
import type { CommentsCommitImportRequest, CommentsPrepareImportRequest, CommentsFragmentAcknowledgement, CommentsCompleteReceipt } from './transport-contracts.js';
import type { StagedUnitStatus } from '../storage/staged-units.js';
import type { CommentsPreparedReference } from './transport-contracts.js';
export const createCommentsImportServices = (context: CommentsContext) => ({
  inspectPreparedImport: (input: { readonly scope: CanonicalStoreScope; readonly operationId: string; readonly bindingDigest: string }) => context.invoke(input.scope, async ({ storage }) => {
    if (!storage.invoke) throw new UnsupportedProfileError('comments-import-v1');
    return await storage.invoke('comments.import.progress', input) as { readonly status: StagedUnitStatus; readonly acceptedFragments: string; readonly prepared: CommentsPreparedReference | null };
  }),
  prepareImportFragment: (input: CommentsPrepareImportRequest): Promise<CommentsFragmentAcknowledgement> => context.invoke(input.binding.request.scope, async ({ storage }) => {
    if (!storage.invoke) throw new UnsupportedProfileError('comments-import-v1');
    return await storage.invoke('comments.import.prepare', input) as CommentsFragmentAcknowledgement;
  }),
  commitPreparedImport: (input: CommentsCommitImportRequest) => context.invoke(input.request.scope, async ({ storage }) => {
    if (!storage.invoke || !storage.sealStep || !storage.commitStaged) throw new UnsupportedProfileError('comments-import-v1');
    const control = await storage.invoke('comments.import.inspect', input) as { state: CommentsImportState };
    const state = control.state;
    const step = await storage.sealStep({ unit: state.unit!, root: state.root!, fence: input.fence, limits: input.limits });
    if (!step.seal) return { state: 'preparing' as const, work: step.work };
    const kernel = await storage.commitStaged({ seal: step.seal, fence: input.fence });
    return { state: 'committed' as const, receipt: completeCommentsReceipt(state, kernel) };
  }),
  recoverBatchReceipts: (input: { readonly scope: CanonicalStoreScope; readonly batchId: string; readonly manifestHash: string }): Promise<readonly CommentsCompleteReceipt[]> => context.invoke(input.scope, async ({ storage }) => {
    if (!storage.invoke) throw new UnsupportedProfileError('comments-import-v1');
    return await storage.invoke('comments.import.recover', input) as readonly CommentsCompleteReceipt[];
  }),
});
