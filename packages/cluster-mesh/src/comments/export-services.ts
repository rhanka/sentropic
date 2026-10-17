import type { CanonicalBatchExportRequest, CanonicalBatchExportResponse } from '@sentropic/comments';
import { UnsupportedProfileError } from '../storage/errors.js';
import type { CommentsContext } from './context.js';
import type {
  CommentsExportSelection,
  CommentsExportPreparation,
  CommentsExportFragmentPage,
} from './transport-contracts.js';
export const createCommentsExportServices = (context: CommentsContext) => ({
  prepareExportBoundary: (
    selection: CommentsExportSelection,
    continuation: string | null = null,
  ): Promise<CommentsExportPreparation> =>
    context.invoke(selection.scope, async ({ storage }) => {
      if (!storage.invoke) throw new UnsupportedProfileError('comments-export-v1');
      return (await storage.invoke('comments.export.prepare', {
        selection,
        continuation,
      })) as CommentsExportPreparation;
    }),
  readExportFragments: (
    request: CanonicalBatchExportRequest,
    continuation: string | null = null,
    limit = 50,
  ): Promise<CommentsExportFragmentPage> =>
    context.invoke(request.scope, async ({ storage }) => {
      if (!storage.invoke) throw new UnsupportedProfileError('comments-export-v1');
      return (await storage.invoke('comments.export.fragments', {
        request,
        continuation,
        limit,
      })) as CommentsExportFragmentPage;
    }),
  continueExport: (
    request: CanonicalBatchExportRequest,
    continuation: string | null = null,
    limit = 50,
  ): Promise<CanonicalBatchExportResponse> =>
    context.invoke(request.scope, async ({ storage }) => {
      if (!storage.invoke) throw new UnsupportedProfileError('comments-export-v1');
      return (await storage.invoke('comments.export.records', {
        request,
        continuation,
        limit,
      })) as CanonicalBatchExportResponse;
    }),
});
