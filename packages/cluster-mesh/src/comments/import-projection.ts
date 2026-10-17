import { createLifecycleEvent } from '@sentropic/comments';
import type { ResourceRef, ThreadStructureRevisionRecord, AnnotationRevisionRecord, CanonicalChainRecord, LifecycleEventRecord } from '@sentropic/comments';
import type { AtomicUnit } from '../storage/atomic.js';
import type { PgProjectionContext } from '../storage/postgres/protocol.js';
import { decodePgText } from '../storage/postgres/codec.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import { commentsControlAddress, readCommentsImport } from './import-control.js';
import { assertCommentsImportRecord } from './import-authority.js';
import { chainIdentity, decodeRecord, selectionForRecord } from './storage-schema.js';
import { readCommentsPgRecord, commentsPgValue } from './postgres-records.js';
import type { PgChain } from '../storage/postgres/effects.js';
import { validateCommentsRecord } from './record-validation.js';
import { CommentsTransportError } from './transport-contracts.js';
import { retainedCommentsLifecycleBasis } from './lifecycle-evidence.js';
export const validateCommentsImportProjection = async (options: CommentsServiceOptions, effects: AtomicUnit, context: PgProjectionContext): Promise<void> => {
  if (!context.stagedUnitId || !effects.appends.length) return;
  const { schema, scope } = commentsControlAddress(context);
  const result = await context.session.execute({ text: `SELECT operation_id FROM ${schema}.comments_preparations WHERE scope_key=$1 AND unit_id=$2`, values: [scope, context.stagedUnitId] });
  if (!result.rows[0]) return;
  const state = (await readCommentsImport(context, decodePgText(result.rows[0].operation_id)))!;
  const lookup = (selection: Parameters<typeof readCommentsPgRecord>[1], hash?: string) => readCommentsPgRecord(context, selection, hash);
  for (const append of effects.appends) {
    const record = decodeRecord(append.record.bytes, append.record.hash); const selection = selectionForRecord(record);
    const metadata = await commentsPgValue<PgChain>(context, 'chain', chainIdentity(selection).key);
    const previous = append.expectation.kind === 'head' ? await lookup(selection, append.expectation.hash) : null;
    if ('link' in record && (record.link.sequence !== metadata?.count || record.link.previousHash !== (previous?.hash ?? null))) throw new CommentsTransportError('conflict', 'Canonical link sequence differs from the prepared chain');
    await validateCommentsRecord(record, previous, options.capacity, lookup);
    if (record.kind === 'lifecycle-event') {
      const { kind: _kind, hash: _hash, link: _link, ...input } = record;
      const basis = await retainedCommentsLifecycleBasis(context, selection, previous as LifecycleEventRecord | null);
      if (createLifecycleEvent(basis, input, options.capacity).hash !== record.hash) throw new CommentsTransportError('invalid-request', 'Imported lifecycle envelope differs');
    }
    // Module-generated terminal records are authenticated by the staged digest.
    if (['import-manifest', 'unit-receipt', 'batch-receipt-snapshot'].includes(record.kind)) continue;
    const resources = async (source: CanonicalChainRecord | null): Promise<readonly ResourceRef[]> => {
      if (source?.kind === 'annotation-revision') return [source.primary, ...source.secondary].map((target) => target.resource);
      if (source?.kind === 'thread-structure-revision') return [source.primary.resource];
      if (source?.kind === 'comment-revision') return resources(await lookup({ kind: 'thread-structure-revisions', threadId: source.threadId }));
      throw new CommentsTransportError('incomplete', 'Imported object resource reference is missing');
    };
    let targets: readonly ResourceRef[] | undefined;
    if (record.kind === 'comment-revision') targets = await resources(await lookup({ kind: 'thread-structure-revisions', threadId: record.threadId }) as ThreadStructureRevisionRecord | null);
    if (record.kind === 'review-event' || record.kind === 'prepared-submission-manifest') targets = await resources(await lookup({ kind: 'annotation-revisions', annotationId: record.kind === 'review-event' ? record.annotationId : record.annotation.annotationId }) as AnnotationRevisionRecord | null);
    if (record.kind === 'lifecycle-event') targets = await resources(await lookup(record.objectKind === 'annotation' ? { kind: 'annotation-revisions', annotationId: record.objectId } : record.objectKind === 'thread' ? { kind: 'thread-structure-revisions', threadId: record.objectId } : { kind: 'comment-revisions', commentId: record.objectId }));
    assertCommentsImportRecord(state.binding, record, targets);
  }
};
