import { createHash } from 'node:crypto';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import type { AuthCodePayload } from '../../src/index.js';
import type { createOauthPorts, createOauthRouterForTest } from './oauth-fixtures.js';
import { oauthNow, oauthUser } from './oauth-fixtures.js';

export const oauthRedirectUri = 'http://localhost:5397/callback';
export const oauthVerifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
export const oauthChallenge = createPkceChallenge(oauthVerifier);

export const saveOAuthCode = async (
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
      codeChallenge: oauthChallenge,
      codeChallengeMethod: 'S256',
      createdAt: oauthNow,
      dpopJkt: null,
      expiresAt: new Date('2026-01-01T00:01:00.000Z'),
      nonce: null,
      redirectUri: oauthRedirectUri,
      scope: 'openid profile email',
      tenantId: null,
      userId: oauthUser.id,
      ...input,
    },
    60
  );
};

export const tokenRequest = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  input: Record<string, string | undefined> & { authorization?: string }
) =>
  router.request('/oauth/token', {
    body: formBody({
      client_id: 'example-rp',
      code_verifier: oauthVerifier,
      grant_type: 'authorization_code',
      redirect_uri: oauthRedirectUri,
      ...input,
    }),
    headers: {
      authorization: input.authorization ?? basicAuth('example-rp', 'client-secret'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });

export const publicTokenRequest = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  input: Record<string, string | undefined> & { dpop?: string }
) =>
  router.request('/oauth/token', {
    body: formBody({
      code_verifier: oauthVerifier,
      grant_type: 'authorization_code',
      redirect_uri: oauthRedirectUri,
      ...input,
    }),
    headers: {
      ...(input.dpop ? { dpop: input.dpop } : {}),
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });

export const createDpopProof = async (input: {
  ath?: string;
  htm: string;
  htu: string;
  iat?: number;
  jti: string;
  keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
}): Promise<string> =>
  new SignJWT({
    ...(input.ath ? { ath: createPkceChallenge(input.ath) } : {}),
    htm: input.htm,
    htu: input.htu,
    iat: input.iat ?? Math.floor(oauthNow.getTime() / 1000),
    jti: input.jti,
  })
    .setProtectedHeader({
      alg: 'EdDSA',
      jwk: await exportJWK(input.keyPair.publicKey),
      typ: 'dpop+jwt',
    })
    .sign(input.keyPair.privateKey);

export function createPkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

export const basicAuth = (clientId: string, secret: string): string =>
  `Basic ${Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64')}`;

export const formBody = (input: Record<string, string | undefined>): string => {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && key !== 'authorization' && key !== 'dpop') form.set(key, value);
  }
  return form.toString();
};
