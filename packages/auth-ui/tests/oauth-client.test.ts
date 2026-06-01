import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createOAuthClient } from '../src/index.js';

const discovery = {
  authorization_endpoint: 'http://idp.example/api/v1/auth/oauth/authorize',
  revocation_endpoint: 'http://idp.example/api/v1/auth/oauth/revoke',
  token_endpoint: 'http://idp.example/api/v1/auth/oauth/token',
  userinfo_endpoint: 'http://idp.example/api/v1/auth/oauth/userinfo',
};

describe('createOAuthClient', () => {
  it('fetches discovery once and builds a PKCE authorization URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(discovery));
    const client = createOAuthClient({
      clientId: 'example-rp',
      fetch: fetchMock,
      issuer: 'http://idp.example',
      redirectUri: 'http://rp.example/callback',
      scopes: ['openid', 'profile', 'email'],
    });

    const request = await client.startAuthorization({
      codeVerifier: verifier,
      nonce: 'nonce-1',
      state: 'state-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://idp.example/.well-known/openid-configuration', {
      headers: { Accept: 'application/json' },
      method: 'GET',
    });
    const url = new URL(request.url);
    expect(`${url.origin}${url.pathname}`).toBe(discovery.authorization_endpoint);
    expect(url.searchParams.get('client_id')).toBe('example-rp');
    expect(url.searchParams.get('redirect_uri')).toBe('http://rp.example/callback');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(verifier));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(request.codeVerifier).toBe(verifier);
  });

  it('exchanges an authorization code through the discovered token endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(discovery))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-token', token_type: 'Bearer' }));
    const client = createOAuthClient({
      clientId: 'example-rp',
      fetch: fetchMock,
      issuer: 'http://idp.example',
      redirectUri: 'http://rp.example/callback',
      scopes: ['openid'],
    });

    await client.startAuthorization({ codeVerifier: verifier });
    const tokens = await client.exchangeCode('code-1', verifier);

    expect(tokens.access_token).toBe('access-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(discovery.token_endpoint);
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('grant_type=authorization_code');
    expect(String(init.body)).toContain('code=code-1');
  });

  it('maps token endpoint errors to AuthUiError', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(discovery))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, { status: 400 }));
    const client = createOAuthClient({
      clientId: 'example-rp',
      fetch: fetchMock,
      issuer: 'http://idp.example',
      redirectUri: 'http://rp.example/callback',
      scopes: ['openid'],
    });

    await expect(client.exchangeCode('bad-code', verifier)).rejects.toMatchObject({
      code: 'transport_error',
      retryable: false,
    });
  });

  it('attaches DPoP proofs to token, userinfo, and revoke requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(discovery))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-token', token_type: 'DPoP' }))
      .mockResolvedValueOnce(jsonResponse({ sub: 'user-1' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const client = createOAuthClient({
      clientId: 'example-rp',
      dpop: {
        generateKeyPair: async () => fakeDpopKeyPair,
        jti: () => 'proof-jti',
        now: () => new Date('2026-01-01T00:00:00.000Z'),
        store: memoryDpopStore(),
      },
      fetch: fetchMock,
      issuer: 'http://idp.example',
      redirectUri: 'http://rp.example/callback',
      scopes: ['openid'],
    });

    await client.exchangeCode('code-1', verifier);
    await client.userInfo('access-token');
    await client.revoke('access-token');

    const tokenProof = decodeDpop(String(fetchMock.mock.calls[1][1].headers.DPoP));
    const userInfoProof = decodeDpop(String(fetchMock.mock.calls[2][1].headers.DPoP));
    const revokeProof = decodeDpop(String(fetchMock.mock.calls[3][1].headers.DPoP));
    expect(tokenProof.payload).toMatchObject({ htm: 'POST', htu: discovery.token_endpoint, jti: 'proof-jti' });
    expect(userInfoProof.payload).toMatchObject({ ath: pkceChallenge('access-token'), htm: 'GET', htu: discovery.userinfo_endpoint });
    expect(revokeProof.payload).toMatchObject({ ath: pkceChallenge('access-token'), htm: 'POST', htu: discovery.revocation_endpoint });
  });
});

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';

const fakeDpopKeyPair = {
  publicJwk: { crv: 'Ed25519', kty: 'OKP', x: 'fake-public-key' },
  sign: async () => new Uint8Array([1, 2, 3]),
};

const memoryDpopStore = () => {
  let value: typeof fakeDpopKeyPair | null = null;
  return {
    get: async () => value,
    set: async (next: typeof fakeDpopKeyPair) => {
      value = next;
    },
  };
};

const jsonResponse = (payload: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...init,
  });

const pkceChallenge = (value: string): string =>
  createHash('sha256').update(value).digest('base64url');

const decodeDpop = (jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown> } => ({
  header: JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8')),
  payload: JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')),
});
