import { createKeyMutex } from './ports.js';
import { ArtifactOperationError } from './failures.js';

export interface LiveIdentity { storageScopeId: string; artifactId: string; bindingGeneration: number }
/** A-LIVE Amendment 1: idle strictly after 900 s since the last qualifying access; there is no absolute lifetime. */
export const LIVE_IDLE_THRESHOLD_MS = 900_000;
export interface LiveOverlayEntry { path: string; text: string | null; mode: string }
export interface LiveRuntimeState {
  liveSessionId: string;
  phase: 'DORMANT' | 'REVIVING' | 'LIVE' | 'QUIESCING' | 'BUILD_PROVISIONING' | 'BUILDING' |
    'VERIFYING' | 'PUBLISHING' | 'SAVING' | 'DECOMMISSIONING' | 'RECOVERING' | 'FAILED';
  leaseEpoch: number; routeEpoch: number; rowVersion: number; ownerId: string; podUid: string | null;
  sourceRevision: string; baseHeadSha: string; liveTreeSha: string;
  idleDeadline: string; activeAttemptId: string | null; stateDetail: string | null;
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
export type LiveInvitationStatus = 'pending' | 'active' | 'revoked' | 'expired' | 'ceased';
/** Dedicated session-bound live authorization record (A-LIVE v2 §8.2, §9); never a release grant. */
export interface LiveInvitationRecord extends LiveIdentity {
  liveSessionId: string; invitationId: string; principalId: string; createdBy: string;
  status: LiveInvitationStatus; epoch: number; expiresAt: string; acceptedAt: string | null;
  revokedAt: string | null; createdAt: string; rowVersion: number;
}
/** Invitations of the transaction's artifact, serialized by the same lock as its live record. */
export interface LiveInvitationLedger {
  /** Every invitation of the artifact in this storage scope, across generations and sessions. */
  list(): Promise<LiveInvitationRecord[]>;
  /** Insert at rowVersion 1, otherwise compare-and-swap on rowVersion - 1. */
  save(record: LiveInvitationRecord): Promise<void>;
  /** The session invitation epoch; 0 before the first invitation. */
  epoch(bindingGeneration: number, liveSessionId: string): Promise<number>;
  setEpoch(bindingGeneration: number, liveSessionId: string, epoch: number): Promise<void>;
}
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
  /** Live invitations (A-LIVE v2 §9); absent when the adapter does not qualify them. */
  invitations?: LiveInvitationLedger;
}
export interface LiveStore {
  transaction<T>(identity: LiveIdentity, action: (tx: LiveTransaction) => Promise<T>): Promise<T>;
  sessionIdentity(scope: string, artifactId: string, liveSessionId: string): Promise<LiveIdentity | undefined>;
  /** Drafts of the scope whose runtime still waits for the worker (see liveWorkerPending), oldest access first.
   * Absent when the adapter cannot list them: the host then has no durable re-drive. */
  pending?(scope: string, limit?: number): Promise<LiveIdentity[]>;
}
/** A runtime waits for the worker while it revives, while a stop is not DORMANT yet, or while LIVE trails its draft. */
export function liveWorkerPending(record: Pick<LiveDraftRecord, 'revision' | 'runtime'> | undefined): 'project' | 'stop' | null {
  const runtime = record?.runtime;
  if (!record || !runtime) return null;
  if (runtime.phase === 'QUIESCING' || runtime.phase === 'SAVING' || runtime.phase === 'DECOMMISSIONING') return 'stop';
  return runtime.phase === 'REVIVING' || (runtime.phase === 'LIVE' && runtime.appliedRevision !== record.revision) ? 'project' : null;
}
export const liveIdentityKey = (identity: LiveIdentity): string => JSON.stringify([
  identity.storageScopeId, identity.artifactId, identity.bindingGeneration]);

const openInvitation = (row: LiveInvitationRecord) => row.status === 'pending' || row.status === 'active';
function memoryInvitations(identity: LiveIdentity, rows: Map<string, LiveInvitationRecord>, epochs: Map<string, number>) {
  const pending = new Map<string, LiveInvitationRecord>(); const pendingEpochs = new Map<string, number>();
  const epochKey = (generation: number, session: string) => JSON.stringify([identity.storageScopeId, identity.artifactId, generation, session]);
  const own = () => [...new Map([...rows, ...pending]).values()].filter(row =>
    row.storageScopeId === identity.storageScopeId && row.artifactId === identity.artifactId);
  const ledger: LiveInvitationLedger = {
    list: async () => structuredClone(own()),
    async save(row) {
      const prior = pending.get(row.invitationId) ?? rows.get(row.invitationId);
      if (row.storageScopeId !== identity.storageScopeId || row.artifactId !== identity.artifactId || (prior &&
        (prior.storageScopeId !== row.storageScopeId || prior.artifactId !== row.artifactId))) throw new ArtifactOperationError('access_denied');
      if ((prior?.rowVersion ?? 0) + 1 !== row.rowVersion) throw new ArtifactOperationError('git_live_conflict', { publicDetails: { reason: 'stale_fence' } });
      if (openInvitation(row) && own().some(other => other.invitationId !== row.invitationId && openInvitation(other) &&
        other.bindingGeneration === row.bindingGeneration && other.liveSessionId === row.liveSessionId &&
        other.principalId === row.principalId)) throw new ArtifactOperationError('git_live_conflict', { publicDetails: { reason: 'active_session' } });
      pending.set(row.invitationId, structuredClone(row));
    },
    epoch: async (generation, session) => pendingEpochs.get(epochKey(generation, session)) ?? epochs.get(epochKey(generation, session)) ?? 0,
    async setEpoch(generation, session, epoch) { pendingEpochs.set(epochKey(generation, session), epoch); },
  };
  const commit = () => { for (const [k, v] of pending) rows.set(k, v); for (const [k, v] of pendingEpochs) epochs.set(k, v); };
  return { ledger, commit };
}

/** Atomic fake; the persisted representation contains encrypted objects and metadata only. */
export function createMemoryLiveStore(): LiveStore {
  const records = new Map<string, LiveDraftRecord>();
  const objects = new Map<string, LiveEnvelope>();
  const receipts = new Map<string, LiveReceipt>();
  const quota: { scope: string; artifact: string; actor: string; invocation: string; at: number }[] = [];
  const invitations = new Map<string, LiveInvitationRecord>(); const epochs = new Map<string, number>();
  const mutex = createKeyMutex();
  return {
    async sessionIdentity(scope, artifactId, sessionId) {
      const record = [...records.values()].find(row => row.storageScopeId === scope && row.artifactId === artifactId &&
        row.runtime?.liveSessionId === sessionId);
      return record ? { storageScopeId: scope, artifactId, bindingGeneration: record.bindingGeneration } : undefined;
    },
    async pending(scope, limit = 64) {
      return [...records.values()].filter(row => row.storageScopeId === scope && liveWorkerPending(row))
        .sort((a, b) => (a.runtime!.lastAccessAt < b.runtime!.lastAccessAt ? -1 : 1)).slice(0, limit)
        .map(row => ({ storageScopeId: scope, artifactId: row.artifactId, bindingGeneration: row.bindingGeneration }));
    },
    transaction: (identity, action) => mutex.runSerialized('live-store', async () => {
    const id = liveIdentityKey(identity);
    const pendingObjects = new Map<string, LiveEnvelope | undefined>();
    const pendingReceipts = new Map<string, LiveReceipt>();
    const pendingQuota: typeof quota = [];
    const invitationTx = memoryInvitations(identity, invitations, epochs);
    const receiptKey = (actor: string, key: string) => JSON.stringify([identity.storageScopeId, actor, key]);
    const tx: LiveTransaction = {
      record: structuredClone(records.get(id)),
      invitations: invitationTx.ledger,
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
        const principalFull = scoped.filter(q => q.actor === actor).length >= 30;
        if (principalFull || scoped.filter(q => q.artifact === identity.artifactId).length >= 60) throw new ArtifactOperationError('limit_exceeded',
          { publicDetails: { quota: 'git_write', scope: principalFull ? 'principal' : 'artifact' } });
        pendingQuota.push({ scope: identity.storageScopeId, artifact: identity.artifactId, actor, invocation, at: Date.parse(now) });
      },
    };
    const original = JSON.stringify(tx.record);
    const result = await action(tx);
    if (tx.record && JSON.stringify(tx.record) !== original) {
      if (liveIdentityKey(tx.record) !== id) throw new ArtifactOperationError('access_denied');
      tx.record.rowVersion = (records.get(id)?.rowVersion ?? 0) + 1;
      records.set(id, structuredClone(tx.record));
    }
    for (const [key, object] of pendingObjects) { if (object) objects.set(key, object); else objects.delete(key); }
    for (const [key, receipt] of pendingReceipts) receipts.set(key, receipt);
    quota.push(...pendingQuota);
    invitationTx.commit();
    return structuredClone(result);
  }) };
}
