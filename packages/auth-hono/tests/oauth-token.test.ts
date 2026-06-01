import { createHash } from 'node:crypto';

import { calculateJwkThumbprint, decodeJwt, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import type { AuthCodePayload } from '../src/index.js';
import {
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
  oauthNow,
  oauthUser,
} from './__fixtures__/oauth-fixtures.js';

const redirectUri = 'http://localhost:5397/callback';
const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
const challenge = createPkceChallenge(verifier);

describe('OAuth token handler', () => {
  it('exchanges an authorization code for signed access and id tokens', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true });
    const { router } = createOauthRouterForTest({ ports });
    await saveCode(store, 'code-1', { nonce: 'nonce-1', scope: 'openid profile email' });

    const response = await tokenRequest(router, {
      code: 'code-1',
      code_verifier: verifier,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string; expires_in: number; id_token: string; token_type: string };
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(3600);
    expect(decodeJwt(body.access_token)).toMatchObject({
      aud: 'http://localhost:9197/api/v1/auth/oauth/userinfo',
      client_id: 'example-rp',
      scope: 'openid profile email',
      sub: oauthUser.id,
    });
    expect(decodeJwt(body.id_token)).toMatchObject({
      aud: 'example-rp',
      nonce: 'nonce-1',
      sub: oauthUser.id,
    });
  });

  it('rejects redirect_uri mismatch, PKCE mismatch, and authorization-code reuse', async () => {
    const { ports, store } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });
    await saveCode(store, 'code-redirect');
    await saveCode(store, 'code-pkce');
    await saveCode(store, 'code-reuse');

    expect((await tokenRequest(router, { code: 'code-redirect', redirect_uri: 'http://localhost:5397/other' })).status).toBe(400);
    expect((await tokenRequest(router, { code: 'code-pkce', code_verifier: 'wrong-verifier' })).status).toBe(400);
    expect((await tokenRequest(router, { code: 'code-reuse' })).status).toBe(200);
    expect((await tokenRequest(router, { code: 'code-reuse' })).status).toBe(400);
  });

  it('omits id_token for non-openid scope and rejects wrong client secrets', async () => {
    const { ports, store } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });
    await saveCode(store, 'code-profile', { scope: 'profile' });
    await saveCode(store, 'code-secret');

    const profileOnly = await tokenRequest(router, { code: 'code-profile' });
    expect(profileOnly.status).toBe(200);
    expect(await profileOnly.json()).not.toHaveProperty('id_token');

    const wrongSecret = await tokenRequest(router, {
      authorization: basicAuth('example-rp', 'wrong-secret'),
      code: 'code-secret',
    });
    expect(wrongSecret.status).toBe(401);
  });

  it('requires and validates DPoP proof for DPoP-bound clients', async () => {
    const dpopClient = createOauthClient({
      clientId: 'dpop-rp',
      clientSecretHash: null,
      dpopBoundAccessTokens: true,
      tokenEndpointAuthMethod: 'none',
    });
    const { ports, store } = await createOauthPorts({ clients: [dpopClient] });
    const { router } = createOauthRouterForTest({ ports });
    await saveCode(store, 'code-missing-dpop', { clientId: 'dpop-rp' });
    await saveCode(store, 'code-valid-dpop', { clientId: 'dpop-rp' });
    const proofKey = await generateKeyPair('EdDSA');

    expect((await publicTokenRequest(router, { code: 'code-missing-dpop', client_id: 'dpop-rp' })).status).toBe(400);

    const proof = await createDpopProof({
      htm: 'POST',
      htu: 'http://localhost/oauth/token',
      keyPair: proofKey,
      jti: 'proof-1',
    });
    const response = await publicTokenRequest(router, {
      code: 'code-valid-dpop',
      client_id: 'dpop-rp',
      dpop: proof,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string; id_token: string; token_type: string };
    const jkt = await calculateJwkThumbprint(await exportJWK(proofKey.publicKey));
    expect(body.token_type).toBe('DPoP');
    expect(decodeJwt(body.access_token)).toMatchObject({ cnf: { jkt } });
    expect(decodeJwt(body.id_token)).toMatchObject({ cnf: { jkt } });
  });
});

const saveCode = async (
  store: Awaited<ReturnType<typeof createOauthPorts>>['store'],
  code: string,
  input: Partial<AuthCodePayload> = {}
) => {
  await store.saveAuthCode(
    code,
    {
      acr: 'urn:sentropic:loa:passkey-fresh',
      authTime: oauthNow,
      clientId: 'example-rp',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      createdAt: oauthNow,
      dpopJkt: null,
      expiresAt: new Date('2026-01-01T00:01:00.000Z'),
      nonce: null,
      redirectUri,
      scope: 'openid profile email',
      tenantId: null,
      userId: oauthUser.id,
      ...input,
    },
    60
  );
};

const tokenRequest = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  input: Record<string, string | undefined> & { authorization?: string }
) =>
  router.request('/oauth/token', {
    body: formBody({
      client_id: 'example-rp',
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      ...input,
    }),
    headers: {
      authorization: input.authorization ?? basicAuth('example-rp', 'client-secret'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });

const publicTokenRequest = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  input: Record<string, string | undefined> & { dpop?: string }
) =>
  router.request('/oauth/token', {
    body: formBody({
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      ...input,
    }),
    headers: {
      ...(input.dpop ? { dpop: input.dpop } : {}),
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });

const createDpopProof = async (input: {
  htm: string;
  htu: string;
  jti: string;
  keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
}): Promise<string> =>
  new SignJWT({
    htm: input.htm,
    htu: input.htu,
    iat: Math.floor(oauthNow.getTime() / 1000),
    jti: input.jti,
  })
    .setProtectedHeader({
      alg: 'EdDSA',
      jwk: await exportJWK(input.keyPair.publicKey),
      typ: 'dpop+jwt',
    })
    .sign(input.keyPair.privateKey);

function createPkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

const basicAuth = (clientId: string, secret: string): string =>
  `Basic ${Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64')}`;

const formBody = (input: Record<string, string | undefined>): string => {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && key !== 'authorization' && key !== 'dpop') form.set(key, value);
  }
  return form.toString();
};
