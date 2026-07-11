import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BR-39e Lot 1 — federation route COOKIE-FLAGS guard (N4).
 *
 * A route-level test that drives the real `federationRouter` handlers so a future edit that flips a
 * cookie attribute fails CI. The broker + registry + ports are stubbed so the test exercises ONLY the
 * HTTP/cookie transport (`routes/auth/federation.ts`), asserting the Set-Cookie attributes on:
 *  - the flow-state cookie set by `/:provider/start`, and
 *  - the fresh session cookie set by `/:provider/callback` (authenticated),
 * for httpOnly, sameSite=Lax, path, maxAge, and `secure` toggled by production mode.
 */

const { brokerMock } = vi.hoisted(() => ({
  brokerMock: { callback: vi.fn(), start: vi.fn() },
}));

vi.mock('../../../src/services/auth/federation/broker', () => ({
  createFederationBroker: () => brokerMock,
}));

vi.mock('../../../src/services/auth/federation/registry', () => ({
  isFederationProviderSupported: () => true,
  resolveFederationProvider: (providerId: string) => ({
    createAuthorizationUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    id: providerId,
    verifyCallback: async () => ({ email: null, emailVerified: false, subject: 's' }),
  }),
}));

vi.mock('../../../src/routes/auth/oauth', () => ({
  getSentropicOAuthPorts: () => ({
    accountPolicy: {},
    auditLog: {},
    clock: {},
    federation: {},
    users: {},
  }),
  resolveOAuthIssuer: () => 'https://issuer.test',
  resolveOAuthUiBaseUrl: () => 'https://ui.test',
}));

vi.mock('../../../src/services/workspace-service', () => ({
  ensureWorkspaceForUser: vi.fn(async () => undefined),
}));

vi.mock('@sentropic/auth-hono', () => ({
  createAuthSessionService: () => ({ createSession: vi.fn() }),
}));

const { federationRouter, parseFederationCallback } = await import('../../../src/routes/auth/federation');

interface ParsedCookie {
  name: string;
  value: string;
  flags: Record<string, string | true>;
}

const parseCookie = (raw: string): ParsedCookie => {
  const [pair, ...attrs] = raw.split(';').map((part) => part.trim());
  const eq = pair.indexOf('=');
  const flags: Record<string, string | true> = {};
  for (const attr of attrs) {
    const i = attr.indexOf('=');
    if (i === -1) flags[attr.toLowerCase()] = true;
    else flags[attr.slice(0, i).toLowerCase()] = attr.slice(i + 1);
  }
  return { flags, name: pair.slice(0, eq), value: pair.slice(eq + 1) };
};

const findSetCookie = (res: Response, name: string): ParsedCookie => {
  const all = res.headers.getSetCookie();
  const raw = all.find((cookie) => cookie.startsWith(`${name}=`));
  if (!raw) throw new Error(`no Set-Cookie for "${name}"; got: ${all.join(' || ')}`);
  return parseCookie(raw);
};

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe('federation route Set-Cookie flags (BR-39e Lot 1, N4)', () => {
  beforeEach(() => {
    brokerMock.start.mockResolvedValue({
      expiresAt: new Date(Date.now() + 600 * 1000),
      flowStateId: 'flow-pointer-abc',
      kind: 'redirect',
      location: 'https://accounts.google.com/o/oauth2/v2/auth?state=s',
    });
    brokerMock.callback.mockResolvedValue({
      kind: 'authenticated',
      location: 'https://ui.test/',
      session: {
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        refreshToken: 'refresh-abc',
        sessionId: 'session-1',
        sessionToken: 'sess-token-xyz',
      },
    });
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    vi.clearAllMocks();
  });

  it('flow-state cookie from /start is HttpOnly, SameSite=Lax, scoped, TTL-bound (non-prod: no Secure)', async () => {
    process.env.NODE_ENV = 'development';
    const res = await federationRouter.request('/google/start');
    expect(res.status).toBe(302);

    const cookie = findSetCookie(res, 'sentropic_fed_flow');
    expect(cookie.value).toBe('flow-pointer-abc');
    expect(cookie.flags.httponly).toBe(true);
    expect(cookie.flags.samesite).toBe('Lax');
    expect(cookie.flags.path).toBe('/auth/federation');
    expect(cookie.flags['max-age']).toBe('600');
    expect(cookie.flags.secure).toBeUndefined();
  });

  it('flow-state cookie from /start is Secure in production mode', async () => {
    process.env.NODE_ENV = 'production';
    const res = await federationRouter.request('/google/start');

    const cookie = findSetCookie(res, 'sentropic_fed_flow');
    expect(cookie.flags.secure).toBe(true);
    expect(cookie.flags.httponly).toBe(true);
    expect(cookie.flags.samesite).toBe('Lax');
    expect(cookie.flags.path).toBe('/auth/federation');
  });

  it('session cookie from /callback is HttpOnly, SameSite=Lax, root-scoped, TTL-bound (non-prod: no Secure)', async () => {
    process.env.NODE_ENV = 'development';
    const res = await federationRouter.request('/google/callback?code=auth-code&state=s');
    expect(res.status).toBe(302);

    const cookie = findSetCookie(res, 'session');
    expect(cookie.value).toBe('sess-token-xyz');
    expect(cookie.flags.httponly).toBe(true);
    expect(cookie.flags.samesite).toBe('Lax');
    expect(cookie.flags.path).toBe('/');
    expect(cookie.flags['max-age']).toBe(String(7 * 24 * 60 * 60));
    expect(cookie.flags.secure).toBeUndefined();
  });

  it('session cookie from /callback is Secure in production mode', async () => {
    process.env.NODE_ENV = 'production';
    const res = await federationRouter.request('/google/callback?code=auth-code&state=s');

    const cookie = findSetCookie(res, 'session');
    expect(cookie.flags.secure).toBe(true);
    expect(cookie.flags.httponly).toBe(true);
    expect(cookie.flags.samesite).toBe('Lax');
    expect(cookie.flags.path).toBe('/');
  });

  it('K-APPLE-FORMPOST: parses state, code, and first-auth profile only from the POST body', async () => {
    const parseBody = vi.fn(async () => ({
      code: 'apple-code',
      state: 'apple-state',
      user: JSON.stringify({
        email: 'ada@privaterelay.appleid.com',
        name: { firstName: 'Ada', lastName: 'Lovelace' },
      }),
    }));
    const parsed = await parseFederationCallback('apple', {
      method: 'POST',
      parseBody,
      query: () => undefined,
    });

    expect(parseBody).toHaveBeenCalledOnce();
    expect(parsed).toEqual({
      code: 'apple-code',
      error: null,
      profile: { displayName: 'Ada Lovelace', email: 'ada@privaterelay.appleid.com' },
      state: 'apple-state',
    });
  });

  it('K-APPLE-FORMPOST: ignores Apple callback parameters supplied only in a GET query', async () => {
    const parseBody = vi.fn(async () => ({}));
    const parsed = await parseFederationCallback('apple', {
      method: 'GET',
      parseBody,
      query: (name) => ({ code: 'query-code', state: 'query-state', user: '{}' })[name],
    });

    expect(parsed).toEqual({ code: null, error: null, profile: null, state: null });
    expect(parseBody).not.toHaveBeenCalled();
  });

  it('K-APPLE-FORMPOST: POST callback consumes the bound flow cookie and forwards body parameters', async () => {
    process.env.NODE_ENV = 'development';
    const body = new URLSearchParams({
      code: 'apple-code',
      state: 'apple-state',
      user: JSON.stringify({ email: 'ada@example.com', name: { firstName: 'Ada', lastName: 'Lovelace' } }),
    });
    const res = await federationRouter.request('/apple/callback', {
      body,
      headers: { cookie: 'sentropic_fed_flow=flow-pointer-apple' },
      method: 'POST',
    });

    expect(res.status).toBe(302);
    expect(brokerMock.callback).toHaveBeenCalledWith(expect.objectContaining({
      code: 'apple-code',
      flowStateId: 'flow-pointer-apple',
      profile: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
      state: 'apple-state',
    }));
    expect(findSetCookie(res, 'sentropic_fed_flow').flags['max-age']).toBe('0');
  });
});
