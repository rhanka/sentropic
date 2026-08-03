import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { coworkDevices } from '../../src/db/schema';
import { validateSession } from '../../src/services/session-manager';
import { clearAll as clearDeviceCodes } from '../../src/services/device-code-store';
import {
  authenticatedRequest,
  unauthenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';
import { createTestCoworkKey } from '../utils/cowork-device';

describe('Device-code enrollment API', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    clearDeviceCodes();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    clearDeviceCodes();
    await cleanupAuthData();
  });

  async function issueCode(deviceName = 'My Workstation', key = createTestCoworkKey()) {
    const response = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/code', {
      deviceName,
      deviceId: key.deviceId,
      devicePublicKey: key.publicKey,
      capabilities: ['screen_capture', 'input_action'],
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      device_code: string; user_code: string; verification_uri: string; interval: number;
      expires_in: number; server_nonce: string;
    };
    return {
      key,
      ...payload,
      proof: key.signPayload(`cowork-enroll-v1:${payload.device_code}.${payload.server_nonce}`),
    };
  }

  async function approve(code: { user_code: string }, approver = user) {
    return authenticatedRequest(app, 'POST', '/api/v1/auth/device/approve', approver.sessionToken!, {
      user_code: code.user_code,
    });
  }

  it('issues an identity-bound code with a server nonce without authentication', async () => {
    const payload = await issueCode();
    expect(payload.device_code.length).toBeGreaterThan(10);
    expect(payload.user_code).toMatch(/^PAIR-[A-Z2-9]{4}$/);
    expect(payload.verification_uri).toContain('/auth/devices/pair');
    expect(payload.interval).toBeGreaterThan(0);
    expect(payload.expires_in).toBe(600);
    expect(payload.server_nonce.length).toBeGreaterThan(20);
  });

  it('returns authorization_pending before approval and slow_down for a fast retry', async () => {
    const code = await issueCode();
    const first = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code: code.device_code, proof: code.proof,
    });
    await expect(first.json()).resolves.toEqual({ status: 'authorization_pending' });
    const second = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code: code.device_code, proof: code.proof,
    });
    await expect(second.json()).resolves.toEqual({ status: 'slow_down' });
  });

  it('requires proof after human approval and never commits a device without it', async () => {
    const code = await issueCode();
    expect((await approve(code)).status).toBe(200);
    const poll = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code: code.device_code, proof: 'invalid-proof',
    });
    await expect(poll.json()).resolves.toEqual({ status: 'proof_required' });
    const rows = await db.select().from(coworkDevices).where(eq(coworkDevices.id, code.key.deviceId));
    expect(rows).toHaveLength(0);
  });

  it('mints a session only after approval and valid proof, then commits the active device', async () => {
    const code = await issueCode('Original Name');
    expect((await approve(code)).status).toBe(200);
    const poll = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code: code.device_code, proof: code.proof,
    });
    expect(poll.status).toBe(200);
    const payload = await poll.json() as { status: string; sessionToken: string; refreshToken: string; user: { id: string } };
    expect(payload.status).toBe('approved');
    expect(payload.refreshToken).toBeTruthy();
    expect((await validateSession(payload.sessionToken))?.userId).toBe(user.id);
    await expect(db.select().from(coworkDevices).where(eq(coworkDevices.id, code.key.deviceId))).resolves.toMatchObject([
      { userId: user.id, publicKey: code.key.publicKey, status: 'active' },
    ]);
  });

  it('is single-use after a successful proof-bound approval', async () => {
    const code = await issueCode();
    await approve(code);
    const first = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code: code.device_code, proof: code.proof,
    });
    expect((await first.json() as { status: string }).status).toBe('approved');
    const second = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code: code.device_code, proof: code.proof,
    });
    await expect(second.json()).resolves.toEqual({ status: 'expired' });
  });

  it('rejects a cross-user collision and a changed or revoked device identity', async () => {
    const first = await issueCode();
    await approve(first);
    await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code: first.device_code, proof: first.proof,
    });
    const other = await createAuthenticatedUser('editor');
    const collision = await issueCode('Other', first.key);
    await approve(collision, other);
    const collisionPoll = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code: collision.device_code, proof: collision.proof,
    });
    expect(collisionPoll.status).toBe(409);

    await db.update(coworkDevices).set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(coworkDevices.id, first.key.deviceId));
    const revoked = await issueCode('Revoked', first.key);
    await approve(revoked);
    const revokedPoll = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code: revoked.device_code, proof: revoked.proof,
    });
    expect(revokedPoll.status).toBe(409);
  });
});
