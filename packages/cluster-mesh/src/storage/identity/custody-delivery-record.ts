import type { IdentityExternalRevocationV1 } from '../../identity-contracts/custody.js';

export const decodeRevocationDelivery = (row: Record<string, unknown>): IdentityExternalRevocationV1 => ({
  deliveryId: String(row['delivery_id']), operationId: String(row['operation_id']),
  step: row['step'] as IdentityExternalRevocationV1['step'], subjectId: String(row['subject_id']),
  targetKind: row['target_kind'] as IdentityExternalRevocationV1['targetKind'], targetRef: String(row['target_ref']),
  custodyRef: row['custody_ref'] as string | null, state: row['state'] as IdentityExternalRevocationV1['state'],
  createdAt: String(row['created_at']), nextAttemptAt: String(row['next_attempt_at']),
  deliveredAt: row['delivered_at'] as string | null, claimOwner: row['claim_owner'] as string | null,
  leaseUntil: row['lease_until'] as string | null, claimVersion: Number(row['claim_version']), attemptCount: Number(row['attempt_count']),
});

export const sameRevocationTarget = (a: IdentityExternalRevocationV1, b: IdentityExternalRevocationV1): boolean =>
  ['deliveryId', 'operationId', 'step', 'subjectId', 'targetKind', 'targetRef', 'custodyRef'].every(
    (key) => a[key as keyof IdentityExternalRevocationV1] === b[key as keyof IdentityExternalRevocationV1],
  );
