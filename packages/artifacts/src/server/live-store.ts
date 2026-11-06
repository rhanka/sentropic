import { createKeyMutex } from './ports.js';
import { ArtifactOperationError } from './failures.js';

export interface LiveIdentity { storageScopeId: string; artifactId: string; bindingGeneration: number }
export interface LiveOverlayEntry { path: string; text: string | null; mode: string }
export interface LiveRuntimeState {
  liveSessionId: string;
  phase: 'DORMANT' | 'REVIVING' | 'LIVE' | 'QUIESCING' | 'BUILD_PROVISIONING' | 'BUILDING' |
    'VERIFYING' | 'PUBLISHING' | 'SAVING' | 'DECOMMISSIONING' | 'RECOVERING' | 'FAILED';
  leaseEpoch: number; routeEpoch: number; rowVersion: number; ownerId: string; podUid: string | null;
  sourceRevision: string; baseHeadSha: string; liveTreeSha: string;
  idleDeadline: string; maximumLifetimeAt: string; activeAttemptId: string | null; stateDetail: string | null;
  appliedRevision: string | null; lastAccessAt: string; pendingWake: boolean;
  origin?: 'implicit' | 'explicit'; renewOnReady?: boolean;
}
export interface LiveCommitIntent {
  actorId: string; key: string; hash: string; invocationId: string; createdAt: string;
  message: string; expectedHeadSha: string; revision: string; liveTreeSha: string;
  policyDigest: string;
}
export interface LiveDraftRecord extends LiveIdentity {
  revision: string; baseHeadSha: string; baseTreeSha: string; liveTreeSha: string;
  objectRef: string | null; keyVersion: string | null; digest: string | null;
  expiresAt: string | null; changedPaths: number; draftBytes: number;
  tombstone: 'reset' | 'expired' | null;
  runtime: LiveRuntimeState | null; pendingCommit: LiveCommitIntent | null;
  progressSeq: number; latestVerifiedHeadSha: string; publicationBaselineSeq: number;
  publicationBaselineHeadSha: string; lastSuccessfulReleaseId: string | null;
  initialUnpublishedBranchEligible: boolean;
  rowVersion: number; createdAt: string; updatedAt: string; lastProgressEventId: string | null;
  snapshots?: Record<string, import('./live-contracts.js').LiveSnapshot>;
}
export interface LiveEnvelope { nonce: string; ciphertext: string; tag: string }
export interface LiveCommand { actorId: string; key: string; hash: string; operation: string }
export type LiveResult = Record<string, unknown> & { revision: string };
export interface LiveReceipt { hash: string; result: LiveResult }
export interface LiveTransaction {
  record: LiveDraftRecord | undefined;
  getObject(ref: string): Promise<LiveEnvelope | undefined>;
  putObject(ref: string, envelope: LiveEnvelope): Promise<void>;
  collectObjects(): Promise<number>;
  receipt(actorId: string, key: string): Promise<LiveReceipt | undefined>;
  complete(command: LiveCommand, result: LiveResult): Promise<void>;
  reserveCommit(actorId: string, invocationId: string, now: string): Promise<void>;
  /** Adapter-owned SG1 update in the same transaction as draft cleanup. */
  advanceBinding?(input: { expectedHeadSha: string; commitSha: string; invocationId: string;
    actorId: string; now: string }): Promise<void>;
}
export interface LiveStore {
  transaction<T>(identity: LiveIdentity, action: (tx: LiveTransaction) => Promise<T>): Promise<T>;
  sessionIdentity(scope: string, artifactId: string, liveSessionId: string): Promise<LiveIdentity | undefined>;
}
export const liveIdentityKey = (identity: LiveIdentity): string => JSON.stringify([
  identity.storageScopeId, identity.artifactId, identity.bindingGeneration]);

/** Atomic fake; the persisted representation contains encrypted objects and metadata only. */
export function createMemoryLiveStore(): LiveStore {
  const records = new Map<string, LiveDraftRecord>();
  const objects = new Map<string, LiveEnvelope>();
  const receipts = new Map<string, LiveReceipt>();
  const quota: { scope: string; artifact: string; actor: string; invocation: string; at: number }[] = [];
  const mutex = createKeyMutex();
  return {
    async sessionIdentity(scope, artifactId, sessionId) {
      const record = [...records.values()].find(row => row.storageScopeId === scope && row.artifactId === artifactId &&
        row.runtime?.liveSessionId === sessionId);
      return record ? { storageScopeId: scope, artifactId, bindingGeneration: record.bindingGeneration } : undefined;
    },
    transaction: (identity, action) => mutex.runSerialized('live-store', async () => {
    const id = liveIdentityKey(identity);
    const pendingObjects = new Map<string, LiveEnvelope | undefined>();
    const pendingReceipts = new Map<string, LiveReceipt>();
    const pendingQuota: typeof quota = [];
    const receiptKey = (actor: string, key: string) => JSON.stringify([identity.storageScopeId, actor, key]);
    const tx: LiveTransaction = {
      record: structuredClone(records.get(id)),
      getObject: async ref => structuredClone(pendingObjects.get(id + ref) ?? objects.get(id + ref)),
      async putObject(ref, value) {
        if (objects.has(id + ref) || pendingObjects.has(id + ref)) throw new ArtifactOperationError('command_conflict');
        pendingObjects.set(id + ref, structuredClone(value));
      },
      async collectObjects() {
        let count = 0;
        for (const key of objects.keys()) {
          if (key.startsWith(id) && key !== id + tx.record?.objectRef) {
            pendingObjects.set(key, undefined); count++;
          }
        }
        return count;
      },
      receipt: async (actor, key) => structuredClone(receipts.get(receiptKey(actor, key))),
      async complete(command, result) {
        const key = receiptKey(command.actorId, command.key);
        if (receipts.has(key)) throw new ArtifactOperationError('command_conflict');
        pendingReceipts.set(key, structuredClone({ hash: command.hash, result }));
      },
      async reserveCommit(actor, invocation, now) {
        const scoped = quota.filter(q => q.scope === identity.storageScopeId && q.at > Date.parse(now) - 3600000);
        if (scoped.some(q => q.invocation === invocation && q.actor === actor)) return;
        if (scoped.filter(q => q.actor === actor).length >= 30 ||
          scoped.filter(q => q.artifact === identity.artifactId).length >= 60) throw new ArtifactOperationError('limit_exceeded');
        pendingQuota.push({ scope: identity.storageScopeId, artifact: identity.artifactId, actor, invocation, at: Date.parse(now) });
      },
    };
    const result = await action(tx);
    if (tx.record) {
      tx.record.rowVersion = (records.get(id)?.rowVersion ?? 0) + 1;
      records.set(id, structuredClone(tx.record));
    }
    for (const [key, object] of pendingObjects) { if (object) objects.set(key, object); else objects.delete(key); }
    for (const [key, receipt] of pendingReceipts) receipts.set(key, receipt);
    quota.push(...pendingQuota);
    return structuredClone(result);
  }) };
}
