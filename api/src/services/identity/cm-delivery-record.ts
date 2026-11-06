import { createHash } from 'node:crypto';
import type { IdentityExternalRevocationDraftV1, IdentityExternalRevocationV1 } from '@sentropic/cluster-mesh';

export const identityOperationId = (tuple: readonly unknown[]): string =>
  createHash('sha256').update(JSON.stringify(tuple)).digest('hex');
export const identityDeliveryId = (operationId: string, step: IdentityExternalRevocationDraftV1['step'],
  targetKind: IdentityExternalRevocationDraftV1['targetKind'], targetRef: string): string =>
  identityOperationId(['A2.0b-delivery', operationId, step, targetKind, targetRef]);
export const pendingIdentityDelivery = (operationId: string, draft: IdentityExternalRevocationDraftV1,
  at: string): IdentityExternalRevocationV1 => ({
  ...draft, operationId, deliveryId: identityDeliveryId(operationId, draft.step, draft.targetKind, draft.targetRef),
  state: 'pending', createdAt: at, deliveredAt: null, nextAttemptAt: at,
  claimOwner: null, claimVersion: 0, leaseUntil: null, attemptCount: 0,
});
