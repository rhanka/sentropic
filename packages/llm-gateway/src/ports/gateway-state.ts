/**
 * Gateway state port (L1, spec 6.1/6.2).
 *
 * Versioned atomic compare-and-set transactions over caller sessions and
 * request receipts. A trusted host binds this port to protected local
 * storage (0600 files, lock ownership, atomic durable writes) or to a
 * transactional application adapter. The service layer never touches bytes.
 */
import type { LaunchRoutingContract, RouteAffinityRecord } from '@sentropic/llm-mesh';
export interface StoredSession {
  readonly schemaVersion: number;
  readonly sessionRef: string;
  readonly ownerScopeRef: string;
  readonly workspaceRef: string;
  readonly clientSessionRef: string;
  /** Protected verifier; key material is encrypted by the bound state store. */
  readonly keyVerifier: string;
  readonly keyMaterial: string;
  readonly keyId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly profiles: readonly string[];
  readonly models: readonly string[];
  readonly mappingRevision?: string;
  readonly policyRevision: string;
  readonly affinityRequired?: boolean;
  readonly routingContract?: LaunchRoutingContract;
}

export interface StoredReceipt {
  readonly policyRevision?: string;
  readonly mappingRevision?: string;
  readonly mappingContentSha256?: string;
  readonly physicalAttempts?: readonly StoredRequestAttempt[];
  readonly schemaVersion: number;
  readonly receiptId: string;
  readonly sessionRef: string;
  readonly ownerScopeRef: string;
  readonly requestId: string;
  readonly model: string;
  readonly attempts: number;
  readonly settlement: string;
  readonly createdAt: string;
  readonly settledAt?: string;
}
export interface StoredRequestAttempt {
  readonly attemptRef: string;
  readonly candidateRef: string;
  readonly diagnosticAccountRef: string;
  readonly selectedProviderId: string;
  readonly selectedModel: string;
  readonly selectedTransport: string;
  readonly outcome: string;
  readonly usage: { inputTokens: number; outputTokens: number } | null;
  /** Launch/selection is not upstream model attestation. */
  readonly observedServedModel: string | null;
  readonly modelEvidence: 'selection-only' | 'provider-reported';
}

export interface StoredState {
  readonly affinities?: Record<string, RouteAffinityRecord>;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly sessions: Record<string, StoredSession>;
  readonly receipts: Record<string, StoredReceipt>;
}

export interface GatewayStateStore {
  /** Load the committed state. Corruption throws CORRUPT (never an empty reset). */
  load(): Promise<StoredState>;
  /**
   * Atomically replace the state when its revision still matches.
   * Throws CONFLICT on a concurrent write, STORE-FAILED before any commit.
   */
  compareAndSet(expectedRevision: number, next: StoredState): Promise<{ revision: number }>;
}

export type GatewayStateErrorCode =
  | 'CORRUPT'
  | 'CONFLICT'
  | 'STORE-FAILED'
  | 'KEY-UNAVAILABLE';

export class GatewayStateError<Code extends string = GatewayStateErrorCode> extends Error {
  readonly code: Code;
  constructor(message: string, code: Code) {
    super(message);
    this.name = 'GatewayStateError';
    this.code = code;
  }
}
