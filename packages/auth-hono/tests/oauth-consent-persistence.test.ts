import { describe, expect, it } from 'vitest';

import {
  authorizePath,
  createMemoryConsentStore,
  createOauthPorts,
  createOauthRouterForTest,
} from './__fixtures__/oauth-fixtures.js';

const SCOPE = 'openid profile email';
const USER_ID = 'user-1';
const CLIENT_ID = 'example-rp';

describe('OAuth consent persistence (skip re-consent for covered grants)', () => {
  it('(a) covered grant + authenticated session ⇒ skips consent and issues a code directly', async () => {
    const consentStore = createMemoryConsentStore([
      { clientId: CLIENT_ID, scopes: ['openid', 'profile', 'email'], userId: USER_ID },
    ]);
    const { ports, store } = await createOauthPorts({ authenticated: true, consentStore });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath({ nonce: 'nonce-1' }));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    // Redirect goes straight to the RP callback (NOT the consent screen).
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/callback');
    expect(location.searchParams.get('state')).toBe('rp-state');
    const code = location.searchParams.get('code') ?? '';
    expect(code).toBeTruthy();
    await expect(store.consumeAuthCode(code)).resolves.toMatchObject({
      clientId: CLIENT_ID,
      codeChallenge: 'pkce-challenge',
      nonce: 'nonce-1',
      scope: SCOPE,
      userId: USER_ID,
    });
  });

  it('(b) requested scope NOT in stored grant ⇒ consent re-shown (scope-escalation invariant)', async () => {
    // Stored grant lacks `email`; the requested set is a strict superset ⇒ must re-consent.
    const consentStore = createMemoryConsentStore([
      { clientId: CLIENT_ID, scopes: ['openid', 'profile'], userId: USER_ID },
    ]);
    const { ports } = await createOauthPorts({ authenticated: true, consentStore });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath());

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
    expect(location.searchParams.get('code')).toBeNull();
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('(c) prompt=consent with a fully covering grant ⇒ ALWAYS re-shows consent', async () => {
    const consentStore = createMemoryConsentStore([
      { clientId: CLIENT_ID, scopes: ['openid', 'profile', 'email'], userId: USER_ID },
    ]);
    const { ports } = await createOauthPorts({ authenticated: true, consentStore });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath({ prompt: 'consent' }));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('(d) no consentStore wired ⇒ always consent (backward-compatible legacy behavior)', async () => {
    const { ports } = await createOauthPorts({ authenticated: true });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath());

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('(e) approve persists the grant; deny does not', async () => {
    const consentStore = createMemoryConsentStore();
    const { ports } = await createOauthPorts({ authenticated: true, consentStore });
    const { router } = createOauthRouterForTest({ ports });

    // Deny first: no grant should be recorded.
    const denyAuthorize = await router.request(authorizePath());
    const denyState = new URL(denyAuthorize.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const deny = await router.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'deny', state: denyState }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(deny.status).toBe(200);
    expect(consentStore.readGrant(USER_ID, CLIENT_ID)).toBeNull();

    // Approve next: the granted scopes are persisted.
    const approveAuthorize = await router.request(authorizePath());
    const approveState = new URL(approveAuthorize.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const approve = await router.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'approve', state: approveState }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(approve.status).toBe(200);
    expect(consentStore.readGrant(USER_ID, CLIENT_ID)?.scopes.sort()).toEqual(['email', 'openid', 'profile']);
  });

  it('(f) prompt=none covered ⇒ silent code; prompt=none uncovered ⇒ consent_required', async () => {
    const covered = createMemoryConsentStore([
      { clientId: CLIENT_ID, scopes: ['openid', 'profile', 'email'], userId: USER_ID },
    ]);
    const coveredPorts = await createOauthPorts({ authenticated: true, consentStore: covered });
    const { router: coveredRouter } = createOauthRouterForTest({ ports: coveredPorts.ports });

    const silent = await coveredRouter.request(authorizePath({ prompt: 'none' }));
    expect(silent.status).toBe(302);
    const silentLocation = new URL(silent.headers.get('location') ?? '');
    expect(`${silentLocation.origin}${silentLocation.pathname}`).toBe('http://localhost:5397/callback');
    expect(silentLocation.searchParams.get('code')).toBeTruthy();
    expect(silentLocation.searchParams.get('error')).toBeNull();

    const uncovered = createMemoryConsentStore([
      { clientId: CLIENT_ID, scopes: ['openid'], userId: USER_ID },
    ]);
    const uncoveredPorts = await createOauthPorts({ authenticated: true, consentStore: uncovered });
    const { router: uncoveredRouter } = createOauthRouterForTest({ ports: uncoveredPorts.ports });

    const required = await uncoveredRouter.request(authorizePath({ prompt: 'none' }));
    expect(required.status).toBe(302);
    const requiredLocation = new URL(required.headers.get('location') ?? '');
    expect(`${requiredLocation.origin}${requiredLocation.pathname}`).toBe('http://localhost:5397/callback');
    expect(requiredLocation.searchParams.get('error')).toBe('consent_required');
    expect(requiredLocation.searchParams.get('code')).toBeNull();
  });

  it('grant for a DIFFERENT client never satisfies coverage (per-(user,client) binding)', async () => {
    const consentStore = createMemoryConsentStore([
      { clientId: 'other-rp', scopes: ['openid', 'profile', 'email'], userId: USER_ID },
    ]);
    const { ports } = await createOauthPorts({ authenticated: true, consentStore });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath());

    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
    expect(location.searchParams.get('code')).toBeNull();
  });
});
