import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { coworkDeviceLeases, coworkDevices } from '../../src/db/schema';
import { listIssuedLeases } from '../../src/services/cowork/device-lease-service';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { seedCoworkDevice } from '../utils/cowork-device';

type IssuedLease = { lease: { leaseId: string; nonce: string; deviceId: string } };

describe('Cowork device authorization leases', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });
  afterEach(cleanupAuthData);

  async function issue(deviceId: string, turnRef: string) {
    const response = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/leases', user.sessionToken!, {
      device_id: deviceId, turn_ref: turnRef, scope: { capability: 'screen_capture' },
    });
    return { response, payload: await response.json() as IssuedLease };
  }

  async function acknowledge(deviceId: string, leaseId: string, nonce: string, signPayload: (payload: string) => string) {
    return authenticatedRequest(app, 'POST', `/api/v1/chrome-extension/cowork-devices/leases/${leaseId}/ack`, user.sessionToken!, {
      device_id: deviceId,
      signature: signPayload(`cowork-lease-ack-v1:${leaseId}.${nonce}`),
    });
  }

  it('fails closed when a device is missing, stale, disconnected, or revoked', async () => {
    expect((await issue(crypto.randomUUID(), 'missing')).response.status).toBe(403);
    const stale = await seedCoworkDevice({
      userId: user.id, presence: 'active', lastSeenAt: new Date(Date.now() - 46_000),
    });
    expect((await issue(stale.deviceId, 'stale')).response.status).toBe(403);
    const disconnected = await seedCoworkDevice({ userId: user.id, presence: 'disconnected' });
    expect((await issue(disconnected.deviceId, 'disconnected')).response.status).toBe(403);
    const revoked = await seedCoworkDevice({ userId: user.id, status: 'revoked', presence: 'none' });
    expect((await issue(revoked.deviceId, 'revoked')).response.status).toBe(403);
  });

  it('uses a durable idempotent queue and survives a fresh DB-backed read', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const first = await issue(device.deviceId, 'turn-durable');
    const second = await issue(device.deviceId, 'turn-durable');
    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(201);
    expect(second.payload.lease.leaseId).toBe(first.payload.lease.leaseId);

    const rows = await db.select().from(coworkDeviceLeases).where(eq(coworkDeviceLeases.id, first.payload.lease.leaseId));
    expect(rows).toHaveLength(1);
    const reopenedRead = await listIssuedLeases(user.id, device.deviceId);
    expect(reopenedRead?.map((row) => row.id)).toContain(first.payload.lease.leaseId);
  });

  it('rejects cross-device, expired, replayed, and revoked acknowledgements', async () => {
    const target = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const sibling = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const issued = await issue(target.deviceId, 'turn-ack');
    const lease = issued.payload.lease;
    const crossDevice = await acknowledge(sibling.deviceId, lease.leaseId, lease.nonce, sibling.signPayload);
    expect(crossDevice.status).toBe(404);

    await db.update(coworkDeviceLeases).set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(coworkDeviceLeases.id, lease.leaseId));
    expect((await acknowledge(target.deviceId, lease.leaseId, lease.nonce, target.signPayload)).status).toBe(409);

    const fresh = await issue(target.deviceId, 'turn-replay');
    const freshLease = fresh.payload.lease;
    expect((await acknowledge(target.deviceId, freshLease.leaseId, freshLease.nonce, target.signPayload)).status).toBe(200);
    expect((await acknowledge(target.deviceId, freshLease.leaseId, freshLease.nonce, target.signPayload)).status).toBe(409);

    const afterRevoke = await issue(target.deviceId, 'turn-revoked');
    await db.update(coworkDevices).set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(coworkDevices.id, target.deviceId));
    expect((await acknowledge(target.deviceId, afterRevoke.payload.lease.leaseId, afterRevoke.payload.lease.nonce, target.signPayload)).status).toBe(409);
  });

  it('returns only the target device queue through the bounded poll fallback', async () => {
    const first = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const second = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const firstLease = await issue(first.deviceId, 'turn-first');
    const secondLease = await issue(second.deviceId, 'turn-second');
    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chrome-extension/cowork-devices/${first.deviceId}/leases?limit=20`,
      user.sessionToken!,
    );
    expect(response.status).toBe(200);
    const payload = await response.json() as { leases: Array<{ leaseId: string }> };
    expect(payload.leases.map((lease) => lease.leaseId)).toEqual([firstLease.payload.lease.leaseId]);
    expect(payload.leases.map((lease) => lease.leaseId)).not.toContain(secondLease.payload.lease.leaseId);
  });
});
