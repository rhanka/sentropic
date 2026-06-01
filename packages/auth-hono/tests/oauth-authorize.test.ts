import { describe, expect, it } from 'vitest';

import {
  authorizePath,
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
} from './__fixtures__/oauth-fixtures.js';

describe('OAuth authorize and consent handlers', () => {
  it('redirects unauthenticated browser authorization to login with a sealed continuation', async () => {
    const { ports } = await createOauthPorts();
    const { router, stateCodec } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath({ nonce: 'nonce-1' }));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/login');
    const continuation = location.searchParams.get('continue');
    expect(continuation).toMatch(/^[^.]+\.[^.]+$/);
    const payload = await stateCodec.unseal(continuation ?? '');
    expect(payload).toMatchObject({
      clientId: 'example-rp',
      codeChallenge: 'pkce-challenge',
      nonce: 'nonce-1',
      redirectUri: 'http://localhost:5397/callback',
      scope: 'openid profile email',
      state: 'rp-state',
    });
  });

  it('redirects prompt=none without a session back to the RP with login_required', async () => {
    const { ports } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath({ prompt: 'none' }));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/callback');
    expect(location.searchParams.get('error')).toBe('login_required');
    expect(location.searchParams.get('state')).toBe('rp-state');
  });

  it('redirects authenticated browser authorization to consent with sealed state', async () => {
    const { ports } = await createOauthPorts({ authenticated: true });
    const { router, stateCodec } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath({ nonce: 'nonce-1' }));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
    const sealedState = location.searchParams.get('state');
    const payload = await stateCodec.unseal(sealedState ?? '');
    expect(payload).toMatchObject({
      acr: 'urn:sentropic:loa:passkey-fresh',
      authTime: '2026-01-01T00:00:00.000Z',
      clientId: 'example-rp',
      userId: 'user-1',
    });
  });

  it('returns consent details and approves into an authorization-code redirect URL', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true });
    const { router } = createOauthRouterForTest({ ports });
    const authorize = await router.request(authorizePath({ nonce: 'nonce-1' }));
    const sealedState = new URL(authorize.headers.get('location') ?? '').searchParams.get('state') ?? '';

    const details = await router.request(`/oauth/consent?state=${encodeURIComponent(sealedState)}`);
    expect(details.status).toBe(200);
    await expect(details.json()).resolves.toEqual({
      clientName: 'Example RP',
      redirectUri: 'http://localhost:5397/callback',
      scopes: ['openid', 'profile', 'email'],
    });

    const decision = await router.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'approve', state: sealedState }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(decision.status).toBe(200);
    const body = (await decision.json()) as { redirectTo: string };
    const redirect = new URL(body.redirectTo);
    expect(`${redirect.origin}${redirect.pathname}`).toBe('http://localhost:5397/callback');
    expect(redirect.searchParams.get('state')).toBe('rp-state');
    const code = redirect.searchParams.get('code') ?? '';
    await expect(store.consumeAuthCode(code)).resolves.toMatchObject({
      clientId: 'example-rp',
      codeChallenge: 'pkce-challenge',
      nonce: 'nonce-1',
      userId: 'user-1',
    });
  });

  it('denies consent into an access_denied redirect URL', async () => {
    const { ports } = await createOauthPorts({ authenticated: true });
    const { router } = createOauthRouterForTest({ ports });
    const authorize = await router.request(authorizePath());
    const sealedState = new URL(authorize.headers.get('location') ?? '').searchParams.get('state') ?? '';

    const decision = await router.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'deny', state: sealedState }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(decision.status).toBe(200);
    const body = (await decision.json()) as { redirectTo: string };
    const redirect = new URL(body.redirectTo);
    expect(redirect.searchParams.get('error')).toBe('access_denied');
    expect(redirect.searchParams.get('state')).toBe('rp-state');
  });

  it('rejects unknown clients, unsafe redirect URIs, plaintext PKCE, and invalid scopes', async () => {
    const { ports } = await createOauthPorts({
      clients: [
        createOauthClient({
          allowedScopes: ['openid'],
          redirectUris: [
            'http://localhost:5397/callback',
            'https://rp.example.com/callback',
          ],
        }),
      ],
    });
    const { router } = createOauthRouterForTest({ ports });

    expect((await router.request(authorizePath({ client_id: 'missing-rp' }))).status).toBe(400);
    expect((await router.request(authorizePath({ redirect_uri: 'https://rp.example.com/callback#frag' }))).status).toBe(400);
    expect((await router.request(authorizePath({ redirect_uri: 'http://rp.example.com/callback' }))).status).toBe(400);
    expect((await router.request(authorizePath({ code_challenge_method: 'plain' }))).status).toBe(302);

    const invalidScope = await router.request(authorizePath({ scope: 'openid admin' }));
    const location = new URL(invalidScope.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('invalid_scope');
    expect(location.searchParams.get('state')).toBe('rp-state');
  });
});
