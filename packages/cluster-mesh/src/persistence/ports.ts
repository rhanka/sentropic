import type { ClusterMeshNamespace } from '@sentropic/contracts';
import type { InvocationReceiptPort } from '@sentropic/events';
import type { ClusterMeshRegistration, RegistrationLookupPort } from '../runtime/registration.js';

export interface StoredClusterMeshGeneration {
  readonly generationId: string;
  readonly status: 'starting' | 'active' | 'draining' | 'stopped' | 'lost';
  readonly supervisorRef: string;
  readonly supervisorLeaseExpiresAt: string;
  readonly maxConcurrent: number;
  readonly poolSize: number;
  readonly stoppedAt?: string;
}

export interface StoredCapacityLease {
  readonly leaseId: string;
  readonly generationId: string;
  readonly subjectRef: string;
  readonly status: 'reserved' | 'active' | 'released' | 'expired';
  readonly expiresAt: string;
  readonly leaseExpiresAt: string;
  readonly releasedAt?: string;
}

export type StoredCapacityReservationResult =
  | { readonly ok: true; readonly outcome: 'reserved' | 'idempotent_retry' }
  | {
      readonly ok: false;
      readonly reason: 'capacity_exhausted' | 'generation_unavailable' | 'reservation_conflict';
    };

export interface StoredMcpServer {
  readonly serverId: string;
  readonly generationId: string;
  readonly supervisorRef: string;
  readonly status: 'starting' | 'active' | 'stopped' | 'lost';
  readonly leaseExpiresAt: string;
}

export interface StoredClusterMeshCommand {
  readonly commandId: string;
  readonly generationId: string;
  readonly targetRegistrationId: string;
  readonly idempotencyKey: string;
  readonly action: 'drive' | 'wake' | 'relaunch';
  readonly status: 'pending' | 'accepted' | 'refused' | 'acted' | 'failed';
  readonly refusalReason?: string;
  readonly actedAt?: string;
}

export interface ClusterMeshRuntimeStore extends RegistrationLookupPort, InvocationReceiptPort {
  saveGeneration(generation: StoredClusterMeshGeneration): Promise<void>;
  saveRegistration(registration: ClusterMeshRegistration): Promise<void>;
  markRegistrationLost(registrationId: string, lostAt: string): Promise<boolean>;
  reserveCapacity(lease: StoredCapacityLease): Promise<StoredCapacityReservationResult>;
  reclaimExpiredCapacity(now: string): Promise<number>;
  saveMcpServer(server: StoredMcpServer): Promise<void>;
  enqueueCommand(command: StoredClusterMeshCommand): Promise<boolean>;
  updateCommand(
    commandId: string,
    update: Pick<StoredClusterMeshCommand, 'status' | 'refusalReason' | 'actedAt'>,
  ): Promise<boolean>;
}

export interface NamespaceCutoverKey {
  readonly compositionRoot: 'product' | 'auth-idp';
  readonly namespace: ClusterMeshNamespace;
}

export interface NamespaceCutoverRecord extends NamespaceCutoverKey {
  readonly selectedGenerationId: string;
  readonly previousGenerationId?: string;
  readonly activeAuthor: string;
  readonly status: 'shadow' | 'active' | 'rolled_back' | 'disabled';
  readonly shadowComparison?: unknown;
  readonly rollbackCheckpoint?: unknown;
  readonly activatedAt?: string;
}

export interface ClusterMeshCutoverStore {
  find(key: NamespaceCutoverKey): Promise<NamespaceCutoverRecord | null>;
  activate(record: NamespaceCutoverRecord): Promise<void>;
  rollback(key: NamespaceCutoverKey, selectedGenerationId: string): Promise<void>;
}

export interface ClusterMeshBackfillPort {
  verifyFromEmpty(): Promise<{
    readonly strategy: 'N-A-from-empty';
    readonly sourceRows: 0;
    readonly migratedRows: 0;
  }>;
}

export interface ClusterMeshRollbackVerificationPort {
  verifyRollback(key: NamespaceCutoverKey): Promise<{
    readonly reversible: boolean;
    readonly selectedGenerationId?: string;
  }>;
}

export interface ClusterMeshPersistencePorts {
  readonly runtime: ClusterMeshRuntimeStore;
  readonly cutovers: ClusterMeshCutoverStore;
  readonly backfill: ClusterMeshBackfillPort;
  readonly rollback: ClusterMeshRollbackVerificationPort;
}

export type ClusterMeshPersistenceBinding =
  | { readonly mode: 'LOCAL_ONLY'; readonly local: ClusterMeshPersistencePorts }
  | { readonly mode: 'DURABLE'; readonly durable: ClusterMeshPersistencePorts };

export function selectClusterMeshPersistence(binding: ClusterMeshPersistenceBinding) {
  return binding.mode === 'LOCAL_ONLY' ? binding.local : binding.durable;
}
