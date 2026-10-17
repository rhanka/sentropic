import { describe, expect, it } from 'vitest';

import {
  authorizePath,
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
} from './__fixtures__/oauth-fixtures.js';

const PASSKEY = 'urn:sentropic:loa:passkey-fresh';

const approve = (
  router: { request: (input: string, init?: RequestInit) => Promise<Response> },
  state: string
) =>
  router.request('/oauth/consent/decision', {
    body: JSON.stringify({ decision: 'approve', state }),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    method: 'POST',
  });

describe('OAuth consent re-checks the live session policy (F7)', () => {
  it('refuses approve when the session was swapped to bearer after consent was shown', async () => {
    const client = createOauthClient({ requiredAcr: PASSKEY });
    const { ports, store } = await createOauthPorts({
      authenticated: true,
      clients: [client],
      sessionMfaVerified: true,
    });
    const { router, stateCodec } = createOauthRouterForTest({ ports });
    const toConsent = await router.request(authorizePath());
    const state = new URL(toConsent.headers.get('location') ?? '').searchParams.get('state') ?? '';
    expect(state).toBeTruthy();

    // Cookie replaced mid-window (e.g. magic-link login in another tab).
    const { ports: bearerPorts } = await createOauthPorts({
      authenticated: true,
      clients: [client],
      sessionMfaVerified: false,
      store,
    });
    const { router: bearerRouter } = createOauthRouterForTest({ ports: bearerPorts, stateCodec });

    const response = await approve(bearerRouter, state);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'access_denied' } });
  });

  it('issues a code when the live session still satisfies the policy', async () => {
    const client = createOauthClient({ requiredAcr: PASSKEY });
    const { ports, store } = await createOauthPorts({
      authenticated: true,
      clients: [client],
      sessionMfaVerified: true,
    });
    const { router, stateCodec } = createOauthRouterForTest({ ports });
    const toConsent = await router.request(authorizePath());
    const state = new URL(toConsent.headers.get('location') ?? '').searchParams.get('state') ?? '';

    const { ports: freshPorts } = await createOauthPorts({
      authenticated: true,
      clients: [client],
      sessionId: 'session-2',
      sessionMfaVerified: true,
      store,
    });
    const { router: freshRouter } = createOauthRouterForTest({ ports: freshPorts, stateCodec });

    const response = await approve(freshRouter, state);

    expect(response.status).toBe(200);
  });

  it('refuses approve for a non-allowlisted session swapped in after consent', async () => {
    const client = createOauthClient({ allowedUserIds: ['user-1'] });
    const { ports, store } = await createOauthPorts({ authenticated: true, clients: [client] });
    const { router, stateCodec } = createOauthRouterForTest({ ports });
    const toConsent = await router.request(authorizePath());
    const state = new URL(toConsent.headers.get('location') ?? '').searchParams.get('state') ?? '';
    expect(state).toBeTruthy();

    // Same user id, but the client policy now lists them out. NOTE: a fresh
    // store is required — createOauthPorts ignores `clients` when `store` is
    // passed (the shared store keeps the original allowlisted client). Only
    // the stateCodec must be shared so the sealed consent state still unseals.
    const listedOut = createOauthClient({ allowedUserIds: ['owner-1'] });
    const { ports: swappedPorts } = await createOauthPorts({
      authenticated: true,
      clients: [listedOut],
    });
    const { router: swappedRouter } = createOauthRouterForTest({ ports: swappedPorts, stateCodec });

    const response = await approve(swappedRouter, state);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'access_denied' } });
  });
});
