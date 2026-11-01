/**
 * passkey-mfa-session.test.ts — B1 API coverage (F6).
 *
 * Drives POST /api/v1/auth/login/verify through the real route + finalize +
 * session-manager stack with only the cryptographic step stubbed
 * (vi.mock of the adapter service), and asserts the minted DB session carries
 * mfa_verified=true for a UV ceremony and false without UV.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('../../../src/services/auth/webauthn-adapter', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/services/auth/webauthn-adapter')>();
  return {
    ...original,
    authHonoWebAuthnAuthenticationService: {
      ...original.authHonoWebAuthnAuthenticationService,
      verifyAuthentication: async () => {
        const verdict = (globalThis as { __passkeyVerdict?: { userVerified: boolean } }).__passkeyVerdict
          ?? { userVerified: true };
        return {
          credentialId: 'mock-credential-id',
          userId: (globalThis as { __passkeyUserId?: string }).__passkeyUserId ?? 'missing-user',
          userVerified: verdict.userVerified,
          verified: true,
        };
      },
    },
  };
});

import { app } from '../../../src/app';
import { listCmSessionsForUser } from '../../../src/services/identity/cm-sessions';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

const setVerdict = (userId: string, userVerified: boolean): void => {
  (globalThis as { __passkeyUserId?: string }).__passkeyUserId = userId;
  (globalThis as { __passkeyVerdict?: { userVerified: boolean } }).__passkeyVerdict = { userVerified };
};

const toBase64Url = (value: string): string =>
  Buffer.from(value, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');

const loginVerify = (): Promise<Response> =>
  app.request('/api/v1/auth/login/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credential: {
        id: 'mock-credential-id',
        rawId: 'mock-credential-id',
        response: {
          authenticatorData: toBase64Url('authenticator-data'),
          clientDataJSON: toBase64Url(JSON.stringify({
            challenge: 'test-challenge',
            origin: 'http://localhost:9197',
            type: 'webauthn.get',
          })),
          signature: toBase64Url('signature'),
        },
        type: 'public-key',
      },
      deviceName: 'Test Device',
    }),
  });

const readMfaFlag = async (userId: string): Promise<boolean | null> => {
  const [row] = await listCmSessionsForUser(userId);
  return row?.mfaVerified ?? null;
};

describe('POST /api/v1/auth/login/verify mints the MFA session flag (B1)', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  it('mints mfa_verified=true after a passkey ceremony with user verification', async () => {
    const user = await createTestUser({ displayName: 'UV User', email: `uv-${crypto.randomUUID()}@example.com` });
    setVerdict(user.id, true);

    const res = await loginVerify();

    expect(res.status).toBe(200);
    await expect(readMfaFlag(user.id)).resolves.toBe(true);
  });

  it('mints mfa_verified=false after a passkey ceremony without user verification', async () => {
    const user = await createTestUser({ displayName: 'No UV User', email: `nouv-${crypto.randomUUID()}@example.com` });
    setVerdict(user.id, false);

    const res = await loginVerify();

    expect(res.status).toBe(200);
    await expect(readMfaFlag(user.id)).resolves.toBe(false);
  });
});
