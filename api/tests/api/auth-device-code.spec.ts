import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/app';
import { validateSession } from '../../src/services/session-manager';
import { clearAll as clearDeviceCodes } from '../../src/services/device-code-store';
import {
  authenticatedRequest,
  unauthenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

/**
 * Device-code enrollment flow (RFC 8628-style) for the headless Cowork binary.
 *
 * code -> (authenticated) approve -> poll -> token pair via session-manager.
 */
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

  async function issueCode(deviceName?: string) {
    const response = await unauthenticatedRequest(
      app,
      'POST',
      '/api/v1/auth/device/code',
      deviceName ? { deviceName } : undefined,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      interval: number;
      expires_in: number;
    };
  }

  it('issues a device code with the expected shape (no auth required)', async () => {
    const payload = await issueCode('My Workstation');

    expect(typeof payload.device_code).toBe('string');
    expect(payload.device_code.length).toBeGreaterThan(10);
    expect(payload.user_code).toMatch(/^PAIR-[A-Z2-9]{4}$/);
    expect(payload.verification_uri).toContain('/auth/devices/pair');
    expect(payload.interval).toBeGreaterThan(0);
    expect(payload.expires_in).toBe(600);
  });

  it('has no second device-code path outside the root projection', async () => {
    const response = await unauthenticatedRequest(app, 'POST', '/api/v1/session/device/code');
    expect(response.status).toBe(404);
  });

  it('returns authorization_pending before approval', async () => {
    const { device_code } = await issueCode();

    const pollResponse = await unauthenticatedRequest(
      app,
      'POST',
      '/api/v1/auth/device/poll',
      { device_code },
    );
    expect(pollResponse.status).toBe(200);
    await expect(pollResponse.json()).resolves.toEqual({ status: 'authorization_pending' });
  });

  it('returns slow_down when polled faster than the interval', async () => {
    const { device_code } = await issueCode();

    const first = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code,
    });
    await expect(first.json()).resolves.toEqual({ status: 'authorization_pending' });

    // Immediate second poll is throttled.
    const second = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code,
    });
    await expect(second.json()).resolves.toEqual({ status: 'slow_down' });
  });

  it('returns expired for an unknown/consumed device code', async () => {
    const pollResponse = await unauthenticatedRequest(
      app,
      'POST',
      '/api/v1/auth/device/poll',
      { device_code: 'does-not-exist' },
    );
    expect(pollResponse.status).toBe(200);
    await expect(pollResponse.json()).resolves.toEqual({ status: 'expired' });
  });

  it('rejects unauthenticated approve', async () => {
    const { user_code } = await issueCode();

    const approveResponse = await unauthenticatedRequest(
      app,
      'POST',
      '/api/v1/auth/device/approve',
      { user_code, device_name: 'Hacker box' },
    );
    expect(approveResponse.status).toBe(401);
  });

  it('rejects approve for an unknown user_code', async () => {
    const approveResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/auth/device/approve',
      user.sessionToken!,
      { user_code: 'PAIR-ZZZZ' },
    );
    expect(approveResponse.status).toBe(404);
  });

  it('approve links the code to the user; subsequent poll returns a valid token pair', async () => {
    const { device_code, user_code } = await issueCode('Original Name');

    const approveResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/auth/device/approve',
      user.sessionToken!,
      { user_code, device_name: 'Approved Name' },
    );
    expect(approveResponse.status).toBe(200);
    await expect(approveResponse.json()).resolves.toEqual({ success: true });

    const pollResponse = await unauthenticatedRequest(
      app,
      'POST',
      '/api/v1/auth/device/poll',
      { device_code },
    );
    expect(pollResponse.status).toBe(200);
    const pollPayload = (await pollResponse.json()) as {
      status: string;
      sessionToken: string;
      refreshToken: string;
      expiresAt: string;
      user: { id: string; role: string };
    };

    expect(pollPayload.status).toBe('approved');
    expect(typeof pollPayload.sessionToken).toBe('string');
    expect(typeof pollPayload.refreshToken).toBe('string');
    expect(pollPayload.user.id).toBe(user.id);

    // The minted session token must validate to the same user.
    const validated = await validateSession(pollPayload.sessionToken);
    expect(validated).not.toBeNull();
    expect(validated?.userId).toBe(user.id);
  });

  it('is single-use: a second poll after approval delivery returns expired', async () => {
    const { device_code, user_code } = await issueCode();

    await authenticatedRequest(
      app,
      'POST',
      '/api/v1/auth/device/approve',
      user.sessionToken!,
      { user_code },
    );

    const firstPoll = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code,
    });
    await expect(firstPoll.json()).resolves.toMatchObject({ status: 'approved' });

    const secondPoll = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code,
    });
    await expect(secondPoll.json()).resolves.toEqual({ status: 'expired' });
  });

  it('rejects a second approve of an already-approved code', async () => {
    const { user_code } = await issueCode();

    const first = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/auth/device/approve',
      user.sessionToken!,
      { user_code },
    );
    expect(first.status).toBe(200);

    const second = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/auth/device/approve',
      user.sessionToken!,
      { user_code },
    );
    expect(second.status).toBe(409);
  });
});
