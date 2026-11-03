import type {
  IdentityAccountProfileV1, IdentityDeletionAttemptV2, IdentityDeletionOperationV2,
  IdentityExternalRevocationV1, IdentityRevocationClaimV1, IdentityTransactionV1,
  BusinessDeletionPlanV1, PersonDeletionCommandV2, PersonDeletionReceiptV2,
} from './custody.js';
import type { RevocationStepKind, UserAccount } from './types.js';

export interface IdentitySubjectLifecyclePortV1 {
  register(account: UserAccount, profile: IdentityAccountProfileV1): Promise<void>;
  updateEmail(userId: string, email: string, at: string): Promise<UserAccount>;
}

export interface IdentityCleanupReceiptV1 {
  readonly deletedByTable: Readonly<Record<string, number>>;
  readonly detachedByTable: Readonly<Record<string, number>>;
  readonly remainingLiveReferences: number;
}

export interface PersonOrphanCleanupPortV1 {
  deleteSubjectReferences(input: {
    readonly userId: string; readonly accountEmail: string | null;
    readonly workspaceIdsToDelete: readonly string[]; readonly at: string;
  }): Promise<IdentityCleanupReceiptV1>;
  assertNoLiveReferences(input: {
    readonly userId: string; readonly accountEmail: string | null; readonly deletedWorkspaceIds: readonly string[];
  }): Promise<void>;
}

export interface IdentityDeletionJournalPortV2 {
  reserve(record: IdentityDeletionOperationV2): Promise<IdentityDeletionOperationV2>;
  find(operationId: string): Promise<IdentityDeletionOperationV2 | null>;
  lock(operationId: string): Promise<IdentityDeletionOperationV2 | null>;
  markCommitted(operationId: string, receipt: PersonDeletionReceiptV2): Promise<void>;
  appendRolledBack(attemptId: string, receipt: PersonDeletionReceiptV2): Promise<void>;
  listAttempts(operationId: string): Promise<readonly IdentityDeletionAttemptV2[]>;
}

export type IdentityRevocationTargetKindV1 = 'login_session' | 'subject' | 'connector_grant' | 'plane_resource';
export interface IdentityExternalRevocationDraftV1 {
  readonly step: RevocationStepKind;
  readonly subjectId: string;
  readonly targetKind: IdentityRevocationTargetKindV1;
  readonly targetRef: string;
  readonly custodyRef: string | null;
}

export interface IdentityRevocationOutboxPortV1 {
  enqueue(record: IdentityExternalRevocationV1): Promise<void>;
  find(deliveryId: string): Promise<IdentityExternalRevocationV1 | null>;
  listPending(operationId: string): Promise<readonly IdentityExternalRevocationV1[]>;
  claimPending(input: { readonly workerId: string; readonly now: string; readonly leaseUntil: string; readonly limit: number }): Promise<readonly IdentityRevocationClaimV1[]>;
  acknowledge(input: { readonly deliveryId: string; readonly workerId: string; readonly claimVersion: number; readonly at: string }): Promise<void>;
  release(input: { readonly deliveryId: string; readonly workerId: string; readonly claimVersion: number; readonly at: string; readonly nextAttemptAt: string }): Promise<void>;
}

export interface IdentityRevocationDeliveryPortV1 {
  deliver(record: IdentityExternalRevocationV1): Promise<void>;
}

export interface PersonDeletionAuthorizationPortV1<H> {
  assertAllowed(command: PersonDeletionCommandV2, tx: IdentityTransactionV1<H>): Promise<void>;
}

export interface PersonDeletionPlanePortV2<H> {
  readonly step: Exclude<RevocationStepKind, 'login_sessions' | 'tenant_memberships' | 'account'>;
  readonly placement: 'present' | 'absent';
  apply(command: PersonDeletionCommandV2, plan: BusinessDeletionPlanV1, tx: IdentityTransactionV1<H>): Promise<readonly IdentityExternalRevocationDraftV1[]>;
  assertDeliveryInScope(command: PersonDeletionCommandV2, plan: BusinessDeletionPlanV1, draft: IdentityExternalRevocationDraftV1, tx: IdentityTransactionV1<H>): Promise<void>;
  assertAbsent(command: PersonDeletionCommandV2, plan: BusinessDeletionPlanV1, tx: IdentityTransactionV1<H>): Promise<void>;
}

export type AtomicRevocationDetailV2 = 'local_effects_committed' | 'external_delivery_pending' | 'external_delivery_complete'
  | 'required_local_step_failed' | 'transaction_rolled_back' | 'not_attempted_after_failure' | 'plane_absent';
