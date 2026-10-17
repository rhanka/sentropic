import type { CanonicalCommandStore } from '@sentropic/comments';
import { CommentsContext, commentsError } from './context.js';
import { CommentsAdapter } from './storage-adapter.js';
export const createCanonicalStore = (context: CommentsContext, adapter: CommentsAdapter): CanonicalCommandStore => Object.freeze<CanonicalCommandStore>({
  transaction: () => {
    const request = context.current();
    return Object.freeze({ handleKind: 'canonical-transaction' as const, async run<T>(operation: () => Promise<T>): Promise<T> {
      if (context.current() !== request) throw commentsError({ code: 'denied' });
      try { return await context.run(operation); } catch (error) { throw commentsError(error); }
    } });
  },
  appendAnnotationRevision: (scope, annotationId, record, expected) => adapter.append(scope, { kind: 'annotation-revisions', annotationId }, record, expected),
  appendThreadStructureRevision: (scope, threadId, record, expected) => adapter.append(scope, { kind: 'thread-structure-revisions', threadId }, record, expected),
  appendCommentRevision: (scope, commentId, record, expected) => adapter.append(scope, { kind: 'comment-revisions', commentId }, record, expected),
  appendReviewEvent: (scope, annotationId, record, expected) => adapter.append(scope, { kind: 'review-events', annotationId }, record, expected),
  appendLifecycleEvent: (scope, objectKind, objectId, record, expected) => adapter.append(scope, { kind: 'lifecycle-events', objectKind, objectId }, record, expected),
  appendOperationAuditEvent: (scope, subject, subjectId, record, expected) => adapter.append(scope, { kind: 'operation-audit-events', subject, subjectId }, record, expected),
  appendPreparedSubmissionManifest: (scope, submissionId, record) => adapter.append(scope, { kind: 'prepared-submission-manifests', submissionId }, record),
  appendImportManifest: (scope, importId, record) => adapter.append(scope, { kind: 'import-manifests', importId }, record),
  appendUnitReceipt: (scope, unitId, record) => adapter.append(scope, { kind: 'unit-receipts', unitId }, record),
  appendBatchReceiptSnapshot: (scope, batchId, record, expected) => adapter.append(scope, { kind: 'batch-receipt-snapshots', batchId }, record, expected),
  appendConversionReport: (scope, reportId, record, expected) => adapter.append(scope, { kind: 'conversion-reports', reportId }, record, expected),
  getAnnotationHead: (scope, annotationId) => adapter.head(scope, { kind: 'annotation-revisions', annotationId }),
  getAnnotationChain: (scope, annotationId) => adapter.chain(scope, { kind: 'annotation-revisions', annotationId }),
  getThreadStructureHead: (scope, threadId) => adapter.head(scope, { kind: 'thread-structure-revisions', threadId }),
  getThreadStructureChain: (scope, threadId) => adapter.chain(scope, { kind: 'thread-structure-revisions', threadId }),
  getCommentHead: (scope, commentId) => adapter.head(scope, { kind: 'comment-revisions', commentId }),
  getCommentChain: (scope, commentId) => adapter.chain(scope, { kind: 'comment-revisions', commentId }),
  getReviewChain: (scope, annotationId) => adapter.chain(scope, { kind: 'review-events', annotationId }),
  getLifecycleChain: (scope, objectKind, objectId) => adapter.chain(scope, { kind: 'lifecycle-events', objectKind, objectId }),
  getOperationAuditChain: (scope, subject, subjectId) => adapter.chain(scope, { kind: 'operation-audit-events', subject, subjectId }),
  readChainPage: (scope, selection, page) => adapter.page(scope, selection, page),
  findCommittedCommand: (scope, key) => adapter.find(scope, key),
  recordCommittedCommand: (scope, key, committed) => adapter.record(scope, key, committed),
});
