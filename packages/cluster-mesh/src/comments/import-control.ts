import { canonicalJson } from '@sentropic/comments';
import type { PgProjectionContext } from '../storage/postgres/protocol.js';
import { quotePgIdentifier } from '../storage/postgres/protocol.js';
import { decodePgJson, decodePgUtf8 } from '../storage/postgres/codec.js';
import type { CommentsImportState } from './import-state.js';
import { CommentsTransportError } from './transport-contracts.js';
import type { CommentsFragmentAcknowledgement } from './transport-contracts.js';
import { sameScope } from './storage-schema.js';
export const commentsControlAddress = (context: PgProjectionContext) => ({
  schema: quotePgIdentifier(context.layout.projectionSchemas.comments ?? ''),
  scope: JSON.stringify([context.stream.moduleId, context.grant.scope.tenantId, context.grant.scope.workspaceId]),
});
export const readCommentsImport = async (context: PgProjectionContext, operationId: string, lock = false): Promise<CommentsImportState | null> => {
  const { schema, scope } = commentsControlAddress(context);
  const result = await context.session.execute({ text: `SELECT state,owner,incarnation FROM ${schema}.comments_preparations WHERE scope_key=$1 AND operation_id=$2${lock ? ' FOR UPDATE' : ''}`, values: [scope, operationId] });
  const row = result.rows[0]; if (!row) return null;
  if (row.owner !== context.grant.principalId || row.incarnation !== context.stream.incarnation) throw new CommentsTransportError('denied', 'Import preparation is unavailable');
  const state = decodePgJson<CommentsImportState>(decodePgUtf8(row.state));
  if (state.version !== 'comments-preparation-v1' || !sameScope(state.binding.request.scope, context.grant.scope)) throw new CommentsTransportError('unavailable', 'Import preparation binding is invalid');
  return state;
};
export const writeCommentsImport = async (context: PgProjectionContext, state: CommentsImportState): Promise<void> => {
  const { schema, scope } = commentsControlAddress(context);
  await context.session.execute({ text: `UPDATE ${schema}.comments_preparations SET unit_id=$3,state=$4 WHERE scope_key=$1 AND operation_id=$2`, values: [scope, state.binding.operationId, state.unit?.unitId ?? null, Buffer.from(canonicalJson(state))] });
};
export const insertCommentsImport = async (context: PgProjectionContext, state: CommentsImportState): Promise<void> => {
  const { schema, scope } = commentsControlAddress(context); const request = state.binding.request;
  await context.session.execute({ text: `INSERT INTO ${schema}.comments_preparations(scope_key,operation_id,kernel_operation,owner,incarnation,batch_id,manifest_hash,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, values: [scope, state.binding.operationId, state.begin.operationKey, context.grant.principalId, context.stream.incarnation, request.batchId, request.manifest.hash, Buffer.from(canonicalJson(state))] });
};
export const readCommentsAcknowledgement = async (context: PgProjectionContext, operationId: string, ordinal: string) => {
  const { schema, scope } = commentsControlAddress(context);
  const result = await context.session.execute({ text: `SELECT transport_digest,kernel_digest,acknowledgement FROM ${schema}.comments_fragment_receipts WHERE scope_key=$1 AND operation_id=$2 AND ordinal=$3::bigint`, values: [scope, operationId, ordinal] });
  const row = result.rows[0];
  return row ? { transportDigest: row.transport_digest, kernelDigest: row.kernel_digest, acknowledgement: decodePgJson<CommentsFragmentAcknowledgement>(decodePgUtf8(row.acknowledgement)) } : null;
};
export const insertCommentsAcknowledgement = async (context: PgProjectionContext, operationId: string, kernelDigest: string, acknowledgement: CommentsFragmentAcknowledgement): Promise<void> => {
  const { schema, scope } = commentsControlAddress(context);
  await context.session.execute({ text: `INSERT INTO ${schema}.comments_fragment_receipts(scope_key,operation_id,ordinal,transport_digest,kernel_digest,acknowledgement) VALUES($1,$2,$3::bigint,$4,$5,$6)`, values: [scope, operationId, acknowledgement.ordinal, acknowledgement.fragmentDigest, kernelDigest, Buffer.from(canonicalJson(acknowledgement))] });
};
