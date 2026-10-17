import { CanonicalCommandError, canonicalJson, createOperationAuditEvent } from '@sentropic/comments';
import type { CanonicalChainRecord, CanonicalReadSelection, CanonicalLifecycleRequest, AnnotationRevisionRecord, ThreadStructureRevisionRecord, CommentRevisionRecord, OperationAuditEventRecord } from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import { emptyEffects } from '../storage/staged-preparation.js';
import type { CommentsServiceOptions, CommentsLifecycleControl } from './lifecycle-contracts.js';
import { lifecycleControlKey } from './lifecycle-contracts.js';
import { chainIdentity, decodeRecord, invalid } from './storage-schema.js';
import { installedLifecycleStore } from './installed-store.js';
export const retainedHead = async <T extends CanonicalChainRecord>(context: PgInstalledContext, selection: CanonicalReadSelection): Promise<T | null> => {
  const found = await context.head(chainIdentity(selection).key); return found ? decodeRecord(found.bytes, found.hash) as T : null;
};
export const objectSelection = (request: Pick<CanonicalLifecycleRequest, 'objectKind' | 'objectId'>): CanonicalReadSelection => {
  if (request.objectKind === 'annotation') return { kind: 'annotation-revisions', annotationId: request.objectId };
  if (request.objectKind === 'thread') return { kind: 'thread-structure-revisions', threadId: request.objectId };
  if (request.objectKind === 'comment') return { kind: 'comment-revisions', commentId: request.objectId };
  return invalid('invalid lifecycle object kind');
};
export const lifecycleResources = async (context: PgInstalledContext, request: CanonicalLifecycleRequest) => {
  const record = await retainedHead<AnnotationRevisionRecord | ThreadStructureRevisionRecord | CommentRevisionRecord>(context, objectSelection(request));
  if (!record) throw new CanonicalCommandError('not-found', 'Comments object is absent');
  if (record.kind === 'annotation-revision') return [record.primary, ...record.secondary].map((target) => target.resource);
  if (record.kind === 'thread-structure-revision') return [record.primary.resource];
  const thread = await retainedHead<ThreadStructureRevisionRecord>(context, { kind: 'thread-structure-revisions', threadId: record.threadId });
  if (!thread) return invalid('comment thread is missing');
  return [thread.primary.resource];
};
export const readLifecycleControl = async (context: PgInstalledContext, target: string) => {
  const stored = await context.aggregate(lifecycleControlKey(target));
  return { version: stored?.version ?? 0, value: stored ? JSON.parse(stored.value.data) as CommentsLifecycleControl : null };
};
export const writeLifecycleControl = async (context: PgInstalledContext, target: string, version: number, value: CommentsLifecycleControl): Promise<void> => {
  const key = lifecycleControlKey(target);
  await context.apply({ ...emptyEffects(), guards: version ? [{ kind: 'aggregate-version', key, version }] : [], updates: [{ key, version: version + 1, value: { format: 'utf8', data: canonicalJson(value) } }] });
};
export const appendLifecycleAudit = async (context: PgInstalledContext, options: CommentsServiceOptions, target: string, request: CanonicalLifecycleRequest): Promise<void> => {
  const selection = { kind: 'operation-audit-events' as const, subject: 'archive' as const, subjectId: target };
  const previous = await retainedHead<OperationAuditEventRecord>(context, selection);
  const record = createOperationAuditEvent(previous ? [previous] : [], { scope: request.scope, subject: selection.subject, subjectId: target, operation: request.action,
    principal: context.grant.principalId, audience: [context.grant.principalId], detail: null }, options.capacity);
  await installedLifecycleStore(context).appendOperationAuditEvent(request.scope, selection.subject, target, record, previous ? { kind: 'revision', revisionHash: previous.hash } : { kind: 'creation', aggregateVersion: 0 });
  await context.apply({ ...emptyEffects(), relationships: [{ kind: 'add', relation: 'coverage-parent-v1', from: target, to: chainIdentity(selection).key }] });
};
