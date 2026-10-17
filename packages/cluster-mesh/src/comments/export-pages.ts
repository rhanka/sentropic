import { canonicalJson } from '@sentropic/comments';
import type { CanonicalBatchExportRequest, CanonicalBatchExportResponse } from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import { readCommentsExport, commentsExportBoundary } from './export-control.js';
import { decodeCommentsExportCursor, encodeCommentsExportCursor, initialCommentsExportPosition, type CommentsExportState } from './boundary-codec.js';
import { createCommentsFragment, commentsTransportBytes } from './fragment-codec.js';
import { readCommentsExportRecords } from './export-readers.js';
import { sameScope } from './storage-schema.js';
import { CommentsTransportError, type CommentsExportFragmentPage, type CommentsFragment } from './transport-contracts.js';
import { authorizeCommentsExport } from './export-authority.js';
interface ExportReadInput { readonly request: CanonicalBatchExportRequest; readonly continuation: string | null; readonly limit?: number; }
const load = async (options: CommentsServiceOptions, context: PgInstalledContext, input: ExportReadInput): Promise<CommentsExportState> => {
  if (!input?.request || !sameScope(input.request.scope, context.grant.scope)) throw new CommentsTransportError('denied', 'Export scope is unavailable');
  const state = await readCommentsExport(context, input.request.exportId);
  if (!state || canonicalJson(commentsExportBoundary(state).request) !== canonicalJson(input.request)) throw new CommentsTransportError('conflict', 'Retained export request differs');
  await authorizeCommentsExport(options, context, state);
  return state;
};
const count = (value = 50): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new CommentsTransportError('invalid-request', 'Export page limit must be an integer between one and 100');
  return value;
};
export const readCommentsExportFragments = async (options: CommentsServiceOptions, context: PgInstalledContext, supplied: unknown): Promise<CommentsExportFragmentPage> => {
  const input = supplied as ExportReadInput; const state = await load(options, context, input); const limit = count(input.limit);
  let position = input.continuation === null ? initialCommentsExportPosition() : decodeCommentsExportCursor(state, 'fragments', input.continuation);
  const fragments: CommentsFragment[] = []; let terminal = false;
  while (fragments.length < limit) {
    const next = await readCommentsExportRecords(options, context, state, position, 50, 524288);
    const isTerminal = next.records.length === 0 && next.complete;
    if (isTerminal && position.records !== state.scan.records) throw new CommentsTransportError('incomplete', 'Export terminal count differs from its captured inventory');
    const fragment = createCommentsFragment({ scope: state.selection.scope, operationId: state.selection.exportId, bindingDigest: state.boundaryDigest,
      unitId: isTerminal ? null : state.selection.exportId, ordinal: position.ordinal, predecessorHash: position.predecessorHash,
      terminal: isTerminal ? { fragmentCount: (BigInt(position.ordinal) + 1n).toString(), unitRoots: [commentsExportBoundary(state).unitRoot] } : null }, next.records);
    const advanced = { ...next.position, ordinal: (BigInt(position.ordinal) + 1n).toString(), predecessorHash: fragment.digest };
    const nextCursor = isTerminal ? null : encodeCommentsExportCursor(state, 'fragments', advanced);
    if (commentsTransportBytes({ fragments: [...fragments, fragment], nextCursor }) > 1048576) {
      if (!fragments.length) throw new CommentsTransportError('capacity-exceeded', 'Whole export fragment exceeds the response page budget');
      break;
    }
    fragments.push(fragment); position = advanced; terminal = isTerminal;
    if (terminal) break;
  }
  context.replayed(); return { fragments, nextCursor: terminal ? null : encodeCommentsExportCursor(state, 'fragments', position) };
};
export const continueCommentsExport = async (options: CommentsServiceOptions, context: PgInstalledContext, supplied: unknown): Promise<CanonicalBatchExportResponse> => {
  const input = supplied as ExportReadInput; const state = await load(options, context, input); const limit = count(input.limit);
  const position = input.continuation === null ? initialCommentsExportPosition() : decodeCommentsExportCursor(state, 'records', input.continuation);
  // Reserve the bounded authenticated continuation before admitting records.
  const page = await readCommentsExportRecords(options, context, state, position, limit, 1048576 - 16384);
  const nextCursor = page.complete ? null : encodeCommentsExportCursor(state, 'records', page.position);
  const result: CanonicalBatchExportResponse = { page: { outcome: 'page', records: page.records, nextCursor }, nextCursor };
  if (commentsTransportBytes(result) > 1048576) throw new CommentsTransportError('capacity-exceeded', 'Canonical export page exceeds its envelope budget');
  context.replayed(); return result;
};
