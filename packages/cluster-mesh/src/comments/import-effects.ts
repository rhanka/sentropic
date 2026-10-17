import { canonicalJson, hashRecord, sha256Hex } from '@sentropic/comments';
import type { CanonicalChainRecord, CanonicalBatchReceiptSnapshot, CanonicalUnitReceipt } from '@sentropic/comments';
import type { AtomicUnit } from '../storage/atomic.js';
import { EFFECT_SECTIONS } from '../storage/staged-preparation.js';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import { updatePortableDigest, finishPortableDigest } from '../storage/postgres/digest.js';
import { commentsRecordEffects } from './record-effects.js';
import { chainIdentity, commandKey, commentsObjectKey, decodeRecord, selectionForRecord } from './storage-schema.js';
import { CommentsTransportError, type CommentsFragment, type CommentsUnitRoot } from './transport-contracts.js';
import type { CommentsImportState } from './import-state.js';
export const mergeCommentsEffects = (...parts: readonly AtomicUnit[]): AtomicUnit => Object.fromEntries(EFFECT_SECTIONS.map((section) => [section, parts.flatMap<unknown>((part) => part[section])])) as unknown as AtomicUnit;
export const commentsImportDataEffects = (records: readonly CanonicalChainRecord[]): AtomicUnit => {
  const parts = records.map((record) => {
    const effects = commentsRecordEffects(selectionForRecord(record), record, 'link' in record ? record.link.previousHash : null);
    return record.kind === 'lifecycle-event' && record.action === 'tombstone'
      ? { ...effects, barriers: [{ boundary: commentsObjectKey(record.objectKind, record.objectId), reason: `comments-import:${record.hash}` }] } : effects;
  });
  return mergeCommentsEffects(...parts);
};
export const appendCommentsUnitPayload = (state: CommentsImportState, fragment: CommentsFragment): void => {
  const unit = state.units.find((unit) => unit.unitId === fragment.manifest.unitId);
  if (!unit) throw new CommentsTransportError('invalid-request', 'Fragment belongs to an undeclared unit');
  for (const record of fragment.payload) {
    unit.digest = updatePortableDigest(unit.digest, Buffer.from((unit.records === '0' ? '' : ',') + canonicalJson([record.kind, record.hash])));
    unit.records = (BigInt(unit.records) + 1n).toString();
  }
};
export const verifyCommentsTerminal = (state: CommentsImportState, fragment: CommentsFragment): readonly CommentsUnitRoot[] => {
  const terminal = fragment.manifest.terminal;
  if (!terminal || terminal.unitRoots.length !== state.units.length) throw new CommentsTransportError('incomplete', 'Terminal unit inventory is incomplete');
  return state.units.map((unit) => {
    const payloadDigest = finishPortableDigest(updatePortableDigest(unit.digest, Buffer.from(']]')));
    const declared = terminal.unitRoots.find((root) => root.unitId === unit.unitId);
    const requested = state.binding.request.units.find((candidate) => candidate.unitId === unit.unitId)!;
    if (unit.records === '0' || declared?.records !== unit.records || declared.payloadDigest !== payloadDigest || requested.payloadDigest !== payloadDigest) throw new CommentsTransportError('incomplete', 'Terminal payload count or digest is incomplete');
    return { unitId: unit.unitId, records: unit.records, payloadDigest };
  });
};
export const commentsImportReceiptEffects = async (state: CommentsImportState, context: PgInstalledContext): Promise<AtomicUnit> => {
  const request = state.binding.request; const parts: AtomicUnit[] = [];
  const batchKey = canonicalJson(['comments-batch-binding', 'v1', request.batchId]);
  const stored = await context.aggregate(batchKey);
  const batch = stored ? JSON.parse(stored.value.data) as { manifestHash: string; mappingVersion: string; units: readonly string[] } : null;
  if (batch && (batch.manifestHash !== request.manifest.hash || batch.mappingVersion !== request.expectedMappingVersion)) throw new CommentsTransportError('conflict', 'Frozen batch manifest or mapping changed');
  if (state.binding.unitIds.some((id) => batch?.units.includes(id))) throw new CommentsTransportError('conflict', 'Import unit is already committed under another operation');
  const requestDigest = sha256Hex(canonicalJson(['comments-batch-request', 'v1', request]));
  const committedCommand = await context.index(commandKey(request.idempotencyKey));
  if (committedCommand && committedCommand.digest !== requestDigest) throw new CommentsTransportError('conflict', 'Batch command identity changed');
  const genesis = async (record: CanonicalChainRecord) => {
    const selection = selectionForRecord(record); const previous = await context.head(chainIdentity(selection).key);
    if (previous) {
      if (previous.hash !== record.hash) throw new CommentsTransportError('conflict', 'Import genesis identity has different content');
      return;
    }
    parts.push(commentsRecordEffects(selection, record, null));
  };
  await genesis(request.manifest);
  const receipts: CanonicalUnitReceipt[] = [];
  for (const unitId of state.binding.unitIds) {
    if (await context.head(chainIdentity({ kind: 'unit-receipts', unitId }).key)) throw new CommentsTransportError('conflict', 'Import unit receipt is already committed');
    const definition = request.units.find((unit) => unit.unitId === unitId)!;
    for (const dependency of definition.dependsOnUnitIds) if (!state.binding.unitIds.includes(dependency)) {
      const prior = await context.head(chainIdentity({ kind: 'unit-receipts', unitId: dependency }).key);
      if (!prior || (decodeRecord(prior.bytes, prior.hash) as CanonicalUnitReceipt).manifestHash !== request.manifest.hash) throw new CommentsTransportError('incomplete', 'Required import dependency is not committed');
    }
    const envelope = { scope: request.scope, unitId, manifestHash: request.manifest.hash, issuedAt: state.issuedAt };
    const receipt: CanonicalUnitReceipt = { kind: 'unit-receipt', ...envelope, hash: hashRecord('unit-receipt', envelope) };
    await genesis(receipt); receipts.push(receipt);
  }
  const selection = { kind: 'batch-receipt-snapshots' as const, batchId: request.batchId };
  const prior = await context.head(chainIdentity(selection).key);
  const previous = prior ? decodeRecord(prior.bytes, prior.hash) as CanonicalBatchReceiptSnapshot : null;
  const envelope = { scope: request.scope, batchId: request.batchId, receiptCount: (previous?.receiptCount ?? 0) + receipts.length,
    snapshotDigest: sha256Hex(canonicalJson(['comments-batch-snapshot', 'v1', previous?.hash ?? null, previous?.snapshotDigest ?? null, receipts.map((receipt) => receipt.hash)])) };
  const snapshot: CanonicalBatchReceiptSnapshot = { kind: 'batch-receipt-snapshot', ...envelope, hash: hashRecord('batch-receipt-snapshot', envelope) };
  parts.push(commentsRecordEffects(selection, snapshot, previous?.hash ?? null));
  state.canonical = { snapshot, unitOutcomes: receipts.map((receipt) => ({ outcome: 'committed', unitId: receipt.unitId, receipt })) };
  const effects = mergeCommentsEffects(...parts);
  const committedUnits = [...batch?.units ?? [], ...state.binding.unitIds];
  return { ...effects, guards: stored ? [{ kind: 'aggregate-version', key: batchKey, version: stored.version }] : [],
    updates: [{ key: batchKey, version: (stored?.version ?? 0) + 1, value: { format: 'utf8', data: canonicalJson({ manifestHash: request.manifest.hash, mappingVersion: request.expectedMappingVersion, units: committedUnits }) } }],
    indexWrites: [{ key: commandKey(request.idempotencyKey), digest: requestDigest, resultIds: committedUnits, resultHash: snapshot.hash }],
    moduleResult: { format: 'utf8', data: canonicalJson(state.canonical) } };
};
