import { CanonicalCommandError, commandPayloadDigest, createAnnotationRevision, createThreadStructureRevision, createCommentRevision } from '@sentropic/comments';
import type { CanonicalReadSelection, AnnotationRevisionRecord, ThreadStructureRevisionRecord, CommentRevisionRecord } from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import type { CommentsRevisionRequest, CommentsRevisionRecord } from './command-contracts.js';
import { chainIdentity, commandKey, sameScope, invalid } from './storage-schema.js';
import { readCommentsPgRecord } from './postgres-records.js';
import { commentsRecordResources } from './export-readers.js';
import { authorizeComments, authorizeCommentsRevisionDecision } from './authority.js';
import { commentsRecordEffects } from './record-effects.js';
import { validateCommentsRecord } from './record-validation.js';
import { validateCommentsAdmission } from './admission.js';
export const executeCommentsRevision = async (options: CommentsServiceOptions, context: PgInstalledContext, supplied: unknown): Promise<CommentsRevisionRecord> => {
  const request = supplied as CommentsRevisionRequest;
  if (!request || !sameScope(request.scope, context.grant.scope)) throw new CanonicalCommandError('denied', 'Comments request scope is unavailable');
  if (!['annotation', 'thread', 'comment'].includes(request.kind) || !request.content || typeof request.content !== 'object' || !request.expected ||
    typeof request.idempotencyKey !== 'string' || !request.idempotencyKey || request.idempotencyKey.length > 256 || typeof request.decisionRef !== 'string') return invalid('invalid revision command');
  const allowed = request.kind === 'annotation' ? ['annotationId', 'primary', 'secondary', 'visualAnchors', 'body', 'provenance'] : request.kind === 'thread' ? ['threadId', 'trigger', 'primary', 'annotationId', 'provenance'] : ['threadId', 'commentId', 'parentCommentId', 'structureRevision', 'annotationPin', 'body', 'provenance'];
  if (Object.keys(request.content).some((key) => !allowed.includes(key)) || !request.content.provenance || Object.hasOwn(request.content.provenance, 'registration')) return invalid('revision command contains server-owned or unknown fields');
  const selection: CanonicalReadSelection = request.kind === 'annotation' ? { kind: 'annotation-revisions', annotationId: request.content.annotationId } : request.kind === 'thread' ? { kind: 'thread-structure-revisions', threadId: request.content.threadId } : { kind: 'comment-revisions', commentId: request.content.commentId };
  const chain = chainIdentity(selection).key;
  if (!await context.available(chain)) throw new CanonicalCommandError('denied', 'Comments object is unavailable');
  const lookup = (selected: CanonicalReadSelection, hash?: string) => readCommentsPgRecord(context, selected, hash);
  const previous = await lookup(selection);
  const provenance = { ...request.content.provenance, registration: { principal: context.grant.principalId, registeredAt: options.clock.now() } };
  const record: CommentsRevisionRecord = request.kind === 'annotation' ? createAnnotationRevision(previous as AnnotationRevisionRecord | null, { ...request.content, scope: request.scope, provenance }, options.capacity)
    : request.kind === 'thread' ? createThreadStructureRevision(previous as ThreadStructureRevisionRecord | null, { ...request.content, scope: request.scope, provenance }, options.capacity)
      : createCommentRevision(previous as CommentRevisionRecord | null, { ...request.content, scope: request.scope, provenance }, options.capacity);
  validateCommentsAdmission(record);
  const targets = await commentsRecordResources(record, lookup);
  const capability = request.kind === 'annotation' || (request.kind === 'comment' && previous) ? 'revise' as const : 'comment' as const;
  await authorizeComments(options, context, capability, targets);
  if (previous) await authorizeComments(options, context, capability, await commentsRecordResources(previous, lookup));
  await authorizeCommentsRevisionDecision(options, context, request, capability);
  const digest = commandPayloadDigest(request); const key = commandKey(request.idempotencyKey); const committed = await context.index(key);
  if (committed) {
    if (committed.digest !== digest) throw new CanonicalCommandError('idempotency-conflict', 'Revision command identity changed');
    const original = await lookup(selection, committed.resultHash!);
    if (!original || !['annotation-revision', 'thread-structure-revision', 'comment-revision'].includes(original.kind)) return invalid('committed revision result is unavailable');
    context.replayed(); return original as CommentsRevisionRecord;
  }
  if (request.expected.kind === 'creation' ? previous !== null || request.expected.aggregateVersion !== 0 : request.expected.kind !== 'revision' || previous?.hash !== request.expected.revisionHash) throw new CanonicalCommandError('cas-conflict', 'Comments expected head changed');
  await validateCommentsRecord(record, previous, options.capacity, lookup);
  const effects = commentsRecordEffects(selection, record, previous?.hash ?? null);
  await context.apply({ ...effects, indexWrites: [{ key, digest, resultIds: [chain], resultHash: record.hash }] });
  return record;
};
