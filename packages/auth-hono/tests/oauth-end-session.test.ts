import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  createJwksService,
  createOAuthEndSessionHandler,
  type AuthHonoPorts,
} from '../src/index.js';
import { createJwksKeyRecord, createMemoryJwksPort } from './__fixtures__/memory-jwks.js';
import { createOauthClient, createOauthPorts, oauthNow } from './__fixtures__/oauth-fixtures.js';

const issuer = 'http://localhost:9197';

interface EndSessionHarness {
  ports: AuthHonoPorts;
  revoke: ReturnType<typeof vi.fn>;
  request(path: string, headers?: Record<string, string>): Promise<Response>;
}

const createEndSessionHarness = async (options: {
  authenticated?: boolean;
  clients?: ReturnType<typeof createOauthClient>[];
} = {}): Promise<EndSessionHarness> => {
  const { ports } = await createOauthPorts({
    authenticated: options.authenticated ?? true,
    clients: options.clients,
  });
  const revoke = vi.fn(async () => true);
  // The fixture ports only stub findByTokenHash/touch; extend with revoke for logout.
  ports.sessions = { ...ports.sessions, revoke };

  const router = new Hono();
  router.get('/oauth/end_session', createOAuthEndSessionHandler({ issuer, ports }));

  return {
    ports,
    revoke,
    request: (path, headers) => router.request(path, { headers }),
  };
};

const clearedCookies = (response: Response): string[] => response.headers.getSetCookie();

describe('OAuth end_session (RP-Initiated Logout)', () => {
  it('redirects to a registered post_logout_redirect_uri, echoes state, clears cookies, revokes', async () => {
    const client = createOauthClient({ redirectUris: ['https://rp.example.com/after-logout'] });
    const harness = await createEndSessionHarness({ clients: [client] });

    const response = await harness.request(
      `/oauth/end_session?client_id=example-rp&post_logout_redirect_uri=${encodeURIComponent(
        'https://rp.example.com/after-logout',
      )}&state=rp-state`,
      { 'sec-fetch-mode': 'navigate' },
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('https://rp.example.com/after-logout');
    expect(location.searchParams.get('state')).toBe('rp-state');
    const cookies = clearedCookies(response);
    expect(cookies.some((c) => c.startsWith('session='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
    expect(harness.revoke).toHaveBeenCalledTimes(1);
  });

  it('renders the logged-out page (no 302) when post_logout_redirect_uri is not registered', async () => {
    const harness = await createEndSessionHarness();

    const response = await harness.request(
      `/oauth/end_session?client_id=example-rp&post_logout_redirect_uri=${encodeURIComponent(
        'https://attacker.example.com/phish',
      )}`,
      { 'sec-fetch-mode': 'navigate' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('signed out');
    expect(clearedCookies(response)).not.toHaveLength(0);
  });

  it('is idempotent with no session cookie: 200 logged-out, cookies still cleared, no throw', async () => {
    const harness = await createEndSessionHarness({ authenticated: false });

    const response = await harness.request('/oauth/end_session', { 'sec-fetch-mode': 'navigate' });

    expect(response.status).toBe(200);
    expect(harness.revoke).not.toHaveBeenCalled();
    const cookies = clearedCookies(response);
    expect(cookies.some((c) => c.startsWith('session='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
  });

  it('never redirects when post_logout_redirect_uri is given without client_id and no id_token_hint', async () => {
    const harness = await createEndSessionHarness();

    const response = await harness.request(
      `/oauth/end_session?post_logout_redirect_uri=${encodeURIComponent(
        'https://rp.example.com/after-logout',
      )}`,
      { 'sec-fetch-mode': 'navigate' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('ignores an id_token_hint with a tampered signature for client resolution', async () => {
    const client = createOauthClient({ redirectUris: ['https://rp.example.com/after-logout'] });
    const harness = await createEndSessionHarness({ clients: [client] });

    // A hint signed by a DIFFERENT key (not in the IdP JWKS) must not resolve a client.
    const foreignJwks = createMemoryJwksPort([
      await createJwksKeyRecord({ active: true, kid: 'foreign-kid', now: oauthNow }),
    ]);
    const foreignHint = await createJwksService({
      clock: harness.ports.clock,
      jwksPort: foreignJwks,
    }).signJwt({ aud: 'example-rp' }, { issuer, subject: 'user-1' });

    const response = await harness.request(
      `/oauth/end_session?id_token_hint=${encodeURIComponent(
        foreignHint,
      )}&post_logout_redirect_uri=${encodeURIComponent('https://rp.example.com/after-logout')}`,
      { 'sec-fetch-mode': 'navigate' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('resolves the client from a signature-verified id_token_hint aud and redirects', async () => {
    const client = createOauthClient({ redirectUris: ['https://rp.example.com/after-logout'] });
    const harness = await createEndSessionHarness({ clients: [client] });

    const hint = await createJwksService({
      clock: harness.ports.clock,
      jwksPort: harness.ports.jwks,
    }).signJwt({ aud: 'example-rp' }, { issuer, subject: 'user-1' });

    const response = await harness.request(
      `/oauth/end_session?id_token_hint=${encodeURIComponent(
        hint,
      )}&post_logout_redirect_uri=${encodeURIComponent('https://rp.example.com/after-logout')}`,
      { 'sec-fetch-mode': 'navigate' },
    );

    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location') ?? '').origin).toBe('https://rp.example.com');
  });

  it('CSRF guard: Sec-Fetch-Mode=no-cors clears cookies but does NOT revoke', async () => {
    const harness = await createEndSessionHarness();

    const response = await harness.request('/oauth/end_session', { 'sec-fetch-mode': 'no-cors' });

    expect(response.status).toBe(200);
    expect(harness.revoke).not.toHaveBeenCalled();
    const cookies = clearedCookies(response);
    expect(cookies.some((c) => c.startsWith('session='))).toBe(true);
  });

  it('revokes when Sec-Fetch-Mode is absent (legacy/non-browser degrade-open)', async () => {
    const harness = await createEndSessionHarness();

    const response = await harness.request('/oauth/end_session');

    expect(response.status).toBe(200);
    expect(harness.revoke).toHaveBeenCalledTimes(1);
  });
});
