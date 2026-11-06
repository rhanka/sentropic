import { randomUUID } from 'node:crypto';
import { ArtifactOperationError } from './failures.js';
import { decryptLiveDraft, encryptLiveDraft, liveDigest, overlayBytes, type LiveKeyPort } from './live-crypto.js';
import type { LiveCommand, LiveDraftRecord, LiveIdentity, LiveOverlayEntry, LiveStore, LiveTransaction } from './live-store.js';
export * from './live-store.js';
export type { LiveKeyPort } from './live-crypto.js';
export const LIVE_RETENTION_MS = 7 * 24 * 3600 * 1000;
export interface LiveDraftWrite {
  identity: LiveIdentity; expectedRevision: string | null; baseHeadSha: string; baseTreeSha: string;
  liveTreeSha: string; overlay: LiveOverlayEntry[]; command?: LiveCommand;
}
export function cleanLiveRecord(identity: LiveIdentity, head: string, tree: string): LiveDraftRecord {
  return { ...identity, revision: randomUUID(), baseHeadSha: head, baseTreeSha: tree, liveTreeSha: tree,
    objectRef: null, keyVersion: null, digest: null, expiresAt: null, changedPaths: 0, draftBytes: 0,
    tombstone: null, runtime: null, pendingCommit: null, progressSeq: 0, latestVerifiedHeadSha: head,
    publicationBaselineSeq: 0, publicationBaselineHeadSha: head, lastSuccessfulReleaseId: null,
    initialUnpublishedBranchEligible: false };
}
/** Expiry is a serialized tombstone; stale renewal and command replay cannot reverse it. */
export function expireLiveDraft(tx: LiveTransaction, now: number): boolean {
  const record = tx.record;
  if (record?.expiresAt && Date.parse(record.expiresAt) <= now && record.tombstone !== 'expired') {
    tx.record = { ...record, objectRef: null, keyVersion: null, digest: null, tombstone: 'expired' };
  }
  return tx.record?.tombstone === 'expired';
}
export async function readLiveOverlay(tx: LiveTransaction, keys: LiveKeyPort): Promise<LiveOverlayEntry[]> {
  const record = tx.record;
  if (record?.tombstone === 'expired') throw new ArtifactOperationError('git_live_draft_expired',
    { publicDetails: { draftExpiresAt: record.expiresAt } });
  if (!record?.objectRef) return [];
  try {
    const envelope = await tx.getObject(record.objectRef);
    if (!envelope) throw new Error('missing draft');
    return await decryptLiveDraft(record, envelope, keys);
  } catch (cause) { throw new ArtifactOperationError('git_live_draft_unavailable', { cause }); }
}
export async function persistLiveOverlay(tx: LiveTransaction, keys: LiveKeyPort, input: LiveDraftWrite,
  now: number, renew = true, preserveRevision = false): Promise<LiveDraftRecord> {
  const overlay = [...input.overlay].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const size = overlayBytes(overlay);
  const record = { ...(tx.record ?? cleanLiveRecord(input.identity, input.baseHeadSha, input.baseTreeSha)),
    revision: preserveRevision ? tx.record!.revision : randomUUID(), baseHeadSha: input.baseHeadSha, baseTreeSha: input.baseTreeSha,
    liveTreeSha: input.liveTreeSha, objectRef: randomUUID(), digest: liveDigest(JSON.stringify(overlay)),
    changedPaths: overlay.length, draftBytes: size, tombstone: null,
    expiresAt: renew ? new Date(now + LIVE_RETENTION_MS).toISOString() : tx.record?.expiresAt ?? null } satisfies LiveDraftRecord;
  try {
    await tx.putObject(record.objectRef!, await encryptLiveDraft(record, JSON.stringify(overlay), keys));
  } catch (cause) { throw new ArtifactOperationError('git_live_draft_unavailable', { cause }); }
  tx.record = record;
  return record;
}
/** All public methods commit objects, pointers and command receipts together. */
export function createLiveDraftVault(deps: { store: LiveStore; keys: LiveKeyPort; now?: () => number }) {
  const now = deps.now ?? Date.now;
  async function expire(identity: LiveIdentity): Promise<boolean> {
    return deps.store.transaction(identity, async tx => expireLiveDraft(tx, now()));
  }
  return {
    async read(identity: LiveIdentity) {
      await expire(identity);
      return deps.store.transaction(identity, async tx => tx.record
        ? { ...tx.record, overlay: await readLiveOverlay(tx, deps.keys) } : undefined);
    },
    async write(input: LiveDraftWrite) {
      const snapshot = structuredClone(input);
      await expire(snapshot.identity);
      return deps.store.transaction(snapshot.identity, async tx => {
        if (snapshot.command) {
          const prior = await tx.receipt(snapshot.command.actorId, snapshot.command.key);
          if (prior) {
            if (prior.hash !== snapshot.command.hash) throw new ArtifactOperationError('command_conflict');
            return { ...prior.result, replayed: true } as LiveDraftRecord & { replayed: boolean };
          }
        }
        if (tx.record?.tombstone === 'expired') throw new ArtifactOperationError('git_live_draft_expired');
        if ((tx.record?.revision ?? null) !== snapshot.expectedRevision) throw new ArtifactOperationError('git_live_revision_moved');
        const record = await persistLiveOverlay(tx, deps.keys, snapshot, now());
        if (snapshot.command) await tx.complete(snapshot.command, { ...record });
        return { ...record, replayed: false };
      });
    },
    async renew(identity: LiveIdentity, expectedRevision: string) {
      await expire(identity);
      return deps.store.transaction(identity, async tx => {
        const record = tx.record;
        if (record?.tombstone === 'expired') throw new ArtifactOperationError('git_live_draft_expired');
        if (!record || record.revision !== expectedRevision) throw new ArtifactOperationError('git_live_revision_moved');
        const overlay = await readLiveOverlay(tx, deps.keys);
        if (!record.changedPaths) return record;
        const renewed = await persistLiveOverlay(tx, deps.keys, { identity, expectedRevision,
          baseHeadSha: record.baseHeadSha, baseTreeSha: record.baseTreeSha,
          liveTreeSha: record.liveTreeSha, overlay }, now(), true, true);
        return renewed;
      });
    },
  };
}
