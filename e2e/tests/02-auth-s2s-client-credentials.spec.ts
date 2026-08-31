import { expect, request, test } from '@playwright/test';

// API-level S2S spec (BR-39d Lot 5). No UI surface — exercises the running stack
// via the OAuth token endpoint and the createRequireServiceAuth-protected route.
//
// Requires the e2e DB to contain a service_clients row matching CLIENT_ID with
// resource indicator = API_BASE_URL and the `service:ping` scope (seeded by
// `seedServiceClients`). See BR39d-Q2 in BRANCH.md.

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8787';
const CLIENT_ID = 'example-service-rp';
const CLIENT_SECRET = 'example-service-rp-secret-dev-only';
const PING_PATH = '/api/v1/oauth/s2s/ping';
const TOKEN_PATH = '/api/v1/oauth/token';

const basicAuth = (): string =>
  `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, 'utf8').toString('base64')}`;

test.describe('S2S client_credentials grant', () => {
  test('advertises client_credentials in discovery metadata', async () => {
    const api = await request.newContext({ baseURL: API_BASE_URL });
    try {
      const response = await api.get('/.well-known/openid-configuration');
      expect(response.ok()).toBe(true);
      const discovery = await response.json();
      expect(discovery.grant_types_supported).toContain('client_credentials');
      expect(discovery.token_endpoint_auth_methods_supported).toContain('client_secret_post');
    } finally {
      await api.dispose();
    }
  });

  test('mints a stateless service token and calls the protected route', async () => {
    const api = await request.newContext({ baseURL: API_BASE_URL });
    try {
      const tokenResponse = await api.post(TOKEN_PATH, {
        form: { grant_type: 'client_credentials', resource: API_BASE_URL, scope: 'service:ping' },
        headers: { authorization: basicAuth() },
      });
      expect(tokenResponse.status()).toBe(200);
      const token = await tokenResponse.json();
      expect(token.token_type).toBe('Bearer');
      expect(typeof token.access_token).toBe('string');

      const pingResponse = await api.get(PING_PATH, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      expect(pingResponse.status()).toBe(200);
      await expect(pingResponse.json()).resolves.toMatchObject({
        clientId: CLIENT_ID,
        service: 's2s',
        status: 'ok',
      });
    } finally {
      await api.dispose();
    }
  });

  test('rejects the protected route without a token (401)', async () => {
    const api = await request.newContext({ baseURL: API_BASE_URL });
    try {
      const response = await api.get(PING_PATH);
      expect(response.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('rejects a token missing the required scope (403)', async () => {
    const api = await request.newContext({ baseURL: API_BASE_URL });
    try {
      const tokenResponse = await api.post(TOKEN_PATH, {
        form: { grant_type: 'client_credentials', resource: API_BASE_URL, scope: 'service:read' },
        headers: { authorization: basicAuth() },
      });
      expect(tokenResponse.status()).toBe(200);
      const token = await tokenResponse.json();

      const pingResponse = await api.get(PING_PATH, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      expect(pingResponse.status()).toBe(403);
    } finally {
      await api.dispose();
    }
  });
});
