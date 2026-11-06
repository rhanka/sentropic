import { randomUUID } from 'node:crypto';
import { acknowledgeIdentityRevocationV1, IdentityCustodyErrorV1,
  type IdentityRevocationClaimV1 } from '@sentropic/cluster-mesh';
import { logger } from '../../logger';
import { createAppConnectorCustody } from './cm-connector-custody';
import { cmIdentityUnitOfWork } from './cm-transaction';
import { deliverCmRevocation } from './cm-revocation-delivery';
import { RemoteAuthorityError } from '../auth/remote-contract';

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

/** Lifecycle responses acknowledge issuer fencing only after durable delivery. */
export const deliverCmSubjectRevocations = async (userId: string): Promise<void> => {
  const claims = await cmIdentityUnitOfWork.run(options, async tx => {
    const now = new Date(), owner = randomUUID();
    // Fence this subject's issuer authority; connector delivery remains on the worker.
    const rows = await tx.hostTransaction.query<{ delivery_id: string }>(`
      UPDATE cm_identity.identity_revocation_outbox
      SET claim_owner = $2, lease_until = $3, claim_version = claim_version + 1, attempt_count = attempt_count + 1
      WHERE delivery_id IN (SELECT delivery_id FROM cm_identity.identity_revocation_outbox
        WHERE subject_id = $1 AND step = 'remote_reader_sessions' AND state = 'pending' AND next_attempt_at <= $4
          AND (lease_until IS NULL OR lease_until <= $4) FOR UPDATE SKIP LOCKED)
      RETURNING delivery_id`, [userId, owner, new Date(now.getTime() + 30_000).toISOString(), now.toISOString()]);
    const claimed: IdentityRevocationClaimV1[] = [];
    for (const row of rows.rows) {
      const record = await tx.revocationOutbox.find(row.delivery_id);
      if (!record) throw new IdentityCustodyErrorV1('identity_delivery_claim_conflict');
      claimed.push({ record, workerId: owner, claimVersion: record.claimVersion });
    }
    return claimed;
  });
  for (const claim of claims) await deliverClaim(claim);
  const pending = await cmIdentityUnitOfWork.run({ ...options, mode: 'read' }, async tx =>
    (await tx.hostTransaction.query(`SELECT 1 FROM cm_identity.identity_revocation_outbox
      WHERE subject_id = $1 AND step = 'remote_reader_sessions' AND state = 'pending' LIMIT 1`, [userId])).rows.length !== 0);
  if (pending) throw new RemoteAuthorityError('authority_unavailable');
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
