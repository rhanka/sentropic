import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FederationProviderIdentity } from '../../../src/services/auth/federation/types';

/**
 * BR-39e Lot 1 — Google OIDC provider `verifyCallback` guards, tested as a pure unit.
 *
 * `arctic` (code→token exchange) and `jose` (id_token verify) are mocked so the test drives ONLY the
 * provider's own checks. Keystone under test:
 *  - K-NONCE (mandatory): the OIDC nonce is enforced ALWAYS. The broker binds a nonce at every start,
 *    so a MISSING expected nonce is itself an anti-replay failure — not just a value mismatch. A
 *    missing OR mismatched nonce must abort; only an exact match yields the verified identity.
 */

const { jwtVerifyMock } = vi.hoisted(() => ({ jwtVerifyMock: vi.fn() }));

vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: jwtVerifyMock,
}));

vi.mock('arctic', () => ({
  Google: class {
    createAuthorizationURL(): URL {
      return new URL('https://accounts.google.com/o/oauth2/v2/auth');
    }
    async validateAuthorizationCode(): Promise<{ idToken: () => string }> {
      return { idToken: () => 'header.payload.signature' };
    }
  },
}));

const { createGoogleProvider } = await import('../../../src/services/auth/federation/google-provider');

const provider = createGoogleProvider({
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://app.test/auth/federation/google/callback',
});

const verifiedPayload = (nonce: string) => ({
  payload: { email: 'user@example.com', email_verified: true, nonce, sub: 'google-sub-1' },
});

describe('createGoogleProvider.verifyCallback — mandatory OIDC nonce', () => {
  beforeEach(() => {
    jwtVerifyMock.mockReset();
  });

  it('K-NONCE: rejects when the expected nonce is ABSENT even if the id_token carries one', async () => {
    // The id_token has a nonce, but the broker passed no expected nonce. Pre-fix this SILENTLY passed
    // (the check was gated on `typeof nonce === 'string'`); it must now reject.
    jwtVerifyMock.mockResolvedValue(verifiedPayload('some-server-nonce'));

    await expect(
      provider.verifyCallback({ code: 'auth-code', codeVerifier: 'verifier', nonce: null }),
    ).rejects.toThrow(/nonce/i);
  });

  it('K-NONCE: rejects when the expected nonce MISMATCHES the id_token nonce', async () => {
    jwtVerifyMock.mockResolvedValue(verifiedPayload('server-nonce'));

    await expect(
      provider.verifyCallback({ code: 'auth-code', codeVerifier: 'verifier', nonce: 'client-nonce' }),
    ).rejects.toThrow(/nonce/i);
  });

  it('K-NONCE: returns the verified identity when the nonce MATCHES exactly', async () => {
    jwtVerifyMock.mockResolvedValue(verifiedPayload('bound-nonce'));

    const identity: FederationProviderIdentity = await provider.verifyCallback({
      code: 'auth-code',
      codeVerifier: 'verifier',
      nonce: 'bound-nonce',
    });

    expect(identity).toEqual({ email: 'user@example.com', emailVerified: true, subject: 'google-sub-1' });
  });
});
