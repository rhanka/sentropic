import { createHash } from 'node:crypto';

import { calculateJwkThumbprint, decodeJwt, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import type { OauthClientRecord } from '../src/index.js';
import {
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
  oauthUser,
} from './__fixtures__/oauth-fixtures.js';

describe('example OAuth RP integration', () => {
  it('walks the bearer authorization-code flow through userinfo and revoke', async () => {
    const result = await runMockRpFlow({ dpop: false });

    expect(result.tokens.token_type).toBe('Bearer');
    expect(result.userinfoBeforeRevoke.status).toBe(200);
    expect(result.userinfoBeforeRevoke.body).toMatchObject({
      email: oauthUser.email,
      email_verified: true,
      name: oauthUser.displayName,
      sub: oauthUser.id,
    });
    expect(result.userinfoAfterRevoke.status).toBe(401);
  });

  it('walks the DPoP-bound authorization-code flow with a mock RP keypair', async () => {
    const result = await runMockRpFlow({ dpop: true });

    expect(result.tokens.token_type).toBe('DPoP');
    expect(decodeJwt(result.tokens.access_token)).toMatchObject({
      cnf: { jkt: result.dpopJkt },
    });
    expect(result.userinfoBeforeRevoke.status).toBe(200);
    expect(result.userinfoAfterRevoke.status).toBe(401);
  });
});

interface MockRpFlowOptions {
  dpop: boolean;
}

interface MockRpFlowResult {
  dpopJkt: string | null;
  tokens: OAuthTokenResponse;
  userinfoAfterRevoke: { body: unknown; status: number };
  userinfoBeforeRevoke: { body: unknown; status: number };
}

interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  id_token?: string;
  scope: string;
  token_type: 'Bearer' | 'DPoP';
}

const runMockRpFlow = async ({ dpop }: MockRpFlowOptions): Promise<MockRpFlowResult> => {
  const dpopKeyPair = dpop ? await generateKeyPair('EdDSA') : null;
  const dpopJkt = dpopKeyPair ? await calculateJwkThumbprint(await exportJWK(dpopKeyPair.publicKey)) : null;
  const client = dpop
    ? createOauthClient({
        clientId: 'example-dpop-rp',
        clientSecretHash: null,
        dpopBoundAccessTokens: true,
        tokenEndpointAuthMethod: 'none',
      })
    : createOauthClient();
  const { ports } = await createOauthPorts({
    authenticated: true,
    clients: [client],
  });
  const { router } = createOauthRouterForTest({ ports });
  const rp = new MinimalMockRp({
    client,
    dpopJkt,
    dpopKeyPair,
    router,
  });

  const callback = await rp.authorizeAndApprove();
  const tokens = await rp.exchangeCode(callback.code);
  const userinfoBeforeRevoke = await responseSnapshot(await rp.userinfo(tokens.access_token, 'userinfo-before-revoke'));
  await rp.revoke(tokens.access_token);
  const userinfoAfterRevoke = await responseSnapshot(await rp.userinfo(tokens.access_token, 'userinfo-after-revoke'));

  return {
    dpopJkt,
    tokens,
    userinfoAfterRevoke,
    userinfoBeforeRevoke,
  };
};

class MinimalMockRp {
  readonly client: OauthClientRecord;
  readonly dpopJkt: string | null;
  readonly dpopKeyPair: Awaited<ReturnType<typeof generateKeyPair>> | null;
  readonly redirectUri = 'http://localhost:5397/callback';
  readonly router: ReturnType<typeof createOauthRouterForTest>['router'];
  readonly state = 'mock-rp-state';
  readonly verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';

  constructor(input: {
    client: OauthClientRecord;
    dpopJkt: string | null;
    dpopKeyPair: Awaited<ReturnType<typeof generateKeyPair>> | null;
    router: ReturnType<typeof createOauthRouterForTest>['router'];
  }) {
    this.client = input.client;
    this.dpopJkt = input.dpopJkt;
    this.dpopKeyPair = input.dpopKeyPair;
    this.router = input.router;
  }

  async authorizeAndApprove(): Promise<{ code: string }> {
    const authorize = await this.router.request(`/oauth/authorize?${this.authorizeParams().toString()}`);
    expect(authorize.status).toBe(302);
    const consentUrl = new URL(authorize.headers.get('location') ?? '');
    expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');

    const sealedState = consentUrl.searchParams.get('state') ?? '';
    const consent = await this.router.request(`/oauth/consent?state=${encodeURIComponent(sealedState)}`);
    expect(consent.status).toBe(200);

    const decision = await this.router.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'approve', state: sealedState }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(decision.status).toBe(200);
    const body = (await decision.json()) as { redirectTo: string };
    const callback = new URL(body.redirectTo);
    expect(callback.searchParams.get('state')).toBe(this.state);
    const code = callback.searchParams.get('code');
    expect(code).toBeTruthy();
    return { code: code ?? '' };
  }

  async exchangeCode(code: string): Promise<OAuthTokenResponse> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (this.client.tokenEndpointAuthMethod === 'client_secret_basic') {
      headers.authorization = basicAuth(this.client.clientId, 'client-secret');
    }
    const dpop = await this.createDpopProof('POST', 'http://localhost/oauth/token', 'mock-rp-token');
    if (dpop) headers.dpop = dpop;

    const response = await this.router.request('/oauth/token', {
      body: formBody({
        client_id: this.client.clientId,
        code,
        code_verifier: this.verifier,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      }),
      headers,
      method: 'POST',
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<OAuthTokenResponse>;
  }

  async userinfo(accessToken: string, proofId: string): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `${this.dpopKeyPair ? 'DPoP' : 'Bearer'} ${accessToken}`,
    };
    const dpop = await this.createDpopProof('GET', 'http://localhost/oauth/userinfo', proofId, accessToken);
    if (dpop) headers.dpop = dpop;
    return this.router.request('/oauth/userinfo', { headers });
  }

  async revoke(accessToken: string): Promise<void> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };
    const dpop = await this.createDpopProof('POST', 'http://localhost/oauth/revoke', 'mock-rp-revoke', accessToken);
    if (dpop) headers.dpop = dpop;

    const response = await this.router.request('/oauth/revoke', {
      body: formBody({ token: accessToken }),
      headers,
      method: 'POST',
    });
    expect(response.status).toBe(200);
  }

  private authorizeParams(): URLSearchParams {
    const params = new URLSearchParams({
      client_id: this.client.clientId,
      code_challenge: sha256Base64url(this.verifier),
      code_challenge_method: 'S256',
      nonce: 'mock-rp-nonce',
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state: this.state,
    });
    if (this.dpopJkt) params.set('dpop_jkt', this.dpopJkt);
    return params;
  }

  private async createDpopProof(
    htm: string,
    htu: string,
    jti: string,
    accessToken?: string,
  ): Promise<string | null> {
    if (!this.dpopKeyPair) return null;
    return new SignJWT({
      ...(accessToken ? { ath: sha256Base64url(accessToken) } : {}),
      htm,
      htu,
      iat: Math.floor(Date.parse('2026-01-01T00:00:00.000Z') / 1000),
      jti,
    })
      .setProtectedHeader({
        alg: 'EdDSA',
        jwk: await exportJWK(this.dpopKeyPair.publicKey),
        typ: 'dpop+jwt',
      })
      .sign(this.dpopKeyPair.privateKey);
  }
}

const responseSnapshot = async (response: Response): Promise<{ body: unknown; status: number }> => ({
  body: await response.json().catch(() => null),
  status: response.status,
});

const sha256Base64url = (value: string): string => createHash('sha256').update(value).digest('base64url');

const basicAuth = (clientId: string, secret: string): string =>
  `Basic ${Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64')}`;

const formBody = (input: Record<string, string>): string => new URLSearchParams(input).toString();
