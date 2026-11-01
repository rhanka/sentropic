// A2.0b remote revocation delivery ledger on both profiles: exclusive
// claim/ack, release, at-least-once redelivery, crash recovery and the
// end-to-end acknowledge path with connector custody erase.

import { describe, expect, it } from 'vitest';
import type { IdentityExternalRevocationV1, IdentityUnitOfWorkV1 } from '../../src/index.js';
import { acknowledgeIdentityRevocationV1, createNodeConnectorCustody } from '../../src/index.js';
import { asOpHost, LATER, NOW, openPostgresEnv, openSqliteEnv, pgEnabled } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';

const WRITE = { mode: 'write' as const, deadlineMs: 5000 };
const READ = { mode: 'read' as const, deadlineMs: 8000 };

interface ProfileEnv {
  readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost>;
  readonly schema: string | null;
}

const delivery = (id: string, targetKind = 'remote_session', targetRef = 'reader-1'): IdentityExternalRevocationV1 => ({
  deliveryId: id, operationId: 'op-1', step: 'remote_reader_sessions', subjectId: 'marie', targetKind, targetRef,
  state: 'pending', createdAt: NOW, nextAttemptAt: NOW,
});

const PROFILES = (pgEnabled ? ['postgres', 'sqlite'] : ['sqlite']) as const;

describe.each(PROFILES.map((profile) => ({ profile })))('A2.0b remote revocation delivery on $profile', ({ profile }) => {
  const openEnv = async (): Promise<ProfileEnv> => {
    if (profile === 'postgres') {
      const pg = await openPostgresEnv();
      return { unitOfWork: asOpHost(pg.unitOfWork), schema: pg.schema };
    }
    return { unitOfWork: asOpHost(openSqliteEnv().unitOfWork), schema: null };
  };

  it('claims exclusively, releases and redelivers at least once', async () => {
    const env = await openEnv();
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      await tx.hostTransaction.journal.enqueueDelivery(delivery('d1'));
      await tx.hostTransaction.journal.enqueueDelivery(delivery('d2'));
    });
    const first = await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-a', LATER, 10));
    expect(first.map((entry) => entry.deliveryId)).toEqual(['d1', 'd2']);
    const second = await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-b', LATER, 10));
    expect(second).toHaveLength(0);
    // Superseded claims refuse.
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.journal.acknowledgeDelivery('d1', 'worker-b', first[0].claimVersion, NOW),
    )).rejects.toMatchObject({ code: 'identity_delivery_claim_conflict' });
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.journal.acknowledgeDelivery('d1', 'worker-a', first[0].claimVersion, NOW));
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.journal.releaseClaim('d2', 'worker-a', first[1].claimVersion, NOW));
    const redelivered = await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-b', LATER, 10));
    expect(redelivered.map((entry) => entry.deliveryId)).toEqual(['d2']);
  });

  it('recovers claims after a crash once the lease expires', async () => {
    const env = await openEnv();
    await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.journal.enqueueDelivery(delivery('d-crash')));
    const claimed = await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-a', '2026-11-01T12:01:00.000Z', 10));
    expect(claimed).toHaveLength(1);
    // Lease still held: no redelivery yet.
    expect(await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.journal.claimPending('2026-11-01T12:00:30.000Z', 'worker-b', LATER, 10))).toHaveLength(0);
    // After expiry a new owner claims with a bumped version.
    const recovered = await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.journal.claimPending('2026-11-01T12:02:00.000Z', 'worker-b', LATER, 10));
    expect(recovered).toHaveLength(1);
    expect(recovered[0].claimVersion).toBeGreaterThan(claimed[0].claimVersion);
  });

  it('acknowledges connector deliveries and erases custody in one transaction', async () => {
    const env = await openEnv();
    const masterKey = new Uint8Array(32).fill(3);
    const custody = createNodeConnectorCustody({ masterKey, disposeMasterCopy: true });
    expect(masterKey.every((byte) => byte === 0)).toBe(true);
    const grant: IdentityExternalRevocationV1 = { ...delivery('d-grant', 'connector_grant', 'conn-77'), subjectId: 'marie' };
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      await tx.hostTransaction.journal.enqueueDelivery(grant);
      const raw = {
        profile, schema: env.schema ?? '',
        session: profile === 'postgres' ? (tx.hostTransaction.raw as never) : null,
        connection: profile === 'sqlite' ? (tx.hostTransaction.raw as never) : null,
      } as never;
      const captured = await custody.capture({ deliveryId: 'd-grant', connectorAccountId: 'conn-77', provider: 'drive', at: NOW }, raw, { tokenKind: 'refresh', token: 'refresh-secret' });
      expect(captured.kind).toBe('captured');
      await custody.assertCaptured(grant, raw);
    });
    const claimed = await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-a', LATER, 10));
    const claim = claimed.find((entry) => entry.deliveryId === 'd-grant');
    expect(claim).toBeDefined();
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      acknowledgeIdentityRevocationV1({
        host: tx.hostTransaction,
        claim: { deliveryId: 'd-grant', claimOwner: 'worker-a', claimVersion: claim!.claimVersion },
        at: NOW,
        connectorCustody: custody,
      }));
    await env.unitOfWork.runRead(READ, async (tx) => {
      expect(await tx.hostTransaction.journal.findDelivery('d-grant')).toMatchObject({ state: 'delivered' });
      const raw = {
        profile, schema: env.schema ?? '',
        session: profile === 'postgres' ? (tx.hostTransaction.raw as never) : null,
        connection: profile === 'sqlite' ? (tx.hostTransaction.raw as never) : null,
      } as never;
      // Erased on acknowledgement: reopening is impossible.
      await expect(custody.assertCaptured(grant, raw)).rejects.toMatchObject({ code: 'identity_revocation_custody_missing' });
    });
    custody.dispose();
  });

  it('refuses connector acknowledgement without custody while plain deliveries skip it', async () => {
    const env = await openEnv();
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      await tx.hostTransaction.journal.enqueueDelivery(delivery('d-grant-2', 'connector_grant', 'conn-78'));
      await tx.hostTransaction.journal.enqueueDelivery(delivery('d-plain'));
    });
    const claimed = await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-a', LATER, 10));
    const grant = claimed.find((entry) => entry.deliveryId === 'd-grant-2');
    const plain = claimed.find((entry) => entry.deliveryId === 'd-plain');
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      acknowledgeIdentityRevocationV1({
        host: tx.hostTransaction,
        claim: { deliveryId: 'd-grant-2', claimOwner: 'worker-a', claimVersion: grant!.claimVersion },
        at: NOW,
        connectorCustody: null,
      }),
    )).rejects.toMatchObject({ code: 'identity_revocation_custody_missing' });
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      acknowledgeIdentityRevocationV1({
        host: tx.hostTransaction,
        claim: { deliveryId: 'd-plain', claimOwner: 'worker-a', claimVersion: plain!.claimVersion },
        at: NOW,
        connectorCustody: null,
      }));
    expect(await env.unitOfWork.runRead(READ, (tx) => tx.hostTransaction.journal.findDelivery('d-plain'))).toMatchObject({ state: 'delivered' });
  });
});
