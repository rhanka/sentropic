import type { CanonicalChainRecord, CommandCapability, ResourceRef } from '@sentropic/comments';
import type { CommentsImportBinding } from './transport-contracts.js';
import { CommentsTransportError } from './transport-contracts.js';
import { commentsResourceKey, sameScope } from './storage-schema.js';
export const commentsImportCapability = (record: CanonicalChainRecord): CommandCapability => {
  if (record.kind === 'thread-structure-revision') return 'comment';
  if (record.kind === 'comment-revision') return record.link.sequence === 1 ? 'comment' : 'revise';
  if (record.kind === 'review-event') return record.action === 'contest' ? 'contest' : record.action === 'resolve-contest' ? 'resolve-contest' : 'review';
  if (record.kind === 'prepared-submission-manifest') return 'submit-to-ai';
  if (record.kind === 'lifecycle-event') {
    if (record.action === 'archive') return record.archiveKind === 'personal' ? 'personal-archive' : 'shared-archive';
    if (record.action === 'restore') return 'shared-restore';
    return record.action === 'tombstone' ? 'tombstone' : 'purge';
  }
  if (record.kind === 'operation-audit-event') return record.subject === 'assignment' ? 'assign' : record.subject === 'discussion-state' ? 'resolve-discussion' : 'revise';
  return 'revise';
};
export const assertCommentsImportRecord = (binding: CommentsImportBinding, record: CanonicalChainRecord, resolvedTargets?: readonly ResourceRef[]): void => {
  if (!sameScope(record.scope, binding.request.scope) || !binding.capabilities.includes(commentsImportCapability(record))) throw new CommentsTransportError('denied', 'Imported record capability or scope is undeclared');
  const targets = resolvedTargets ?? (record.kind === 'annotation-revision' ? [record.primary, ...record.secondary].map((target) => target.resource)
    : record.kind === 'thread-structure-revision' ? [record.primary.resource] : []);
  const allowed = new Set(binding.targets.map(commentsResourceKey));
  if (targets.some((target) => !allowed.has(commentsResourceKey(target)))) throw new CommentsTransportError('denied', 'Imported record resource is outside the authorized target inventory');
};
