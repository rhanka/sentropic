/** Real signed assertions through the mounted CM login route and actual WebAuthn verifier. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { app } from '../../../src/app';
import { listCmSessionsForUser } from '../../../src/services/identity/cm-sessions';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';
import { createCmCredential } from '../../../src/services/identity/cm-proofs';
import { getWebAuthnConfig } from '../../../src/services/webauthn-config';
import { createSyntheticPasskey } from '../../utils/synthetic-passkey';

const loginVerify = async (user: { id: string; email: string }, userVerified: boolean): Promise<Response> => {
  const config = getWebAuthnConfig(), origin = typeof config.origin === 'string' ? config.origin : config.origin[0];
  const fixture = createSyntheticPasskey(config.rpID, origin, user.id);
  await createCmCredential({ userId: user.id, credentialId: fixture.credentialId,
    publicKey: fixture.publicKey.toString('base64url'), counter: 0, rpId: config.rpID, now: new Date() });
  const options = await app.request('/api/v1/auth/login/options', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email }),
  });
  expect(options.status).toBe(200);
  const { options: { challenge } } = await options.json();
  return app.request('/api/v1/auth/login/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credential: fixture.assertion(challenge, userVerified),
      deviceName: 'Test Device',
    }),
  });
};

const readMfaFlag = async (userId: string): Promise<boolean | null> => {
  const [row] = await listCmSessionsForUser(userId);
  return row?.mfaVerified ?? null;
};

describe('POST /api/v1/auth/login/verify mints the MFA session flag (B1)', () => {
  beforeEach(() => {
    vi.stubEnv('CM_IDENTITY_EMAIL_CODE_POLICY', 'sha256');
    vi.stubEnv('CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF', 'synthetic-test-only');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupAuthData();
  });

  it('mints mfa_verified=true after a passkey ceremony with user verification', async () => {
    const user = await createTestUser({ displayName: 'UV User', withWorkspace: false, email: `uv-${crypto.randomUUID()}@example.com` });

    const res = await loginVerify(user, true);

    expect(res.status).toBe(200);
    await expect(readMfaFlag(user.id)).resolves.toBe(true);
  });

  it('refuses a UV-less passkey under the inherited required-UV policy and creates no session', async () => {
    const user = await createTestUser({ displayName: 'No UV User', withWorkspace: false, email: `nouv-${crypto.randomUUID()}@example.com` });

    const res = await loginVerify(user, false);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.headers.get('set-cookie')).toBeNull();
    await expect(readMfaFlag(user.id)).resolves.toBeNull();
  });
});
