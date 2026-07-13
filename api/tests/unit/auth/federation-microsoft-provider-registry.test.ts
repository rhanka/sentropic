import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMicrosoftProvider: vi.fn(),
  env: {
    GITHUB_OAUTH_CLIENT_ID: undefined,
    GITHUB_OAUTH_CLIENT_SECRET: undefined,
    GOOGLE_OAUTH_CLIENT_ID: undefined,
    GOOGLE_OAUTH_CLIENT_SECRET: undefined,
    MICROSOFT_OAUTH_CLIENT_ID: undefined as string | undefined,
    MICROSOFT_OAUTH_CLIENT_SECRET: undefined as string | undefined,
    MICROSOFT_OAUTH_REDIRECT_URI: undefined as string | undefined,
    MICROSOFT_OAUTH_TENANT: 'common',
  },
}));

vi.mock('../../../src/config/env', () => ({ env: mocks.env }));
vi.mock('../../../src/services/auth/federation/microsoft-provider', () => ({
  createMicrosoftProvider: mocks.createMicrosoftProvider,
}));

const { isFederationProviderSupported, resolveFederationProvider } =
  await import('../../../src/services/auth/federation/registry');

describe('Microsoft federation registry (BR-39e Lot 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.MICROSOFT_OAUTH_CLIENT_ID = undefined;
    mocks.env.MICROSOFT_OAUTH_CLIENT_SECRET = undefined;
    mocks.env.MICROSOFT_OAUTH_REDIRECT_URI = undefined;
    mocks.env.MICROSOFT_OAUTH_TENANT = 'common';
  });

  it('is supported but feature-OFF when either client credential is absent', () => {
    expect(isFederationProviderSupported('microsoft')).toBe(true);
    expect(
      resolveFederationProvider('microsoft', {
        defaultRedirectUri: 'https://issuer.test/callback',
      })
    ).toBeNull();
    expect(mocks.createMicrosoftProvider).not.toHaveBeenCalled();
  });

  it('uses configured tenant and the issuer-derived callback default', () => {
    mocks.env.MICROSOFT_OAUTH_CLIENT_ID = 'client-id';
    mocks.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'client-secret';
    mocks.env.MICROSOFT_OAUTH_TENANT = 'organizations';
    mocks.createMicrosoftProvider.mockReturnValue({ id: 'microsoft' });

    resolveFederationProvider('microsoft', {
      defaultRedirectUri:
        'https://issuer.test/auth/federation/microsoft/callback',
    });

    expect(mocks.createMicrosoftProvider).toHaveBeenCalledWith({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://issuer.test/auth/federation/microsoft/callback',
      tenant: 'organizations',
    });
  });
});
