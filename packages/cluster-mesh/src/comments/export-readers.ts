import type { CanonicalChainRecord, ResourceRef, CanonicalReadSelection } from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import type { PgProjectionContext } from '../storage/postgres/protocol.js';
import { chainRecordKey, type PgChainRef } from '../storage/postgres/effects.js';
import { authorizeComments } from './authority.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import { chainIdentity } from './storage-schema.js';
import { assertCommentsPgVisible, commentsPgValue, readCommentsPgRecord } from './postgres-records.js';
import { commentsTransportBytes } from './fragment-codec.js';
import { CommentsTransportError } from './transport-contracts.js';
import type { CommentsExportPosition, CommentsExportState } from './boundary-codec.js';
export const commentsRecordResources = async (record: CanonicalChainRecord, lookup: (selection: CanonicalReadSelection, hash?: string) => Promise<CanonicalChainRecord | null>): Promise<readonly ResourceRef[]> => {
  if (record.kind === 'annotation-revision') return [record.primary, ...record.secondary].map((target) => target.resource);
  if (record.kind === 'thread-structure-revision') return [record.primary.resource];
  let selected: CanonicalReadSelection | undefined; let hash: string | undefined;
  if (record.kind === 'comment-revision') { selected = { kind: 'thread-structure-revisions', threadId: record.threadId }; hash = record.structureRevision.hash; }
  if (record.kind === 'review-event') { selected = { kind: 'annotation-revisions', annotationId: record.annotationId }; hash = record.revisionHash; }
  if (record.kind === 'prepared-submission-manifest') { selected = { kind: 'annotation-revisions', annotationId: record.annotation.annotationId }; hash = record.annotation.revisionHash; }
  if (record.kind === 'lifecycle-event') selected = record.objectKind === 'annotation' ? { kind: 'annotation-revisions', annotationId: record.objectId } : record.objectKind === 'thread' ? { kind: 'thread-structure-revisions', threadId: record.objectId } : { kind: 'comment-revisions', commentId: record.objectId };
  if (!selected) return [];
  const source = await lookup(selected, hash);
  if (!source) throw new CommentsTransportError('incomplete', 'Required export resource reference is unavailable');
  return commentsRecordResources(source, lookup);
};
export const readCommentsExportRecords = async (options: CommentsServiceOptions, context: PgInstalledContext, state: CommentsExportState, from: CommentsExportPosition, maximum: number, bytes: number) => {
  const position = { ...from }; const records: CanonicalChainRecord[] = []; let encoded = 2;
  const captured: PgProjectionContext = { ...context, root: state.root, coverageRoot: context.root };
  const lookup = (selection: CanonicalReadSelection, hash?: string) => readCommentsPgRecord(captured, selection, hash);
  while (position.chain < state.selection.selections.length && records.length < maximum) {
    const selection = state.selection.selections[position.chain]!; const chain = chainIdentity(selection).key;
    await assertCommentsPgVisible(context, chain);
    const head = state.manifest.heads[chain]!;
    if (BigInt(position.sequence) > BigInt(head.terminalSeq)) { position.chain += 1; position.sequence = 0; continue; }
    const ref = await commentsPgValue<PgChainRef>(captured, 'chain-record', chainRecordKey(chain, position.sequence));
    const record = ref ? await lookup(selection, ref.hash) : null;
    if (!record) throw new CommentsTransportError('incomplete', 'Retained export history is incomplete');
    const cost = commentsTransportBytes(record) + (records.length ? 1 : 0);
    if (encoded + cost > bytes) {
      if (!records.length) throw new CommentsTransportError('capacity-exceeded', 'Indivisible export record exceeds its declared page budget');
      break;
    }
    const targets = await commentsRecordResources(record, lookup);
    if (!targets.length) throw new CommentsTransportError('incomplete', 'Export record has no installed resource authority binding');
    await authorizeComments(options, context, 'read', targets);
    records.push(record); encoded += cost; position.sequence += 1; position.records = (BigInt(position.records) + 1n).toString();
  }
  while (position.chain < state.selection.selections.length && BigInt(position.sequence) > BigInt(state.manifest.heads[chainIdentity(state.selection.selections[position.chain]!).key]!.terminalSeq)) { position.chain += 1; position.sequence = 0; }
  return { records, position, bytes: encoded, complete: position.chain === state.selection.selections.length };
};
