import { randomUUID } from 'node:crypto';
import { acknowledgeIdentityRevocationV1, IdentityCustodyErrorV1,
  type IdentityRevocationClaimV1 } from '@sentropic/cluster-mesh';
import { logger } from '../../logger';
import { createAppConnectorCustody } from './cm-connector-custody';
import { cmIdentityUnitOfWork } from './cm-transaction';
import { deliverCmRevocation } from './cm-revocation-delivery';

const workerId = randomUUID();
const options = { mode: 'write', purpose: 'delivery', deadlineMs: 5_000, maxAttempts: 3 } as const;
const custody = createAppConnectorCustody(async () => {
  throw new IdentityCustodyErrorV1('identity_transaction_unbound');
});
let running: Promise<void> | undefined;

const deliverClaim = async (claim: IdentityRevocationClaimV1): Promise<void> => {
  try {
    // No network runs under the claim/ack transaction. Both destinations revoke idempotently.
    await deliverCmRevocation(claim);
    await cmIdentityUnitOfWork.run(options, tx => acknowledgeIdentityRevocationV1({
      tx, claim, at: new Date().toISOString(), connectorCustody: custody,
    }));
  } catch {
    const at = new Date();
    const delayMs = Math.min(900_000, 1_000 * 2 ** Math.min(claim.record.attemptCount, 10));
    try {
      await cmIdentityUnitOfWork.run(options, tx => tx.revocationOutbox.release({
        deliveryId: claim.record.deliveryId, workerId: claim.workerId, claimVersion: claim.claimVersion,
        at: at.toISOString(), nextAttemptAt: new Date(at.getTime() + delayMs).toISOString(),
      }));
    } catch {
      // A stale lease is reclaimed through the same ledger after expiry.
      logger.warn({ deliveryId: claim.record.deliveryId, code: 'identity_delivery_pending' }, 'Identity delivery lease requires recovery');
    }
  }
};

/** One local drain, with global database leases providing exclusion across processes. */
export const drainCmRevocations = (): Promise<void> => {
  if (running) return running;
  running = (async () => {
    const now = new Date();
    const claims = await cmIdentityUnitOfWork.run(options, tx => tx.revocationOutbox.claimPending({
      workerId, now: now.toISOString(), leaseUntil: new Date(now.getTime() + 30_000).toISOString(), limit: 1,
    }));
    for (const claim of claims) await deliverClaim(claim);
  })().finally(() => { running = undefined; });
  return running;
};
