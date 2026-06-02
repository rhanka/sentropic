import { describe, expect, it } from 'vitest';

import {
  basicAuth,
  formBody,
  saveOAuthCode,
  tokenRequest,
} from './__fixtures__/oauth-flow-fixtures.js';
import { createOauthPorts, createOauthRouterForTest, oauthUser } from './__fixtures__/oauth-fixtures.js';

describe('OAuth introspect handler', () => {
  it('returns token details for active access tokens', async () => {
    const { ports, store } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-introspect');
    const tokens = (await (await tokenRequest(router, { code: 'code-introspect' })).json()) as { access_token: string };

    const response = await introspectRequest(router, tokens.access_token);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      active: true,
      client_id: 'example-rp',
      scope: 'openid profile email',
      sub: oauthUser.id,
      token_type: 'access_token',
    });
  });

  it('returns inactive for revoked tokens and rejects missing client auth', async () => {
    const { ports, store } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-revoked-introspect');
    const tokens = (await (await tokenRequest(router, { code: 'code-revoked-introspect' })).json()) as { access_token: string };
    await router.request('/oauth/revoke', {
      body: formBody({ token: tokens.access_token }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });

    expect((await introspectRequest(router, tokens.access_token, null)).status).toBe(401);
    const inactive = await introspectRequest(router, tokens.access_token);
    expect(inactive.status).toBe(200);
    await expect(inactive.json()).resolves.toEqual({ active: false });
  });
});

const introspectRequest = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  token: string,
  authorization: string | null = basicAuth('example-rp', 'client-secret')
) =>
  router.request('/oauth/introspect', {
    body: formBody({ token }),
    headers: {
      ...(authorization ? { authorization } : {}),
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });
