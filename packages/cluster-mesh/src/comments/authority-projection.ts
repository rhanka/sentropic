import { canonicalJson, isResourceRef } from '@sentropic/comments';
import type { CanonicalChainRecord, CanonicalReadSelection, ResourceRef } from '@sentropic/comments';
import type { AtomicUnit } from '../storage/atomic.js';
import type { PgProjectionContext } from '../storage/postgres/protocol.js';
import type { PgChain } from '../storage/postgres/effects.js';
import { decodePgJson, decodePgUtf8 } from '../storage/postgres/codec.js';
import { commentsControlAddress } from './import-control.js';
import { commentsPgValue } from './postgres-records.js';
import { chainIdentity, decodeRecord, selectionForRecord } from './storage-schema.js';
import { CommentsTransportError } from './transport-contracts.js';
import type { CommentsImportState } from './import-state.js';
const objectSelection = (kind: string, id: string): CanonicalReadSelection =>
  kind === 'annotation'
    ? { kind: 'annotation-revisions', annotationId: id }
    : kind === 'thread'
      ? { kind: 'thread-structure-revisions', threadId: id }
      : { kind: 'comment-revisions', commentId: id };
export const readCommentsAuthorityTargets = async (
  context: PgProjectionContext,
  selection: CanonicalReadSelection,
  hash?: string,
): Promise<readonly ResourceRef[]> => {
  const { schema, scope } = commentsControlAddress(context);
  const chain = chainIdentity(selection).key;
  const metadata = await commentsPgValue<PgChain>(context, 'chain', chain);
  const selected = hash ?? metadata?.head;
  if (!metadata || !selected) return [];
  const result = await context.session.execute({
    text: `SELECT targets FROM ${schema}.comments_authority WHERE scope_key=$1 AND chain_key=$2 AND hash=$3`,
    values: [scope, chain, selected],
  });
  return result.rows[0] ? decodePgJson<readonly ResourceRef[]>(decodePgUtf8(result.rows[0].targets)) : [];
};
const projectedTargets = async (
  context: PgProjectionContext,
  record: CanonicalChainRecord,
): Promise<readonly ResourceRef[]> => {
  if (record.kind === 'annotation-revision')
    return [record.primary, ...record.secondary].map((target) => target.resource);
  if (record.kind === 'thread-structure-revision') return [record.primary.resource];
  if (record.kind === 'comment-revision')
    return readCommentsAuthorityTargets(
      context,
      { kind: 'thread-structure-revisions', threadId: record.threadId },
      record.structureRevision.hash,
    );
  if (record.kind === 'review-event')
    return readCommentsAuthorityTargets(
      context,
      { kind: 'annotation-revisions', annotationId: record.annotationId },
      record.revisionHash,
    );
  if (record.kind === 'prepared-submission-manifest')
    return readCommentsAuthorityTargets(
      context,
      { kind: 'annotation-revisions', annotationId: record.annotation.annotationId },
      record.annotation.revisionHash,
    );
  if (record.kind === 'lifecycle-event')
    return readCommentsAuthorityTargets(context, objectSelection(record.objectKind, record.objectId));
  if (record.kind === 'operation-audit-event') {
    let identity: unknown;
    try {
      identity = JSON.parse(record.subjectId);
    } catch {
      return [];
    }
    if (
      Array.isArray(identity) &&
      identity.length === 3 &&
      identity[0] === 'comments-object' &&
      ['annotation', 'thread', 'comment'].includes(identity[1]) &&
      typeof identity[2] === 'string'
    )
      return readCommentsAuthorityTargets(context, objectSelection(identity[1], identity[2]));
  }
  return [];
};
export const prepareCommentsAuthority = async (effects: AtomicUnit, context: PgProjectionContext): Promise<void> => {
  const { schema, scope } = commentsControlAddress(context);
  let imported: readonly ResourceRef[] = [];
  if (context.stagedUnitId) {
    const result = await context.session.execute({
      text: `SELECT state FROM ${schema}.comments_preparations WHERE scope_key=$1 AND unit_id=$2`,
      values: [scope, context.stagedUnitId],
    });
    if (result.rows[0])
      imported = decodePgJson<CommentsImportState>(decodePgUtf8(result.rows[0].state)).binding.targets;
  }
  for (const append of effects.appends) {
    const record = decodeRecord(append.record.bytes, append.record.hash);
    const targets = await projectedTargets(context, record);
    const actual = targets.length ? targets : imported;
    if (!actual.length) continue;
    if (actual.some((target) => !isResourceRef(target)))
      throw new CommentsTransportError('unavailable', 'Projected resource authority is invalid');
    await context.session.execute({
      text: `INSERT INTO ${schema}.comments_authority(scope_key, chain_key, hash, targets) VALUES($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      values: [scope, chainIdentity(selectionForRecord(record)).key, record.hash, Buffer.from(canonicalJson(actual))],
    });
  }
};
