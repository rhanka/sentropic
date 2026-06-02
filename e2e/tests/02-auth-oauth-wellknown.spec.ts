import { expect, request, test } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8787';

test.describe('OIDC discovery documents', () => {
  test('exposes OpenID configuration and JWKS on the API issuer origin', async () => {
    const api = await request.newContext({ baseURL: API_BASE_URL });
    try {
      const discoveryResponse = await api.get('/.well-known/openid-configuration');
      expect(discoveryResponse.ok()).toBe(true);
      const discovery = await discoveryResponse.json();
      expect(discovery).toMatchObject({
        authorization_endpoint: `${API_BASE_URL}/api/v1/auth/oauth/authorize`,
        issuer: API_BASE_URL,
        jwks_uri: `${API_BASE_URL}/.well-known/jwks.json`,
        token_endpoint: `${API_BASE_URL}/api/v1/auth/oauth/token`,
        userinfo_endpoint: `${API_BASE_URL}/api/v1/auth/oauth/userinfo`,
      });
      expect(discovery.response_types_supported).toContain('code');
      expect(discovery.grant_types_supported).toContain('authorization_code');
      expect(discovery.code_challenge_methods_supported).toEqual(['S256']);
      expect(discovery.id_token_signing_alg_values_supported).toEqual(['EdDSA']);

      const jwksResponse = await api.get('/.well-known/jwks.json');
      expect(jwksResponse.ok()).toBe(true);
      expect(jwksResponse.headers()['cache-control']).toContain('max-age=300');
      const jwks = await jwksResponse.json();
      expect(Array.isArray(jwks.keys)).toBe(true);
      expect(jwks.keys.length).toBeGreaterThan(0);
      expect(jwks.keys[0]).toMatchObject({
        alg: 'EdDSA',
        crv: 'Ed25519',
        kid: 'e2e-oauth-signing-key',
        kty: 'OKP',
        use: 'sig',
      });
      expect(typeof jwks.keys[0].x).toBe('string');
    } finally {
      await api.dispose();
    }
  });
});
