import {
  canonicalJson,
  createAnnotationRevision,
  createThreadStructureRevision,
  createCommentRevision,
  createPreparedSubmissionManifest,
  createOperationAuditEvent,
  resourceKey,
} from '@sentropic/comments';
import type {
  CanonicalChainRecord,
  CanonicalReadSelection,
  CapacityDescriptor,
  AnnotationRevisionRecord,
  CommentRevisionRecord,
  ThreadStructureRevisionRecord,
  OperationAuditEventRecord,
} from '@sentropic/comments';
import { invalid, validateRecordHash } from './storage-schema.js';
export type LookupCommentsRecord = (
  selection: CanonicalReadSelection,
  hash?: string,
) => Promise<CanonicalChainRecord | null>;
export const validateCommentsRecord = async (
  record: CanonicalChainRecord,
  previous: CanonicalChainRecord | null,
  capacity: CapacityDescriptor,
  lookup: LookupCommentsRecord,
): Promise<void> => {
  validateRecordHash(record);
  if (Buffer.byteLength(canonicalJson([record]), 'utf8') > 524288)
    invalid('canonical record exceeds complete fragment payload representation');
  if (record.kind === 'annotation-revision') {
    const { kind: _kind, hash: _hash, link: _link, ...input } = record;
    if (createAnnotationRevision(previous as AnnotationRevisionRecord | null, input, capacity).hash !== record.hash)
      invalid('annotation envelope mismatch');
  } else if (record.kind === 'thread-structure-revision') {
    const { kind: _kind, hash: _hash, link: _link, ...input } = record;
    if (
      createThreadStructureRevision(previous as ThreadStructureRevisionRecord | null, input, capacity).hash !==
      record.hash
    )
      invalid('thread envelope mismatch');
    if (record.annotationId !== null) {
      const annotation = (await lookup({
        kind: 'annotation-revisions',
        annotationId: record.annotationId,
      })) as AnnotationRevisionRecord | null;
      if (!annotation || resourceKey(annotation.primary.resource) !== resourceKey(record.primary.resource))
        invalid('thread annotation primary mismatch');
    }
  } else if (record.kind === 'comment-revision') {
    const { kind: _kind, hash: _hash, link: _link, ...input } = record;
    if (createCommentRevision(previous as CommentRevisionRecord | null, input, capacity).hash !== record.hash)
      invalid('comment envelope mismatch');
    if (previous && (previous as CommentRevisionRecord).threadId !== record.threadId)
      invalid('comment thread is immutable');
    const structure = (await lookup(
      { kind: 'thread-structure-revisions', threadId: record.threadId },
      record.structureRevision.hash,
    )) as ThreadStructureRevisionRecord | null;
    if (record.structureRevision.id !== record.threadId || !structure)
      return invalid('exact structural reference is missing');
    if (structure.annotationId !== null && record.annotationPin?.annotationId !== structure.annotationId)
      invalid('annotation-bound comment pin mismatch');
    if (
      record.annotationPin &&
      !(await lookup(
        { kind: 'annotation-revisions', annotationId: record.annotationPin.annotationId },
        record.annotationPin.revisionHash,
      ))
    )
      invalid('exact annotation pin is missing');
    if (record.parentCommentId !== null) {
      const parent = (await lookup({
        kind: 'comment-revisions',
        commentId: record.parentCommentId,
      })) as CommentRevisionRecord | null;
      if (!parent || parent.threadId !== record.threadId)
        invalid('comment parent belongs to another thread or is missing');
    }
  } else if (record.kind === 'review-event') {
    if (!(await lookup({ kind: 'annotation-revisions', annotationId: record.annotationId }, record.revisionHash)))
      invalid('reviewed annotation revision is missing');
    if (
      record.referencesEventHash !== null &&
      !(await lookup({ kind: 'review-events', annotationId: record.annotationId }, record.referencesEventHash))
    )
      invalid('referenced review event is missing');
  } else if (record.kind === 'operation-audit-event') {
    const { kind: _kind, hash: _hash, link: _link, ...input } = record;
    if (
      createOperationAuditEvent(previous ? [previous as OperationAuditEventRecord] : [], input, capacity).hash !==
      record.hash
    )
      invalid('audit envelope mismatch');
  } else if (record.kind === 'prepared-submission-manifest') {
    const { kind: _kind, hash: _hash, ...input } = record;
    if (createPreparedSubmissionManifest(input, capacity).hash !== record.hash) invalid('submission envelope mismatch');
    if (
      !(await lookup(
        { kind: 'annotation-revisions', annotationId: record.annotation.annotationId },
        record.annotation.revisionHash,
      ))
    )
      invalid('prepared annotation is missing');
  }
};
