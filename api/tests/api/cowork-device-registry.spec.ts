import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { coworkDevicePresence, coworkDevices } from '../../src/db/schema';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { seedCoworkDevice } from '../utils/cowork-device';

describe('Cowork durable presence API', () => {
  let owner: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let other: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    owner = await createAuthenticatedUser('editor');
    other = await createAuthenticatedUser('editor');
  });
  afterEach(cleanupAuthData);

  it('registers, refreshes, and unregisters only an active device owned by the caller', async () => {
    const device = await seedCoworkDevice({ userId: owner.id, presence: 'none' });
    const register = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/tabs/register', owner.sessionToken!, {
      source: 'desktop_cowork', device_id: device.deviceId, url: 'desktop://cowork', title: 'Ignored',
    });
    await expect(register.json()).resolves.toEqual({ ok: true, tab_id: device.deviceId, device_id: device.deviceId });
    const [presence] = await db.select().from(coworkDevicePresence)
      .where(eq(coworkDevicePresence.deviceId, device.deviceId));
    expect(presence).toMatchObject({ userId: owner.id, status: 'active' });

    const keepalive = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/tabs/keepalive', owner.sessionToken!, {
      device_id: device.deviceId,
    });
    expect(keepalive.status).toBe(200);
    const unregister = await authenticatedRequest(app, 'DELETE', `/api/v1/chrome-extension/tabs/${device.deviceId}`, owner.sessionToken!);
    expect(unregister.status).toBe(200);
    await expect(db.select().from(coworkDevicePresence).where(eq(coworkDevicePresence.deviceId, device.deviceId)))
      .resolves.toMatchObject([{ status: 'disconnected' }]);
  });

  it('rejects cross-owner mutations and every mutation for a revoked device', async () => {
    const device = await seedCoworkDevice({ userId: owner.id, presence: 'active' });
    for (const request of [
      authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/tabs/register', other.sessionToken!, {
        source: 'desktop_cowork', device_id: device.deviceId,
      }),
      authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/tabs/keepalive', other.sessionToken!, {
        device_id: device.deviceId,
      }),
      authenticatedRequest(app, 'DELETE', `/api/v1/chrome-extension/tabs/${device.deviceId}`, other.sessionToken!),
    ]) {
      expect((await request).status).toBe(403);
    }

    await db.update(coworkDevices).set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(coworkDevices.id, device.deviceId));
    const revoked = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/tabs/keepalive', owner.sessionToken!, {
      device_id: device.deviceId,
    });
    expect(revoked.status).toBe(403);
  });
});
