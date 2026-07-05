import { describe, expect, it } from 'vitest';

import {
  authorizePath,
  createMemoryConsentStore,
  createOauthPorts,
  createOauthRouterForTest,
} from './__fixtures__/oauth-fixtures.js';

const CLIENT_ID = 'example-rp';
const RP_CALLBACK = 'http://localhost:5397/callback';

// BR-39r — the prod-regression guard. A real user clicking Approve/Deny submits a NATIVE
// form (x-www-form-urlencoded, Accept: text/html). The consent decision handler must then
// emit a server 302 to the RP redirect_uri so the final navigation does NOT depend on JS.
// The legacy JSON fetch path (Accept: application/json -> 200 + {redirectTo}) MUST keep
// working for programmatic hosts (backward-compat).
describe('OAuth consent decision — native-form 302 (BR-39r) vs JSON 200 (legacy)', () => {
  const sealedStateFor = async (
    router: ReturnType<typeof createOauthRouterForTest>['router'],
    query: Record<string, string> = {}
  ): Promise<string> => {
    const authorize = await router.request(authorizePath(query));
    const location = new URL(authorize.headers.get('location') ?? '');
    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();
    return state!;
  };

  it('(form/approve) x-www-form-urlencoded + Accept:text/html ⇒ 302 to RP with code + state', async () => {
    const consentStore = createMemoryConsentStore();
    const { ports } = await createOauthPorts({ authenticated: true, consentStore });
    const { router } = createOauthRouterForTest({ ports });
    const state = await sealedStateFor(router);

    const response = await router.request('/oauth/consent/decision', {
      body: new URLSearchParams({ decision: 'approve', state }).toString(),
      headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(RP_CALLBACK);
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('state')).toBe('rp-state');
    expect(location.searchParams.get('error')).toBeNull();
    // Approve through the form path still records the grant.
    expect(consentStore.readGrant('user-1', CLIENT_ID)?.scopes.sort()).toEqual([
      'email',
      'openid',
      'profile',
    ]);
  });

  it('(form/deny) x-www-form-urlencoded + Accept:text/html ⇒ 302 to RP with error=access_denied + state', async () => {
    const consentStore = createMemoryConsentStore();
    const { ports } = await createOauthPorts({ authenticated: true, consentStore });
    const { router } = createOauthRouterForTest({ ports });
    const state = await sealedStateFor(router);

    const response = await router.request('/oauth/consent/decision', {
      body: new URLSearchParams({ decision: 'deny', state }).toString(),
      headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(RP_CALLBACK);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('rp-state');
    expect(location.searchParams.get('code')).toBeNull();
    // A deny never records a grant.
    expect(consentStore.readGrant('user-1', CLIENT_ID)).toBeNull();
  });

  it('(json/approve REGRESSION GUARD) Accept:application/json ⇒ 200 + {redirectTo} (backward-compat)', async () => {
    const consentStore = createMemoryConsentStore();
    const { ports } = await createOauthPorts({ authenticated: true, consentStore });
    const { router } = createOauthRouterForTest({ ports });
    const state = await sealedStateFor(router);

    const response = await router.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'approve', state }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { redirectTo?: string };
    const redirectTo = new URL(payload.redirectTo ?? '');
    expect(`${redirectTo.origin}${redirectTo.pathname}`).toBe(RP_CALLBACK);
    expect(redirectTo.searchParams.get('code')).toBeTruthy();
    expect(redirectTo.searchParams.get('state')).toBe('rp-state');
  });

  it('(json/deny REGRESSION GUARD) Accept:application/json ⇒ 200 + {redirectTo} carrying error=access_denied', async () => {
    const consentStore = createMemoryConsentStore();
    const { ports } = await createOauthPorts({ authenticated: true, consentStore });
    const { router } = createOauthRouterForTest({ ports });
    const state = await sealedStateFor(router);

    const response = await router.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'deny', state }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { redirectTo?: string };
    const redirectTo = new URL(payload.redirectTo ?? '');
    expect(`${redirectTo.origin}${redirectTo.pathname}`).toBe(RP_CALLBACK);
    expect(redirectTo.searchParams.get('error')).toBe('access_denied');
    expect(redirectTo.searchParams.get('state')).toBe('rp-state');
  });

  it('(form/invalid) missing decision in form body ⇒ 400 invalid_request', async () => {
    const { ports } = await createOauthPorts({ authenticated: true, consentStore: createMemoryConsentStore() });
    const { router } = createOauthRouterForTest({ ports });
    const state = await sealedStateFor(router);

    const response = await router.request('/oauth/consent/decision', {
      body: new URLSearchParams({ state }).toString(),
      headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
  });
});
