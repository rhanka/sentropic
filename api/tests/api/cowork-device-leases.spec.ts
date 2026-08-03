import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { coworkDeviceLeases, coworkDevicePresence, coworkDevices } from '../../src/db/schema';
import { issueLease, listIssuedLeases } from '../../src/services/cowork/device-lease-service';
import { deleteCoworkDeviceWithLeaseRevocation } from '../../src/services/cowork/device-registry';
import { coworkDeliveryProofPayload } from '../../src/services/cowork/device-identity';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { seedCoworkDevice } from '../utils/cowork-device';

type IssuedLease = { lease: { leaseId: string; nonce: string; deviceId: string } };
const TEST_COWORK_SESSION = 'test-cowork-session';

describe('Cowork device authorization leases', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });
  afterEach(cleanupAuthData);

  async function issue(deviceId: string, turnRef: string) {
    await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/selection', user.sessionToken!, {
      session_id: TEST_COWORK_SESSION, workspace_id: user.workspaceId, device_id: deviceId,
    });
    const response = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/leases', user.sessionToken!, {
      device_id: deviceId, turn_ref: turnRef, session_id: TEST_COWORK_SESSION,
      workspace_id: user.workspaceId, scope: { capability: 'screen_capture' },
    });
    return { response, payload: await response.json() as IssuedLease };
  }

  async function acknowledge(deviceId: string, leaseId: string, nonce: string, signPayload: (payload: string) => string) {
    return authenticatedRequest(app, 'POST', `/api/v1/chrome-extension/cowork-devices/leases/${leaseId}/ack`, user.sessionToken!, {
      device_id: deviceId,
      signature: signPayload(`cowork-lease-ack-v1:${leaseId}.${nonce}`),
    });
  }

  async function complete(deviceId: string, leaseId: string, nonce: string, outcome: 'FAIT' | 'PAS-FAIT', signPayload: (payload: string) => string) {
    return authenticatedRequest(app, 'POST', `/api/v1/chrome-extension/cowork-devices/leases/${leaseId}/result`, user.sessionToken!, {
      device_id: deviceId,
      outcome,
      signature: signPayload(`cowork-lease-result-v1:${leaseId}.${nonce}.${outcome}`),
    });
  }

  function proofHeaders(device: { deviceId: string; signPayload: (payload: string) => string }) {
    const issuedAtMs = Date.now();
    return {
      'x-cowork-device-proof-at': String(issuedAtMs),
      'x-cowork-device-proof': device.signPayload(coworkDeliveryProofPayload({ method: 'GET', deviceId: device.deviceId, issuedAtMs })),
    };
  }

  it('requires an explicit human target selection even with one eligible device', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const response = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/leases', user.sessionToken!, {
      device_id: device.deviceId, turn_ref: 'no-selection', session_id: TEST_COWORK_SESSION,
      workspace_id: user.workspaceId, scope: { capability: 'screen_capture' },
    });
    expect(response.status).toBe(403);
  });

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

  it('refuses lease issuance unless the target is an isolated VM with a kiosk surface', async () => {
    const ordinary = await seedCoworkDevice({
      userId: user.id, presence: 'active', capabilities: {
        capabilityIds: ['screen_capture', 'input_action'], isolatedVmTarget: false,
      },
    });
    const unmarkedKiosk = await seedCoworkDevice({
      userId: user.id, presence: 'active', capabilities: {
        capabilityIds: ['screen_capture', 'input_action'], isolatedVmTarget: true,
      },
    });
    await expect(issueLease({
      userId: user.id, deviceId: ordinary.deviceId, turnRef: 'ordinary-target',
      scope: { capability: 'screen_capture' },
    })).resolves.toMatchObject({ ok: false, reason: 'ineligible' });
    await expect(issueLease({
      userId: user.id, deviceId: unmarkedKiosk.deviceId, turnRef: 'unmarked-kiosk',
      scope: { capability: 'screen_capture' },
    })).resolves.toMatchObject({ ok: false, reason: 'ineligible' });
  });

  it('refuses every target in production mode', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(issueLease({
        userId: user.id, deviceId: device.deviceId, turnRef: 'production-denied',
        scope: { capability: 'screen_capture' },
      })).resolves.toMatchObject({ ok: false, reason: 'not_issuable' });
    } finally {
      process.env.NODE_ENV = previous;
    }
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

  it('fails closed on an idempotent retry after presence becomes stale', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    expect((await issue(device.deviceId, 'turn-stale-retry')).response.status).toBe(201);
    await db.update(coworkDevicePresence).set({ lastSeenAt: new Date(Date.now() - 46_000) })
      .where(eq(coworkDevicePresence.deviceId, device.deviceId));
    expect((await issue(device.deviceId, 'turn-stale-retry')).response.status).toBe(403);
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

  it('atomically consumes or revokes one acknowledged lease from its signed bounded result', async () => {
    const target = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const success = await issue(target.deviceId, 'turn-result-success');
    expect((await acknowledge(target.deviceId, success.payload.lease.leaseId, success.payload.lease.nonce, target.signPayload)).status).toBe(200);
    expect((await complete(target.deviceId, success.payload.lease.leaseId, success.payload.lease.nonce, 'FAIT', target.signPayload)).status).toBe(200);
    expect((await complete(target.deviceId, success.payload.lease.leaseId, success.payload.lease.nonce, 'FAIT', target.signPayload)).status).toBe(409);

    const failure = await issue(target.deviceId, 'turn-result-failure');
    expect((await acknowledge(target.deviceId, failure.payload.lease.leaseId, failure.payload.lease.nonce, target.signPayload)).status).toBe(200);
    expect((await complete(target.deviceId, failure.payload.lease.leaseId, failure.payload.lease.nonce, 'PAS-FAIT', target.signPayload)).status).toBe(200);
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
      undefined,
      proofHeaders(first),
    );
    expect(response.status).toBe(200);
    const payload = await response.json() as { leases: Array<{ leaseId: string }> };
    expect(payload.leases.map((lease) => lease.leaseId)).toEqual([firstLease.payload.lease.leaseId]);
    expect(payload.leases.map((lease) => lease.leaseId)).not.toContain(secondLease.payload.lease.leaseId);
  });

  it('revokes outstanding leases before deleting a device so none survives the cascade', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    await db.insert(coworkDeviceLeases).values({
      id: crypto.randomUUID(), deviceId: device.deviceId, userId: user.id, turnRef: 'delete-turn',
      nonce: 'delete-nonce', scope: null, status: 'acknowledged', issuedAt: new Date(), expiresAt: new Date(Date.now() + 30_000),
    });

    await expect(deleteCoworkDeviceWithLeaseRevocation(user.id, device.deviceId)).resolves.toEqual({ ok: true });
    expect(await db.select().from(coworkDeviceLeases).where(eq(coworkDeviceLeases.deviceId, device.deviceId))).toEqual([]);
    expect(await db.select().from(coworkDevices).where(eq(coworkDevices.id, device.deviceId))).toEqual([]);
  });
});
