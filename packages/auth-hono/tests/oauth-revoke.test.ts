import { generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  createDpopProof,
  formBody,
  publicTokenRequest,
  saveOAuthCode,
  tokenRequest,
} from './__fixtures__/oauth-flow-fixtures.js';
import {
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
} from './__fixtures__/oauth-fixtures.js';

describe('OAuth revoke handler', () => {
  it('revokes bearer tokens idempotently', async () => {
    const { ports, store } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-revoke');
    const tokens = (await (await tokenRequest(router, { code: 'code-revoke' })).json()) as { access_token: string };

    const first = await revokeRequest(router, tokens.access_token);
    const second = await revokeRequest(router, tokens.access_token);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(
      (
        await router.request('/oauth/userinfo', {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        })
      ).status
    ).toBe(401);
  });

  it('requires DPoP proof to revoke DPoP-bound tokens', async () => {
    const dpopClient = createOauthClient({
      clientId: 'dpop-rp',
      clientSecretHash: null,
      dpopBoundAccessTokens: true,
      tokenEndpointAuthMethod: 'none',
    });
    const { ports, store } = await createOauthPorts({ clients: [dpopClient] });
    const { router } = createOauthRouterForTest({ ports });
    const keyPair = await generateKeyPair('EdDSA');
    await saveOAuthCode(store, 'code-dpop-revoke', { clientId: 'dpop-rp' });
    const tokenProof = await createDpopProof({
      htm: 'POST',
      htu: 'http://localhost/oauth/token',
      jti: 'token-proof-revoke',
      keyPair,
    });
    const tokens = (await (await publicTokenRequest(router, {
      client_id: 'dpop-rp',
      code: 'code-dpop-revoke',
      dpop: tokenProof,
    })).json()) as { access_token: string };

    expect((await revokeRequest(router, tokens.access_token)).status).toBe(400);

    const revokeProof = await createDpopProof({
      ath: tokens.access_token,
      htm: 'POST',
      htu: 'http://localhost/oauth/revoke',
      jti: 'revoke-proof',
      keyPair,
    });
    expect((await revokeRequest(router, tokens.access_token, revokeProof)).status).toBe(200);
  });
});

const revokeRequest = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  token: string,
  dpop?: string
) =>
  router.request('/oauth/revoke', {
    body: formBody({ token }),
    headers: {
      ...(dpop ? { dpop } : {}),
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });
