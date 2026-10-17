import type { Hash } from 'node:crypto';
import type { AtomicUnit, CommitReceipt } from './atomic.js';
import type { BackendScopeState } from './backend.js';
import type { StorageScope, WriterFence } from './contracts.js';
import type { ModuleDescriptor } from './descriptor.js';
import { IndexedHistory } from './indexed-history.js';
import { IndexedMap } from './indexed-map.js';
import { ProjectionRuntime } from './projection-runtime.js';
import type { FragmentReceipt, StagedBeginInput, StagedCommitRoot, StagedState, StagedUnitHandle, StagedUnitSeal } from './staged-units.js';

export interface AuthenticatedStagedHandle extends StagedUnitHandle { readonly capability: string; }
export interface AuthenticatedStagedSeal extends StagedUnitSeal { readonly capability: string; }
export interface RootJournalEvent {
  readonly seq: number; readonly eventId: string; readonly scope: StorageScope;
  readonly commitId: string; readonly rootVersion: string; readonly operationKey?: string;
  readonly segment?: { readonly operationKey: string; readonly from: number; readonly to: number };
}
export type PurgePolicy = 'unconfigured' | 'optional' | 'required';
export interface RootPurgeJob {
  readonly target: string; readonly intentId: string; readonly authorizedBy: string;
  readonly state: 'pending' | 'held' | 'complete' | 'failed'; readonly outcomeId: string | null;
  readonly payloadDisposition: 'retained' | 'erased' | null;
}
export interface RootBlob { readonly bytes: string | null; readonly owners: IndexedMap<true>; }
export interface RootPurgeEvidence { readonly intentId: string; readonly outcomeId: string; }
export interface StagedRootData {
  readonly kind: 'staged-root-v1';
  readonly barriers: IndexedMap<{ readonly reason: string; readonly createdAt: string }>;
  readonly coverage: IndexedMap<string>; readonly disposed: IndexedMap<true>;
  readonly jobs: IndexedMap<RootPurgeJob>; readonly holds: IndexedMap<string>; readonly blobs: IndexedMap<RootBlob>;
  readonly journal: IndexedHistory<RootJournalEvent>; readonly audit: IndexedHistory<CommitReceipt>;
  readonly outcomes: IndexedHistory<RootPurgeEvidence>; readonly notifications: IndexedHistory<RootPurgeEvidence>;
  readonly unitRoots: IndexedMap<StagedCommitRoot>; readonly projections: ProjectionRuntime;
  policy: PurgePolicy;
}
export const createStagedRootData = (descriptor?: ModuleDescriptor): StagedRootData => {
  const projections = new ProjectionRuntime();
  if (descriptor) projections.registerDescriptor(descriptor);
  return {
    kind: 'staged-root-v1',
    barriers: new IndexedMap(), coverage: new IndexedMap(), disposed: new IndexedMap(), jobs: new IndexedMap(),
    holds: new IndexedMap(), blobs: new IndexedMap(), journal: new IndexedHistory(), audit: new IndexedHistory(),
    outcomes: new IndexedHistory(), notifications: new IndexedHistory(), unitRoots: new IndexedMap(), projections, policy: 'optional',
  };
};
export const forkStagedRootData = (base: StagedRootData): StagedRootData => ({
  kind: 'staged-root-v1',
  barriers: base.barriers.fork(), coverage: base.coverage.fork(), disposed: base.disposed.fork(), jobs: base.jobs.fork(),
  holds: base.holds.fork(), blobs: base.blobs.fork(), journal: base.journal.fork(), audit: base.audit.fork(),
  outcomes: base.outcomes.fork(), notifications: base.notifications.fork(), unitRoots: base.unitRoots.fork(),
  projections: base.projections.fork(), policy: base.policy,
});
export const lockStagedRootData = (data: StagedRootData): StagedRootData => {
  for (const value of Object.values(data)) {
    if (value instanceof IndexedMap || value instanceof IndexedHistory || value instanceof ProjectionRuntime) value.lock();
  }
  return Object.freeze(data);
};
export const coveredBy = (data: StagedRootData, id: string): string | null => {
  const seen = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && !seen.has(current)) {
    if (data.barriers.has(current)) return current;
    seen.add(current); current = data.coverage.get(current);
  }
  return null;
};

export interface OwnedStagedFragment {
  readonly ordinal: string; readonly predecessorHash: string | null; readonly fragmentDigest: string;
  readonly effects: AtomicUnit; readonly dependencyPart: Buffer; readonly effectPart: Buffer;
  readonly itemCosts: readonly (readonly number[])[];
}
export interface RootSealProgress {
  readonly base: BackendScopeState; readonly prepared: BackendScopeState; readonly data: StagedRootData;
  readonly root: StagedCommitRoot; readonly dependencyHash: Hash; readonly effectHash: Hash;
  fragment: number; section: number; item: number; dependencyOffset: number; effectOffset: number;
  checked: number; bytes: number; effectiveRecords: number; effectiveAppends: number; failed?: string;
  receipt?: CommitReceipt;
}
export interface StagedOperation {
  readonly unitId: string; capability: string; ownerId: string; readonly incarnation: string; fence: WriterFence;
  readonly begin: StagedBeginInput; readonly scope: StorageScope;
  fragments: IndexedHistory<OwnedStagedFragment>; readonly commitId: string; readonly receipts: IndexedMap<FragmentReceipt>;
  state: StagedState; progress: RootSealProgress | null; seal: AuthenticatedStagedSeal | null;
  receipt: CommitReceipt | null; moduleResult?: AtomicUnit['moduleResult']; reason?: string;
  totalEffects: number; barrierCount: number; purgeCount: number;
}
export interface RootConsumer {
  cursor: number; status: 'running' | 'stalled' | 'paused'; failedEvent: string | null; failedReason: string | null;
  failedSeq: number | null; scanned: number; retryAuthorized: boolean; deliveredPoison: boolean;
  readonly actions: { readonly by: string; readonly eventId: string | null; readonly at: string }[];
}
export interface RootSnapshot { readonly root: BackendScopeState; readonly journalSeq: number; readonly consumer: string; readonly ownerId: string; consumed: number; }
export interface StagedControl {
  readonly units: Map<string, StagedOperation>; readonly byId: Map<string, StagedOperation>;
  readonly consumers: Map<string, RootConsumer>; readonly snapshots: Map<string, RootSnapshot>;
  readonly fences: Map<string, { readonly value: WriterFence; readonly ownerId: string; readonly expiresAt: string | null }>;
  readonly journalLanes: Map<string, string>;
  readonly failures: Set<'external' | 'purge-before' | 'purge-response' | 'stage-response'>;
}
export const createStagedControl = (): StagedControl => ({
  units: new Map(), byId: new Map(), consumers: new Map(), snapshots: new Map(), fences: new Map(), journalLanes: new Map(), failures: new Set(),
});
