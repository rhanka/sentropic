import { createHash } from 'node:crypto';

import { expect, request, test, type APIResponse } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8787';
const UI_BASE_URL = process.env.UI_BASE_URL ?? 'http://localhost:5173';
const CLIENT_ID = 'example-mock-rp';
const CLIENT_SECRET = 'example-mock-rp-secret-dev-only';
const CODE_VERIFIER = 'test-code-verifier-with-enough-entropy-1234567890';

interface OAuthTokenResponse {
  access_token?: string;
  scope?: string;
  token_type?: string;
}

test.describe('OAuth2 token revocation', () => {
  test('revokes an issued access token and blocks userinfo afterwards', async ({ page }) => {
    const state = `oauth-revoke-state-${Date.now()}`;
    await page.goto(buildAuthorizeUrl(state));
    await expect(page).toHaveURL(/\/auth\/oauth\/consent\?state=/u);
    await page.getByRole('button', { name: /Autoriser|Approve/u }).click();
    await expect(page).toHaveURL(/\/auth\/oauth\/callback\?/u);

    const callbackUrl = new URL(page.url());
    expect(callbackUrl.searchParams.get('state')).toBe(state);
    const code = callbackUrl.searchParams.get('code');
    expect(code).toBeTruthy();

    const api = await request.newContext({ baseURL: API_BASE_URL });
    try {
      const tokens = await exchangeCode(api, code!);
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.scope).toBe('openid profile email');
      expect(tokens.token_type).toBe('Bearer');
      const accessToken = tokens.access_token!;

      const beforeRevoke = await api.get('/api/v1/auth/oauth/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      await expectOk(beforeRevoke, 'userinfo before revoke');

      const revoke = await api.post('/api/v1/auth/oauth/revoke', {
        form: { token: accessToken },
      });
      await expectOk(revoke, 'token revoke');

      const afterRevoke = await api.get('/api/v1/auth/oauth/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(afterRevoke.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });
});

const buildAuthorizeUrl = (state: string): string => {
  const url = new URL('/api/v1/auth/oauth/authorize', API_BASE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', `${UI_BASE_URL}/auth/oauth/callback`);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('code_challenge', createCodeChallenge(CODE_VERIFIER));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return url.toString();
};

const exchangeCode = async (
  api: Awaited<ReturnType<typeof request.newContext>>,
  code: string,
): Promise<OAuthTokenResponse> => {
  const response = await api.post('/api/v1/auth/oauth/token', {
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

const expectOk = async (response: APIResponse, label: string): Promise<void> => {
  if (response.ok()) {
    return;
  }

  throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
};
