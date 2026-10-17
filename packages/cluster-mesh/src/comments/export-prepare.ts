import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Hex } from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import type { PgChain } from '../storage/postgres/effects.js';
import { buildManifest, digestManifest, type ManifestChainHead } from '../storage/manifest.js';
import type { StagedCommitRoot } from '../storage/staged-units.js';
import { encodeStagedCommitRoot } from '../storage/staged-codec.js';
import { startPortableDigest, updatePortableDigest, finishPortableDigest } from '../storage/postgres/digest.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import { chainIdentity, sameScope } from './storage-schema.js';
import { commentsTransportBytes } from './fragment-codec.js';
import { assertCommentsPgVisible, commentsPgValue } from './postgres-records.js';
import { commentsExportBoundary, readCommentsExport, writeCommentsExport } from './export-control.js';
import { decodeCommentsExportCursor, encodeCommentsExportCursor, initialCommentsExportPosition, type CommentsExportState } from './boundary-codec.js';
import { readCommentsExportRecords } from './export-readers.js';
import { CommentsTransportError, type CommentsExportPreparation, type CommentsExportSelection } from './transport-contracts.js';
export const prepareCommentsExport = async (options: CommentsServiceOptions, context: PgInstalledContext, supplied: unknown): Promise<CommentsExportPreparation> => {
  const input = supplied as { selection: CommentsExportSelection; continuation: string | null }; const selection = input?.selection;
  if (!selection || !sameScope(selection.scope, context.grant.scope) || typeof selection.exportId !== 'string' || !selection.exportId || selection.exportId.length > 256 ||
    !Array.isArray(selection.selections) || selection.selections.length < 1 || selection.selections.length > 50 || (selection.operationKeys?.length ?? 0) > 50 || commentsTransportBytes(selection) > 262144) throw new CommentsTransportError('invalid-request', 'Invalid bounded export selection');
  const selectionDigest = sha256Hex(canonicalJson(['comments-export-selection', 'v1', selection]));
  let state = await readCommentsExport(context, selection.exportId, true); let fresh = false;
  const committed = { ...context, root: context.committedRoot };
  if (!state) {
    if (input.continuation !== null) throw new CommentsTransportError('invalid-request', 'Unknown export continuation');
    const heads: Record<string, ManifestChainHead> = Object.create(null) as Record<string, ManifestChainHead>;
    for (const selected of selection.selections) {
      const chain = chainIdentity(selected).key; await assertCommentsPgVisible(context, chain);
      const metadata = await commentsPgValue<PgChain>(committed, 'chain', chain);
      if (!metadata || metadata.disposed) throw new CommentsTransportError('incomplete', 'Export selection has no retained canonical head');
      if (Object.hasOwn(heads, chain)) throw new CommentsTransportError('invalid-request', 'Duplicate export chain selection');
      heads[chain] = { head: metadata.head, allocation: metadata.allocation, terminalSeq: String(metadata.count - 1) };
    }
    const unitRoots: string[] = [];
    for (const operation of selection.operationKeys ?? []) {
      const root = await commentsPgValue<StagedCommitRoot>(committed, 'unit-root', operation);
      if (!root) throw new CommentsTransportError('incomplete', 'Export operation has no committed root');
      unitRoots.push(sha256Hex(encodeStagedCommitRoot(root)));
    }
    const manifest = buildManifest({ scope: selection.scope, selections: Object.keys(heads), heads, unitRoots, descriptorVersion: 'contract-v1', encodingVersion: 'storage-canonical-v1',
      storeIncarnation: context.stream.incarnation, rootVersion: context.rootVersion, terminal: { count: String(selection.selections.length), complete: true } });
    state = { version: 'comments-export-v1', selection, selectionDigest, root: context.committedRoot, manifest, boundaryDigest: digestManifest(manifest), frozenAt: options.clock.now(), secret: randomUUID(),
      scan: initialCommentsExportPosition(), digest: updatePortableDigest(startPortableDigest(), Buffer.from(`${canonicalJson(['comments-unit-payload', 'v1', selection.exportId]).slice(0, -1)},[`)), payloadDigest: null };
    if (!Number.isSafeInteger(state.frozenAt) || state.frozenAt < 0) throw new CommentsTransportError('unavailable', 'Export clock is invalid');
    await writeCommentsExport(context, state, true); fresh = true;
  }
  if (state.selectionDigest !== selectionDigest) throw new CommentsTransportError('conflict', 'Export identity has a different frozen selection');
  // Even terminal preparation recovery rechecks current scope coverage.
  for (const selected of selection.selections) await assertCommentsPgVisible(context, chainIdentity(selected).key);
  if (state.payloadDigest) { context.replayed(); return { state: 'prepared', boundary: commentsExportBoundary(state) }; }
  const continuation = input.continuation === null ? null : decodeCommentsExportCursor(state, 'prepare', input.continuation);
  let work = { records: 0, bytes: 0 };
  if (fresh || continuation?.records === state.scan.records) {
    const page = await readCommentsExportRecords(options, context, state, state.scan, 50, 524288);
    let count = state.scan.records;
    for (const record of page.records) { state.digest = updatePortableDigest(state.digest, Buffer.from((count === '0' ? '' : ',') + canonicalJson([record.kind, record.hash]))); count = (BigInt(count) + 1n).toString(); }
    state.scan = page.position; work = { records: page.records.length, bytes: page.bytes };
    if (page.complete) state.payloadDigest = finishPortableDigest(updatePortableDigest(state.digest, Buffer.from(']]')));
    await writeCommentsExport(context, state);
  }
  context.replayed();
  return state.payloadDigest ? { state: 'prepared', boundary: commentsExportBoundary(state) } : { state: 'preparing', continuation: encodeCommentsExportCursor(state, 'prepare', state.scan), work };
};
