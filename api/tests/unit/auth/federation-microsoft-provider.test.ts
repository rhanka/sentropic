import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAuthorizationURL: vi.fn(),
  jwtVerify: vi.fn(),
  validateAuthorizationCode: vi.fn(),
}));

vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: mocks.jwtVerify,
}));

vi.mock('arctic', () => ({
  MicrosoftEntraId: class {
    createAuthorizationURL(
      state: string,
      codeVerifier: string,
      scopes: string[]
    ): URL {
      mocks.createAuthorizationURL(state, codeVerifier, scopes);
      const url = new URL(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
      );
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeVerifier);
      return url;
    }
    async validateAuthorizationCode(code: string, codeVerifier: string) {
      mocks.validateAuthorizationCode(code, codeVerifier);
      return { idToken: () => 'SECRET.microsoft.id-token' };
    }
  },
}));

const { createMicrosoftProvider } =
  await import('../../../src/services/auth/federation/microsoft-provider');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const issuer = (tid: string) => `https://login.microsoftonline.com/${tid}/v2.0`;
const payload = (overrides: Record<string, unknown> = {}) => ({
  email: 'user@example.com',
  iss: issuer(TENANT_A),
  nonce: 'bound-nonce',
  oid: 'oid-a',
  sub: 'per-app-sub',
  tid: TENANT_A,
  ...overrides,
});

const provider = (tenant = 'common') =>
  createMicrosoftProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://app.test/auth/federation/microsoft/callback',
    tenant,
  });

const verify = (tenant = 'common', nonce: string | null = 'bound-nonce') =>
  provider(tenant).verifyCallback({
    code: 'auth-code',
    codeVerifier: 'pkce-verifier',
    nonce,
  });

describe('createMicrosoftProvider (BR-39e Lot 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jwtVerify.mockResolvedValue({ payload: payload() });
  });

  it('builds an authorization URL with state, nonce, and PKCE S256 input', () => {
    const url = new URL(
      provider().createAuthorizationUrl({
        codeVerifier: 'pkce-verifier',
        nonce: 'bound-nonce',
        state: 'csrf-state',
      }) as string
    );

    expect(mocks.createAuthorizationURL).toHaveBeenCalledWith(
      'csrf-state',
      'pkce-verifier',
      ['openid', 'profile', 'email']
    );
    expect(url.searchParams.get('nonce')).toBe('bound-nonce');
    expect(url.searchParams.get('state')).toBe('csrf-state');
  });

  it('verifies signature/audience and returns only oid+tid identity with unverified email', async () => {
    const identity = await verify();

    expect(mocks.validateAuthorizationCode).toHaveBeenCalledWith(
      'auth-code',
      'pkce-verifier'
    );
    expect(mocks.jwtVerify).toHaveBeenCalledWith(
      'SECRET.microsoft.id-token',
      expect.anything(),
      { audience: 'client-id' }
    );
    expect(identity).toEqual({
      email: 'user@example.com',
      emailVerified: false,
      providerTenant: TENANT_A,
      subject: 'oid-a',
    });
    expect(JSON.stringify(identity)).not.toContain('SECRET.microsoft.id-token');
  });

  it('rejects a bad signature and a missing or mismatched mandatory nonce', async () => {
    mocks.jwtVerify.mockRejectedValueOnce(
      new Error('signature verification failed')
    );
    await expect(verify()).rejects.toThrow(/signature/);
    await expect(verify('common', null)).rejects.toThrow(/nonce/i);
    await expect(verify('common', 'wrong-nonce')).rejects.toThrow(/nonce/i);
  });

  it('K-MS-SUBJECT: same per-app sub across tenants derives distinct oid subjects and tenant bindings', async () => {
    mocks.jwtVerify
      .mockResolvedValueOnce({
        payload: payload({ oid: 'oid-a', tid: TENANT_A }),
      })
      .mockResolvedValueOnce({
        payload: payload({
          iss: issuer(TENANT_B),
          oid: 'oid-b',
          tid: TENANT_B,
        }),
      });

    const first = await verify();
    const second = await verify();

    expect(first.subject).toBe('oid-a');
    expect(second.subject).toBe('oid-b');
    expect(
      new Set([`microsoft:${first.subject}`, `microsoft:${second.subject}`])
        .size
    ).toBe(2);
    expect([first.providerTenant, second.providerTenant]).toEqual([
      TENANT_A,
      TENANT_B,
    ]);
  });
});
