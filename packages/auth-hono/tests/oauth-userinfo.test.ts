import { decodeJwt, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  createDpopProof,
  publicTokenRequest,
  saveOAuthCode,
  tokenRequest,
} from './__fixtures__/oauth-flow-fixtures.js';
import {
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
  oauthUser,
} from './__fixtures__/oauth-fixtures.js';

describe('OAuth userinfo handler', () => {
  it('returns claims for a valid bearer access token', async () => {
    const { ports, store } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-userinfo');
    const tokens = (await (await tokenRequest(router, { code: 'code-userinfo' })).json()) as { access_token: string };

    const response = await router.request('/oauth/userinfo', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      email: oauthUser.email,
      email_verified: true,
      name: oauthUser.displayName,
      sub: oauthUser.id,
    });
  });

  it('rejects revoked tokens and tokens with unsupported scopes', async () => {
    const { ports, store } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-revoked');
    await saveOAuthCode(store, 'code-unknown-scope', { scope: 'openid unknown' });
    const revoked = (await (await tokenRequest(router, { code: 'code-revoked' })).json()) as { access_token: string };
    await store.revokeToken(String(decodeJwt(revoked.access_token).jti));

    expect(
      (
        await router.request('/oauth/userinfo', {
          headers: { authorization: `Bearer ${revoked.access_token}` },
        })
      ).status
    ).toBe(401);

    const unknownScope = (await (await tokenRequest(router, { code: 'code-unknown-scope' })).json()) as { access_token: string };
    expect(
      (
        await router.request('/oauth/userinfo', {
          headers: { authorization: `Bearer ${unknownScope.access_token}` },
        })
      ).status
    ).toBe(401);
  });

  it('requires matching DPoP proof for DPoP-bound access tokens', async () => {
    const dpopClient = createOauthClient({
      clientId: 'dpop-rp',
      clientSecretHash: null,
      dpopBoundAccessTokens: true,
      tokenEndpointAuthMethod: 'none',
    });
    const { ports, store } = await createOauthPorts({ clients: [dpopClient] });
    const { router } = createOauthRouterForTest({ ports });
    const tokenKey = await generateKeyPair('EdDSA');
    await saveOAuthCode(store, 'code-dpop', { clientId: 'dpop-rp' });
    const tokenProof = await createDpopProof({
      htm: 'POST',
      htu: 'http://localhost/oauth/token',
      jti: 'token-proof',
      keyPair: tokenKey,
    });
    const tokens = (await (await publicTokenRequest(router, {
      client_id: 'dpop-rp',
      code: 'code-dpop',
      dpop: tokenProof,
    })).json()) as { access_token: string };

    expect(
      (
        await router.request('/oauth/userinfo', {
          headers: { authorization: `DPoP ${tokens.access_token}` },
        })
      ).status
    ).toBe(401);

    const wrongKey = await generateKeyPair('EdDSA');
    const wrongProof = await createDpopProof({
      ath: tokens.access_token,
      htm: 'GET',
      htu: 'http://localhost/oauth/userinfo',
      jti: 'userinfo-wrong-key',
      keyPair: wrongKey,
    });
    expect(
      (
        await router.request('/oauth/userinfo', {
          headers: { authorization: `DPoP ${tokens.access_token}`, dpop: wrongProof },
        })
      ).status
    ).toBe(401);

    const validProof = await createDpopProof({
      ath: tokens.access_token,
      htm: 'GET',
      htu: 'http://localhost/oauth/userinfo',
      jti: 'userinfo-valid',
      keyPair: tokenKey,
    });
    const response = await router.request('/oauth/userinfo', {
      headers: { authorization: `DPoP ${tokens.access_token}`, dpop: validProof },
    });
    expect(response.status).toBe(200);
    expect(await exportJWK(tokenKey.publicKey)).toHaveProperty('crv', 'Ed25519');
  });
});
