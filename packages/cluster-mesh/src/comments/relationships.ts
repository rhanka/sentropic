import type { CanonicalChainRecord } from '@sentropic/comments';
import type { RelationshipChange } from '../storage/atomic.js';
import { commentsObjectKey } from './storage-schema.js';
export const commentsRelationships = (record: CanonicalChainRecord, chain: string, key: string): readonly RelationshipChange[] => {
  const relationships: RelationshipChange[] = [{ kind: 'add', relation: 'coverage-parent-v1', from: chain, to: key }];
  const cover = (parent: string, child: string) => relationships.push({ kind: 'add', relation: 'coverage-parent-v1', from: parent, to: child });
  if (record.kind === 'annotation-revision' || record.kind === 'review-event') cover(commentsObjectKey('annotation', record.annotationId), chain);
  if (record.kind === 'thread-structure-revision') cover(commentsObjectKey('thread', record.threadId), chain);
  if (record.kind === 'comment-revision') {
    cover(commentsObjectKey('comment', record.commentId), chain);
    cover(commentsObjectKey('thread', record.threadId), commentsObjectKey('comment', record.commentId));
  }
  if (record.kind === 'lifecycle-event') cover(commentsObjectKey(record.objectKind, record.objectId), chain);
  if (record.kind === 'operation-audit-event' && ['annotation', 'thread', 'comment'].includes(record.subject)) cover(commentsObjectKey(record.subject, record.subjectId), chain);
  return relationships;
};
