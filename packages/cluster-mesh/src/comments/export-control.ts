import { canonicalJson } from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import { decodePgJson, decodePgUtf8 } from '../storage/postgres/codec.js';
import { commentsControlAddress } from './import-control.js';
import type { CommentsExportState } from './boundary-codec.js';
import { CommentsTransportError, COMMENTS_TRANSPORT_VERSION, type CommentsExportBoundary } from './transport-contracts.js';
import { commandIdempotencyKey } from '@sentropic/comments';
export const readCommentsExport = async (context: PgInstalledContext, exportId: string, lock = false): Promise<CommentsExportState | null> => {
  const { schema, scope } = commentsControlAddress(context);
  const result = await context.session.execute({ text: `SELECT state,owner,incarnation FROM ${schema}.comments_exports WHERE scope_key=$1 AND export_id=$2${lock ? ' FOR UPDATE' : ''}`, values: [scope, exportId] });
  const row = result.rows[0]; if (!row) return null;
  if (row.owner !== context.grant.principalId || row.incarnation !== context.stream.incarnation) throw new CommentsTransportError('denied', 'Retained export is unavailable');
  const state = decodePgJson<CommentsExportState>(decodePgUtf8(row.state));
  if (state.version !== 'comments-export-v1') throw new CommentsTransportError('unavailable', 'Retained export version differs');
  return state;
};
export const writeCommentsExport = async (context: PgInstalledContext, state: CommentsExportState, insert = false): Promise<void> => {
  const { schema, scope } = commentsControlAddress(context);
  if (insert) await context.session.execute({ text: `INSERT INTO ${schema}.comments_exports(scope_key,export_id,owner,incarnation,selection_digest,state) VALUES($1,$2,$3,$4,$5,$6)`, values: [scope, state.selection.exportId, context.grant.principalId, context.stream.incarnation, state.selectionDigest, Buffer.from(canonicalJson(state))] });
  else await context.session.execute({ text: `UPDATE ${schema}.comments_exports SET state=$3 WHERE scope_key=$1 AND export_id=$2`, values: [scope, state.selection.exportId, Buffer.from(canonicalJson(state))] });
};
export const commentsExportBoundary = (state: CommentsExportState): CommentsExportBoundary => {
  if (!state.payloadDigest) throw new CommentsTransportError('incomplete', 'Export boundary preparation is incomplete');
  return { version: COMMENTS_TRANSPORT_VERSION, boundaryDigest: state.boundaryDigest,
    unitRoot: { unitId: state.selection.exportId, records: state.scan.records, payloadDigest: state.payloadDigest },
    request: { scope: state.selection.scope, exportId: state.selection.exportId, selections: state.selection.selections,
      snapshotBoundary: { frozenAt: state.frozenAt, boundaryDigest: state.boundaryDigest }, idempotencyKey: commandIdempotencyKey(state.selection.exportId) } };
};
