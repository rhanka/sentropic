import { canonicalJson } from '@sentropic/comments';
import type { CanonicalBatchImportRequest, CanonicalStoreScope } from '@sentropic/comments';
import type { CommitReceipt } from '../storage/atomic.js';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import { quotePgIdentifier } from '../storage/postgres/protocol.js';
import { decodePgJson, decodePgText, decodePgUtf8 } from '../storage/postgres/codec.js';
import { authorizeComments } from './authority.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import type { CommentsImportState } from './import-state.js';
import { commentsControlAddress, readCommentsImport } from './import-control.js';
import {
  CommentsTransportError,
  COMMENTS_TRANSPORT_VERSION,
  type CommentsCompleteReceipt,
  type CommentsPreparedReference,
} from './transport-contracts.js';
export const completeCommentsReceipt = (state: CommentsImportState, kernel: CommitReceipt): CommentsCompleteReceipt => {
  if (
    !state.canonical ||
    kernel.moduleResult?.format !== 'utf8' ||
    kernel.moduleResult.data !== canonicalJson(state.canonical)
  )
    throw new CommentsTransportError('unavailable', 'Committed import result is incomplete');
  return {
    version: COMMENTS_TRANSPORT_VERSION,
    operationId: state.binding.operationId,
    bindingDigest: state.bindingDigest,
    mappingVersion: state.binding.request.expectedMappingVersion,
    canonical: state.canonical,
    units: state.roots,
    kernel,
  };
};
export const inspectCommentsImport = async (
  options: CommentsServiceOptions,
  context: PgInstalledContext,
  supplied: unknown,
) => {
  const input = supplied as { prepared: CommentsPreparedReference; request: CanonicalBatchImportRequest };
  const state = await readCommentsImport(context, input?.prepared?.operationId);
  if (
    !state ||
    input.prepared.bindingDigest !== state.bindingDigest ||
    input.prepared.rootReference !== state.rootReference ||
    canonicalJson(input.request) !== canonicalJson(state.binding.request)
  )
    throw new CommentsTransportError('conflict', 'Prepared import reference differs');
  for (const capability of state.binding.capabilities)
    await authorizeComments(options, context, capability, state.binding.targets);
  if (!state.root || !state.unit)
    throw new CommentsTransportError('incomplete', 'Complete terminal import is required');
  context.replayed();
  return { state, unit: state.unit, root: state.root };
};
export const inspectCommentsImportProgress = async (
  options: CommentsServiceOptions,
  context: PgInstalledContext,
  supplied: unknown,
) => {
  const input = supplied as { scope: CanonicalStoreScope; operationId: string; bindingDigest: string };
  if (
    !input ||
    input.scope?.tenantId !== context.grant.scope.tenantId ||
    input.scope.workspaceId !== context.grant.scope.workspaceId
  )
    throw new CommentsTransportError('denied', 'Import scope is unavailable');
  const state = await readCommentsImport(context, input.operationId);
  if (!state || state.bindingDigest !== input.bindingDigest)
    throw new CommentsTransportError('conflict', 'Import preparation binding differs');
  for (const capability of state.binding.capabilities)
    await authorizeComments(options, context, capability, state.binding.targets);
  const status = await context.inspectStaged(state.begin.operationKey);
  context.replayed();
  return {
    status,
    acceptedFragments: state.nextOrdinal,
    prepared: state.root
      ? {
          operationId: state.binding.operationId,
          bindingDigest: state.bindingDigest,
          rootReference: state.rootReference,
        }
      : null,
  };
};
export const recoverCommentsReceipts = async (
  options: CommentsServiceOptions,
  context: PgInstalledContext,
  supplied: unknown,
): Promise<readonly CommentsCompleteReceipt[]> => {
  const input = supplied as { scope: CanonicalStoreScope; batchId: string; manifestHash: string };
  if (
    !input ||
    input.scope?.tenantId !== context.grant.scope.tenantId ||
    input.scope.workspaceId !== context.grant.scope.workspaceId ||
    typeof input.batchId !== 'string' ||
    typeof input.manifestHash !== 'string'
  )
    throw new CommentsTransportError('denied', 'Receipt scope is unavailable');
  const { schema, scope } = commentsControlAddress(context);
  const data = quotePgIdentifier(context.layout.dataSchema);
  const result = await context.session.execute({
    text: `SELECT p.operation_id, u.metadata::text FROM ${schema}.comments_preparations p JOIN ${data}.units u ON u.id=p.unit_id AND
        u.scope_key=p.scope_key WHERE p.scope_key=$1 AND p.batch_id=$2 AND p.manifest_hash=$3 AND p.owner=$4 AND p.incarnation=$5 AND
        u.metadata->>'state'='committed' ORDER BY p.operation_id COLLATE "C" LIMIT 51`,
    values: [scope, input.batchId, input.manifestHash, context.grant.principalId, context.stream.incarnation],
  });
  if (result.rows.length > 50)
    throw new CommentsTransportError('capacity-exceeded', 'Receipt recovery inventory exceeds the admitted batch');
  const receipts: CommentsCompleteReceipt[] = [];
  for (const row of result.rows) {
    const state = (await readCommentsImport(context, decodePgText(row.operation_id)))!;
    await authorizeComments(options, context, 'read', state.binding.targets);
    const metadata = decodePgJson<{ receipt: CommitReceipt; moduleResultPayload: string }>(decodePgText(row.metadata));
    const payload = await context.session.execute({
      text: `SELECT bytes FROM ${data}.payloads WHERE id=$1 AND scope_key=$2 AND NOT erased`,
      values: [metadata.moduleResultPayload, scope],
    });
    const moduleResult = decodePgJson<{ format: 'utf8'; data: string }>(decodePgUtf8(payload.rows[0]?.bytes));
    receipts.push(completeCommentsReceipt(state, { ...metadata.receipt, moduleResult }));
  }
  context.replayed();
  return receipts;
};
