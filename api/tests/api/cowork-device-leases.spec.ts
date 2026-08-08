import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { coworkDeviceLeases, coworkDevicePresence, coworkDevices } from '../../src/db/schema';
import { coworkResultDigest, issueLease, listIssuedLeases } from '../../src/services/cowork/device-lease-service';
import { deleteCoworkDeviceWithLeaseRevocation } from '../../src/services/cowork/device-registry';
import { coworkDeliveryProofPayload } from '../../src/services/cowork/device-identity';
import { grantCoworkWorkspaceExposure } from '../../src/services/cowork/provisioning';
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
    await Promise.all(['screen_capture', 'input_action'].map((capability) => grantCoworkWorkspaceExposure({
      deviceId, workspaceId: user.workspaceId, capability: capability as 'screen_capture' | 'input_action', grantedBy: user.id,
    })));
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

  async function complete(deviceId: string, leaseId: string, nonce: string, outcome: 'FAIT' | 'PAS-FAIT', signPayload: (payload: string) => string, result?: Record<string, unknown>) {
    return authenticatedRequest(app, 'POST', `/api/v1/chrome-extension/cowork-devices/leases/${leaseId}/result`, user.sessionToken!, {
      device_id: deviceId,
      outcome,
      ...(result ? { result } : {}),
      signature: signPayload(`cowork-lease-result-v1:${leaseId}.${nonce}.${outcome}.${coworkResultDigest(result)}`),
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

  it('requires a pre-existing exact workspace/capability exposure before selection or issuance', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const selectedWithoutGrant = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/selection', user.sessionToken!, {
      session_id: TEST_COWORK_SESSION, workspace_id: user.workspaceId, device_id: device.deviceId,
    });
    expect(selectedWithoutGrant.status).toBe(403);
    await grantCoworkWorkspaceExposure({
      deviceId: device.deviceId, workspaceId: user.workspaceId, capability: 'screen_capture', grantedBy: user.id,
    });
    const selected = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/selection', user.sessionToken!, {
      session_id: TEST_COWORK_SESSION, workspace_id: user.workspaceId, device_id: device.deviceId,
    });
    expect(selected.status).toBe(200);
    const input = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/leases', user.sessionToken!, {
      device_id: device.deviceId, turn_ref: 'ungranted-input', session_id: TEST_COWORK_SESSION,
      workspace_id: user.workspaceId, scope: { capability: 'input_action', action: { action: 'click', x: 1, y: 1 } },
    });
    expect(input.status).toBe(403);
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
      workspaceId: user.workspaceId, sessionId: TEST_COWORK_SESSION,
      scope: { capability: 'screen_capture' },
    })).resolves.toMatchObject({ ok: false, reason: 'ineligible' });
    await expect(issueLease({
      userId: user.id, deviceId: unmarkedKiosk.deviceId, turnRef: 'unmarked-kiosk',
      workspaceId: user.workspaceId, sessionId: TEST_COWORK_SESSION,
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
        workspaceId: user.workspaceId, sessionId: TEST_COWORK_SESSION,
        scope: { capability: 'screen_capture' },
      })).resolves.toMatchObject({ ok: false, reason: 'not_issuable' });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('rejects narrowed or malformed screen_capture before issuance', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    for (const action of [{ screen: -3 }, { screen: 1 }, { region: { x: 0, y: 0, width: 1, height: 1 } }, { screen: 0, region: {} }]) {
      await expect(issueLease({
        userId: user.id, deviceId: device.deviceId, turnRef: `capture-${JSON.stringify(action)}`,
        workspaceId: user.workspaceId, sessionId: TEST_COWORK_SESSION,
        scope: { capability: 'screen_capture', action },
      })).resolves.toMatchObject({ ok: false, reason: 'not_issuable' });
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

  it('revokes an idempotency collision instead of aliasing a second invocation to the first FAIT', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const first = await issue(device.deviceId, 'shared-tool-call');
    expect(first.response.status).toBe(201);
    const mismatch = await issueLease({
      userId: user.id,
      deviceId: device.deviceId,
      turnRef: 'shared-tool-call',
      workspaceId: user.workspaceId,
      sessionId: 'different-session',
      scope: { capability: 'input_action', action: { action: 'click', x: 1, y: 1 } },
    });
    expect(mismatch).toEqual({ ok: false, reason: 'not_issuable' });
    await expect(db.select({ status: coworkDeviceLeases.status }).from(coworkDeviceLeases)
      .where(eq(coworkDeviceLeases.id, first.payload.lease.leaseId))).resolves.toEqual([{ status: 'revoked' }]);
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
    const capture = { ok: true, screen: 0, width: 1, height: 1, image: 'data:image/png;base64,QUJD' };
    expect((await complete(target.deviceId, success.payload.lease.leaseId, success.payload.lease.nonce, 'FAIT', target.signPayload, capture)).status).toBe(200);
    expect((await complete(target.deviceId, success.payload.lease.leaseId, success.payload.lease.nonce, 'FAIT', target.signPayload, capture)).status).toBe(409);

    const failure = await issue(target.deviceId, 'turn-result-failure');
    expect((await acknowledge(target.deviceId, failure.payload.lease.leaseId, failure.payload.lease.nonce, target.signPayload)).status).toBe(200);
    expect((await complete(target.deviceId, failure.payload.lease.leaseId, failure.payload.lease.nonce, 'PAS-FAIT', target.signPayload)).status).toBe(200);
  });

  it('refuses FAIT capture completion without action-bound dimensions and primary-screen metadata', async () => {
    const target = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const issued = await issue(target.deviceId, 'capture-result-required');
    expect((await acknowledge(target.deviceId, issued.payload.lease.leaseId, issued.payload.lease.nonce, target.signPayload)).status).toBe(200);
    expect((await complete(target.deviceId, issued.payload.lease.leaseId, issued.payload.lease.nonce, 'FAIT', target.signPayload)).status).toBe(409);
    const broad = { ok: true, screen: 1, width: 1, height: 1, image: 'data:image/png;base64,QUJD' };
    expect((await complete(target.deviceId, issued.payload.lease.leaseId, issued.payload.lease.nonce, 'FAIT', target.signPayload, broad)).status).toBe(409);
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
