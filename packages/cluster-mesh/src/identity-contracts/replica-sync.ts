// A4 composition-gaps bundle (1.2.0), domain identity_replica_sync (lot G5,
// design a4-cm-gaps-r2 §9.1): preprod IdP replica convergence on CM authority.
// The source placement stays sole author for its subjects; the replica
// placement converges its copies and authors nothing for them. Ids, owners
// and counters are never rekeyed, merged or rewritten by sync.

import type {
  IdentityAccountProfileV1,
  IdentityRunOptionsV1,
  IdentityTransactionV1,
  IdentityUnitOfWorkV1,
  WebAuthnCredentialV1,
} from './custody.js';
import type { IdentityClock, OAuthConsentRecord, UserAccount } from './types.js';

/** Closed entity union: no sessions, proofs, invitations, tokens, challenges,
    social links, tenants, memberships or workspaces cross placements in v1. */
export type IdentityReplicaSyncRowV1 =
  | { readonly entity: 'account'; readonly record: UserAccount; readonly profile: IdentityAccountProfileV1 }
  | { readonly entity: 'credential'; readonly record: WebAuthnCredentialV1 }
  | { readonly entity: 'oauth_consent'; readonly record: OAuthConsentRecord };

export type IdentityReplicaSyncEntityV1 = IdentityReplicaSyncRowV1['entity'];

export interface IdentityReplicaSyncBatchV1 {
  readonly contractVersion: '1.2.0';
  readonly syncId: string;
  readonly sourcePlacement: string;
  readonly sourceSnapshotRef: string;
  readonly sourceSnapshotDigest: string;
  readonly manifestDigest: string;
  readonly exportedAt: string;
  readonly rows: readonly IdentityReplicaSyncRowV1[];
}

export interface IdentityReplicaSyncCountsV1 {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly revokedApplied: number;
  readonly revokedKept: number;
}

export interface IdentityReplicaSyncReceiptV1 {
  readonly contractVersion: '1.2.0';
  readonly syncId: string;
  readonly sourcePlacement: string;
  readonly sourceSnapshotDigest: string;
  readonly manifestDigest: string;
  readonly appliedAt: string;
  readonly counts: Readonly<Record<IdentityReplicaSyncEntityV1, IdentityReplicaSyncCountsV1>>;
  readonly identitiesPreserved: true;
  readonly ownersPreserved: true;
  readonly countersPreserved: true;
}

export interface IdentityReplicaSyncIssueReferenceV1 {
  readonly rowIndex: number;
  /** Subject ids only: emails, credential ids and consent ids never appear. */
  readonly safeIdentity?: readonly string[];
}

export interface IdentityReplicaSyncValidationV1 {
  readonly valid: boolean;
  readonly issues: readonly {
    readonly entity: IdentityReplicaSyncEntityV1;
    readonly code: 'identity_sync_conflict' | 'identity_sync_invalid';
    readonly count: number;
    readonly references: readonly IdentityReplicaSyncIssueReferenceV1[];
  }[];
}

export interface IdentityReplicaSyncPortV1<H> {
  /** Read-only advisory validation; never writes. */
  validate(batch: IdentityReplicaSyncBatchV1): Promise<IdentityReplicaSyncValidationV1>;
  /** Opens the unit of work and syncs the whole batch atomically. */
  syncBatch(batch: IdentityReplicaSyncBatchV1): Promise<IdentityReplicaSyncReceiptV1>;
  /** Revalidates and syncs on the supplied write transaction. */
  syncBatchInTransaction(batch: IdentityReplicaSyncBatchV1, tx: IdentityTransactionV1<H>): Promise<IdentityReplicaSyncReceiptV1>;
}

export interface IdentityReplicaExportPortV1<H> {
  exportBatch(input: {
    readonly syncId: string;
    readonly sourcePlacement: string;
    readonly sourceSnapshotRef: string;
  }): Promise<IdentityReplicaSyncBatchV1>;
}

export interface IdentityReplicaSyncInputV1<H> {
  readonly unitOfWork: IdentityUnitOfWorkV1<H>;
  readonly clock: IdentityClock;
  /** write/import */
  readonly syncOptions: IdentityRunOptionsV1;
  /** read/import */
  readonly validationOptions: IdentityRunOptionsV1;
}

export interface IdentityReplicaExportInputV1<H> {
  readonly unitOfWork: IdentityUnitOfWorkV1<H>;
  readonly clock: IdentityClock;
  /** read/import */
  readonly exportOptions: IdentityRunOptionsV1;
}
