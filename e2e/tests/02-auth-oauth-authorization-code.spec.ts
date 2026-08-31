import { createHash } from 'node:crypto';

import { expect, request, test, type APIResponse } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8787';
const UI_BASE_URL = process.env.UI_BASE_URL ?? 'http://localhost:5173';
const CLIENT_ID = 'example-mock-rp';
const CLIENT_SECRET = 'example-mock-rp-secret-dev-only';
const CODE_VERIFIER = 'test-code-verifier-with-enough-entropy-1234567890';

interface OAuthTokenResponse {
  access_token: string;
  id_token?: string;
  scope?: string;
  token_type: string;
}

test.describe('OAuth2 / OIDC authorization code flow', () => {
  test('authorizes a signed-in user, exchanges the code, and reads userinfo', async ({ page }) => {
    const nonce = `oauth-nonce-${Date.now()}`;
    const state = `oauth-state-${Date.now()}`;
    const authorizeUrl = buildAuthorizeUrl({ nonce, state });

    await page.goto(authorizeUrl);
    await expect(page).toHaveURL(/\/auth\/oauth\/consent\?state=/u);
    await expect(page.getByText('Example Mock RP')).toBeVisible();
    await expect(page.getByRole('button', { name: /Autoriser|Approve/u })).toBeEnabled();

    await page.getByRole('button', { name: /Autoriser|Approve/u }).click();
    await expect(page).toHaveURL(/\/auth\/oauth\/callback\?/u);

    const callbackUrl = new URL(page.url());
    expect(callbackUrl.origin).toBe(UI_BASE_URL);
    expect(callbackUrl.searchParams.get('state')).toBe(state);
    const code = callbackUrl.searchParams.get('code');
    expect(code).toBeTruthy();

    const api = await request.newContext({ baseURL: API_BASE_URL });
    try {
      const tokens = await exchangeCode(api, code!);
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.scope).toBe('openid profile email');
      expect(tokens.id_token).toBeTruthy();

      const idTokenClaims = decodeJwtPayload(tokens.id_token!);
      expect(idTokenClaims.iss).toBe(API_BASE_URL);
      expect(idTokenClaims.aud).toBe(CLIENT_ID);
      expect(idTokenClaims.nonce).toBe(nonce);
      expect(idTokenClaims.acr).toBe('urn:sentropic:loa:bearer');
      expect(typeof idTokenClaims.auth_time).toBe('number');
      expect(typeof idTokenClaims.sub).toBe('string');

      const userInfoResponse = await api.get('/api/v1/oauth/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      await expectOk(userInfoResponse, 'userinfo');
      const userInfo = await userInfoResponse.json();
      expect(userInfo).toMatchObject({
        email: 'e2e-admin@example.com',
        email_verified: true,
        name: 'E2E Admin',
        sub: idTokenClaims.sub,
      });
    } finally {
      await api.dispose();
    }
  });
});

const buildAuthorizeUrl = (input: { nonce: string; state: string }): string => {
  const url = new URL('/api/v1/oauth/authorize', API_BASE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', `${UI_BASE_URL}/auth/oauth/callback`);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('code_challenge', createCodeChallenge(CODE_VERIFIER));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  return url.toString();
};

const exchangeCode = async (
  api: Awaited<ReturnType<typeof request.newContext>>,
  code: string,
): Promise<OAuthTokenResponse> => {
  const response = await api.post('/api/v1/oauth/token', {
    form: {
      client_id: CLIENT_ID,
      code,
      code_verifier: CODE_VERIFIER,
      grant_type: 'authorization_code',
      redirect_uri: `${UI_BASE_URL}/auth/oauth/callback`,
    },
    headers: {
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
  });
  await expectOk(response, 'token exchange');
  return response.json() as Promise<OAuthTokenResponse>;
};

const createCodeChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

const decodeJwtPayload = (jwt: string): Record<string, unknown> => {
  const [, payload] = jwt.split('.');
  expect(payload).toBeTruthy();
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;
};

const expectOk = async (response: APIResponse, label: string): Promise<void> => {
  if (response.ok()) {
    return;
  }

  throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
};
