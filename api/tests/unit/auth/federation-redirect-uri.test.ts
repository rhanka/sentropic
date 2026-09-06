import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BR-39e go-live regression — federation default redirect URI must carry the `/api/v1` API mount
 * prefix (N4-adjacent guard, sibling of `federation-route-cookies.test.ts`).
 *
 * The Cluster Mesh `/auth` module projects this adapter at `/api/v1/auth/federation`, so the
 * callback route is served at
 * `/api/v1/auth/federation/<provider>/callback`. `resolveOAuthIssuer` returns a BARE origin, so the
 * default redirect URI (used whenever the provider-specific `*_OAUTH_REDIRECT_URI` env is unset) MUST
 * append that full mount prefix itself — a bare `/auth/federation/...` default hits the SPA instead
 * of the API, silently breaking federation in production when ops does not set the override.
 *
 * This test drives the REAL `federationRouter` (mirroring `federation-route-cookies.test.ts`) and
 * captures the `defaultRedirectUri` handed to `resolveFederationProvider`, so a future re-mount of the
 * federation router under a renamed prefix breaks this
 * test rather than production.
 */

const { brokerMock, createFederationBrokerMock, resolveFederationProviderMock } = vi.hoisted(() => ({
  brokerMock: { start: vi.fn() },
  createFederationBrokerMock: vi.fn(),
  resolveFederationProviderMock: vi.fn((providerId: string) => ({
    createAuthorizationUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    id: providerId,
    verifyCallback: async () => ({ email: null, emailVerified: false, subject: 's' }),
  })),
}));

vi.mock('../../../src/services/auth/federation/broker', () => ({
  createFederationBroker: createFederationBrokerMock,
}));

vi.mock('../../../src/services/auth/federation/registry', () => ({
  isFederationProviderSupported: () => true,
  resolveFederationProvider: resolveFederationProviderMock,
}));

// `resolveOAuthIssuer` normally returns the BARE origin (env.OAUTH_ISSUER_URL trimmed, or the request
// origin) — stubbed to a fixed value here since ITS correctness is covered elsewhere; this test
// isolates the router's OWN composition of that issuer with the federation callback path.
vi.mock('../../../src/routes/auth/oauth', () => ({
  getSentropicOAuthPorts: () => ({
    accountPolicy: {},
    auditLog: {},
    clock: {},
    federation: {},
    users: {},
  }),
  resolveOAuthIssuer: () => 'https://idp.example',
  resolveOAuthUiBaseUrl: () => 'https://ui.example',
}));

vi.mock('../../../src/services/workspace-service', () => ({
  ensureWorkspaceForUser: vi.fn(async () => undefined),
}));

vi.mock('@sentropic/auth-hono', () => ({
  createAuthSessionService: () => ({ createSession: vi.fn() }),
}));

vi.mock('../../../src/services/session-manager', () => ({
  validateSession: vi.fn(async () => ({ role: 'user', sessionId: 'session-1', userId: 'user-1' })),
}));

const { createFederationRouter } = await import('../../../src/routes/namespaces/auth/federation');
const federationRouter = createFederationRouter('/api/v1/oauth/authorize');

// The path at which the factory router is mounted by the Cluster Mesh `/auth` module. Kept as a
// literal so this
// test independently encodes the expectation rather than re-deriving it from the same source.
const MOUNTED_FEDERATION_PATH = '/api/v1/auth/federation';

describe('federation default redirect URI carries the /api/v1 API mount prefix (go-live regression)', () => {
  beforeEach(() => {
    createFederationBrokerMock.mockReset().mockReturnValue(brokerMock);
    resolveFederationProviderMock.mockClear();
    brokerMock.start.mockResolvedValue({
      expiresAt: new Date(Date.now() + 600 * 1000),
      flowStateId: 'flow-pointer-abc',
      kind: 'redirect',
      location: 'https://accounts.google.com/o/oauth2/v2/auth?state=s',
    });
  });

  it('login /start: default redirect URI equals <issuer>/api/v1/auth/federation/<provider>/callback', async () => {
    const res = await federationRouter.request('/google/start');
    expect(res.status).toBe(302);

    expect(resolveFederationProviderMock).toHaveBeenCalledWith(
      'google',
      { defaultRedirectUri: 'https://idp.example/api/v1/auth/federation/google/callback' },
    );
  });

  it('manual-link /link/start: default redirect URI equals <issuer>/api/v1/auth/federation/<provider>/callback', async () => {
    const res = await federationRouter.request('/github/link/start', {
      headers: { cookie: 'session=sess-token-xyz' },
    });
    expect(res.status).toBe(302);

    expect(resolveFederationProviderMock).toHaveBeenCalledWith(
      'github',
      { defaultRedirectUri: 'https://idp.example/api/v1/auth/federation/github/callback' },
    );
  });

  it('the default redirect URI PATH matches the path federationRouter is actually mounted at', async () => {
    await federationRouter.request('/google/start');

    const [, { defaultRedirectUri }] = resolveFederationProviderMock.mock.calls[0] as [
      string,
      { defaultRedirectUri: string },
    ];
    const path = new URL(defaultRedirectUri).pathname;
    expect(path.startsWith(`${MOUNTED_FEDERATION_PATH}/`)).toBe(true);
    expect(path).toBe(`${MOUNTED_FEDERATION_PATH}/google/callback`);
  });

  it('binds the upstream continuation to each host OAuth projection', async () => {
    await createFederationRouter('/api/v1/oauth/authorize').request('/google/start');
    await createFederationRouter('/api/v1/auth/oauth/authorize').request('/google/start');

    expect(createFederationBrokerMock.mock.calls.map(([input]) => input.config.authorizeUrl)).toEqual([
      'https://idp.example/api/v1/oauth/authorize',
      'https://idp.example/api/v1/auth/oauth/authorize',
    ]);
  });
});
