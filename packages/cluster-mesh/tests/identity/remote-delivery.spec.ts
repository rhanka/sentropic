// A2.0b remote revocation delivery ledger on both profiles: exclusive
// claim/ack, release, at-least-once redelivery, crash recovery and the
// end-to-end acknowledge path with connector custody erase.

import { describe, expect, it } from 'vitest';
import type { IdentityExternalRevocationV1, IdentityUnitOfWorkV1 } from '../../src/index.js';
import { acknowledgeIdentityRevocationV1, createNodeConnectorCustody, createConnectorRevocationCustodyPortV1 } from '../../src/index.js';
import { asOpHost, LATER, NOW, openPostgresEnv, openSqliteEnv, pgEnabled } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';
import { boundIdentitySql } from '../../src/storage/identity/custody-transaction-ports.js';

const WRITE = { mode: 'write' as const, purpose: 'request' as const, maxAttempts: 3 as const, deadlineMs: 5000 };
const READ = { mode: 'read' as const, purpose: 'request' as const, maxAttempts: 3 as const, deadlineMs: 8000 };

interface ProfileEnv {
  readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost>;
  readonly schema: string | null;
}

const delivery = (id: string, targetKind: IdentityExternalRevocationV1['targetKind'] = 'login_session', targetRef = 'reader-1'): IdentityExternalRevocationV1 => ({
  deliveryId: id, operationId: 'op-1', step: 'remote_reader_sessions', subjectId: 'marie', targetKind, targetRef,
  state: 'pending', createdAt: NOW, nextAttemptAt: NOW, custodyRef: null, deliveredAt: null, claimOwner: null, claimVersion: 0, leaseUntil: null, attemptCount: 0,
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


  it('captures the selected source owner and rolls custody back with source deletion', async () => {
    const env = await openEnv();
    const sql = (tx: import('../../src/index.js').IdentityTransactionV1<CustodyOpHost>) => boundIdentitySql(tx.hostTransaction);
    await env.unitOfWork.run(WRITE, async (tx) => {
      const db = sql(tx);
      await db.query(`CREATE TABLE ${db.table('fixture_connector_source')} (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL)`, []);
      await db.query(`INSERT INTO ${db.table('fixture_connector_source')} VALUES (?, ?, ?)`, ['connector-other', 'other-owner', 'deleted-workspace']);
    });
    const custody = createNodeConnectorCustody({ masterKey: new Uint8Array(32).fill(7) });
    const port = createConnectorRevocationCustodyPortV1({ custody, readSource: async (id, tx) => {
      const db = sql(tx), rows = await db.query(`SELECT * FROM ${db.table('fixture_connector_source')} WHERE id = ?`, [id]);
      const row = rows[0];
      return row ? { userId: String(row.user_id), workspaceId: String(row.workspace_id), provider: 'drive', capability: { tokenKind: 'refresh', token: 'fixture-only' } } : null;
    } });
    const capture = { operationId: 'delete-user', deliveryId: 'selected-owner-delivery', connectorAccountId: 'connector-other', subjectId: 'other-owner', at: NOW };
    await expect(env.unitOfWork.run(WRITE, (tx) => port.capture({ ...capture, subjectId: 'marie' }, tx)))
      .rejects.toMatchObject({ code: 'identity_revocation_custody_invalid' });
    let record: IdentityExternalRevocationV1;
    await expect(env.unitOfWork.run(WRITE, async (tx) => {
      const captured = await port.capture(capture, tx);
      if (captured.kind !== 'captured') throw new Error('Expected source capability');
      record = { ...delivery(capture.deliveryId, 'connector_grant', capture.connectorAccountId), operationId: capture.operationId,
        step: 'connector_grants', subjectId: 'other-owner', custodyRef: captured.reference.custodyRef };
      await tx.revocationOutbox.enqueue(record);
      await port.assertCaptured(record, tx);
      const db = sql(tx);
      await db.query(`DELETE FROM ${db.table('fixture_connector_source')} WHERE id = ?`, [capture.connectorAccountId]);
      throw new Error('rollback capture and source deletion');
    })).rejects.toThrow('rollback capture and source deletion');
    await env.unitOfWork.run(READ, async (tx) => {
      const db = sql(tx);
      expect(await db.query(`SELECT user_id FROM ${db.table('fixture_connector_source')} WHERE id = ?`, [capture.connectorAccountId])).toEqual([{ user_id: 'other-owner' }]);
      expect(await tx.revocationOutbox.find(capture.deliveryId)).toBeNull();
      await expect(port.assertCaptured(record!, tx)).rejects.toMatchObject({ code: 'identity_revocation_custody_missing' });
    });
    custody.dispose();
  });
  it('claims exclusively, releases and redelivers at least once', async () => {
    const env = await openEnv();
    await env.unitOfWork.run(WRITE, async (tx) => {
      await tx.hostTransaction.journal.enqueueDelivery(delivery('d1'));
      // The outbox tuple (operation_id, step, target_kind, target_ref) is UNIQUE
      // per the amendment, so the second delivery needs its own target.
      await tx.hostTransaction.journal.enqueueDelivery(delivery('d2', 'login_session', 'reader-2'));
    });
    const first = await env.unitOfWork.run(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-a', LATER, 10));
    expect(first.map((entry) => entry.deliveryId)).toEqual(['d1', 'd2']);
    const second = await env.unitOfWork.run(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-b', LATER, 10));
    expect(second).toHaveLength(0);
    // Superseded claims refuse.
    await expect(env.unitOfWork.run(WRITE, (tx) =>
      tx.hostTransaction.journal.acknowledgeDelivery('d1', 'worker-b', first[0].claimVersion, NOW),
    )).rejects.toMatchObject({ code: 'identity_delivery_claim_conflict' });
    await env.unitOfWork.run(WRITE, (tx) =>
      tx.hostTransaction.journal.acknowledgeDelivery('d1', 'worker-a', first[0].claimVersion, NOW));
    await env.unitOfWork.run(WRITE, (tx) =>
      tx.hostTransaction.journal.releaseClaim('d2', 'worker-a', first[1].claimVersion, NOW));
    const redelivered = await env.unitOfWork.run(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-b', LATER, 10));
    expect(redelivered.map((entry) => entry.deliveryId)).toEqual(['d2']);
  });

  it('recovers claims after a crash once the lease expires', async () => {
    const env = await openEnv();
    await env.unitOfWork.run(WRITE, (tx) => tx.hostTransaction.journal.enqueueDelivery(delivery('d-crash')));
    const claimed = await env.unitOfWork.run(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-a', '2026-11-01T12:01:00.000Z', 10));
    expect(claimed).toHaveLength(1);
    // Lease still held: no redelivery yet.
    expect(await env.unitOfWork.run(WRITE, (tx) => tx.hostTransaction.journal.claimPending('2026-11-01T12:00:30.000Z', 'worker-b', LATER, 10))).toHaveLength(0);
    // After expiry a new owner claims with a bumped version.
    const recovered = await env.unitOfWork.run(WRITE, (tx) => tx.hostTransaction.journal.claimPending('2026-11-01T12:02:00.000Z', 'worker-b', LATER, 10));
    expect(recovered).toHaveLength(1);
    expect(recovered[0].claimVersion).toBeGreaterThan(claimed[0].claimVersion);
  });

  it('acknowledges connector deliveries and erases custody in one transaction', async () => {
    const env = await openEnv();
    const masterKey = new Uint8Array(32).fill(3);
    const custody = createNodeConnectorCustody({ masterKey, disposeMasterCopy: true });
    expect(masterKey.every((byte) => byte === 0)).toBe(true);
    const port = createConnectorRevocationCustodyPortV1({ custody, readSource: async () => { throw new Error('not used by ack'); } });
    let grant: IdentityExternalRevocationV1 = { ...delivery('d-grant', 'connector_grant', 'conn-77'), subjectId: 'marie' };
    await env.unitOfWork.run(WRITE, async (tx) => {
      const raw = {
        profile, schema: env.schema ?? '',
        session: profile === 'postgres' ? (tx.hostTransaction.raw as never) : null,
        connection: profile === 'sqlite' ? (tx.hostTransaction.raw as never) : null,
      } as never;
      const captured = await custody.captureCapability({ deliveryId: 'd-grant', connectorAccountId: 'conn-77', provider: 'drive', at: NOW }, raw, { tokenKind: 'refresh', token: 'refresh-secret' });
      expect(captured.kind).toBe('captured');
      if (captured.kind !== 'captured') throw new Error('missing capability');
      grant = { ...grant, custodyRef: captured.reference.custodyRef };
      await tx.revocationOutbox.enqueue(grant);
      await custody.assertCaptured(grant, raw);
    });
    const claimed = await env.unitOfWork.run(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-a', LATER, 10));
    const claim = claimed.find((entry) => entry.deliveryId === 'd-grant');
    expect(claim).toBeDefined();
    const erase = custody.eraseAcknowledged.bind(custody);
    custody.eraseAcknowledged = async (record, raw) => {
      expect(record.state).toBe('delivered');
      await erase(record, raw);
    };
    await env.unitOfWork.run(WRITE, (tx) =>
      acknowledgeIdentityRevocationV1({
        tx,
        claim: { record: claim!, workerId: 'worker-a', claimVersion: claim!.claimVersion },
        at: NOW,
        connectorCustody: port,
      }));
    await env.unitOfWork.run(WRITE, (tx) => acknowledgeIdentityRevocationV1({
      tx,
      claim: { record: claim!, workerId: 'worker-a', claimVersion: claim!.claimVersion },
      at: LATER, connectorCustody: port,
    }));
    await env.unitOfWork.run(READ, async (tx) => {
      expect(await tx.hostTransaction.journal.findDelivery('d-grant')).toMatchObject({ state: 'delivered', deliveredAt: NOW });
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
    await env.unitOfWork.run(WRITE, async (tx) => {
      await tx.hostTransaction.journal.enqueueDelivery(delivery('d-grant-2', 'connector_grant', 'conn-78'));
      await tx.hostTransaction.journal.enqueueDelivery(delivery('d-plain'));
    });
    const claimed = await env.unitOfWork.run(WRITE, (tx) => tx.hostTransaction.journal.claimPending(NOW, 'worker-a', LATER, 10));
    const grant = claimed.find((entry) => entry.deliveryId === 'd-grant-2');
    const plain = claimed.find((entry) => entry.deliveryId === 'd-plain');
    const emptyCustody = createNodeConnectorCustody({ masterKey: new Uint8Array(32).fill(5) });
    const emptyPort = createConnectorRevocationCustodyPortV1({ custody: emptyCustody, readSource: async () => null });
    await expect(env.unitOfWork.run(WRITE, (tx) => acknowledgeIdentityRevocationV1({
      tx,
      claim: { record: grant!, workerId: 'worker-a', claimVersion: grant!.claimVersion },
      at: NOW, connectorCustody: emptyPort,
    }))).rejects.toMatchObject({ code: 'identity_revocation_custody_missing' });
    emptyCustody.dispose();
    expect(await env.unitOfWork.run(READ, (tx) => tx.hostTransaction.journal.findDelivery('d-grant-2')))
      .toMatchObject({ state: 'pending' });
    await expect(env.unitOfWork.run(WRITE, (tx) =>
      acknowledgeIdentityRevocationV1({
        tx,
        claim: { record: grant!, workerId: 'worker-a', claimVersion: grant!.claimVersion },
        at: NOW,
        connectorCustody: null,
      }),
    )).rejects.toMatchObject({ code: 'identity_revocation_custody_missing' });
    await env.unitOfWork.run(WRITE, (tx) =>
      acknowledgeIdentityRevocationV1({
        tx,
        claim: { record: plain!, workerId: 'worker-a', claimVersion: plain!.claimVersion },
        at: NOW,
        connectorCustody: null,
      }));
    expect(await env.unitOfWork.run(READ, (tx) => tx.hostTransaction.journal.findDelivery('d-plain'))).toMatchObject({ state: 'delivered' });
  });
});
