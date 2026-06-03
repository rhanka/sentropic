import { describe, expect, it } from 'vitest';

import { createWellKnownRouter } from '../src/index.js';
import { createJwksKeyRecord, createMemoryJwksPort } from './__fixtures__/memory-jwks.js';
import { createOauthPorts, oauthNow } from './__fixtures__/oauth-fixtures.js';

describe('OAuth well-known handlers', () => {
  it('returns OpenID configuration with API-origin endpoint URLs', async () => {
    const { ports } = await createOauthPorts();
    const router = createWellKnownRouter({ issuer: 'http://localhost:9197', ports });

    const response = await router.request('/openid-configuration');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authorization_endpoint: 'http://localhost:9197/api/v1/auth/oauth/authorize',
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'client_credentials'],
      id_token_signing_alg_values_supported: ['EdDSA'],
      issuer: 'http://localhost:9197',
      jwks_uri: 'http://localhost:9197/.well-known/jwks.json',
      response_types_supported: ['code'],
      token_endpoint: 'http://localhost:9197/api/v1/auth/oauth/token',
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      userinfo_endpoint: 'http://localhost:9197/api/v1/auth/oauth/userinfo',
    });
  });

  it('returns public JWKS with cache headers and rotated keys', async () => {
    const { ports } = await createOauthPorts();
    ports.jwks = createMemoryJwksPort([
      await createJwksKeyRecord({ active: true, kid: 'active-kid', now: oauthNow }),
      await createJwksKeyRecord({ active: false, kid: 'rotated-kid', now: oauthNow }),
    ]);
    const router = createWellKnownRouter({ issuer: 'http://localhost:9197', ports });

    const response = await router.request('/jwks.json');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    const body = (await response.json()) as { keys: Array<{ kid: string; status: string }> };
    expect(body.keys.map((key) => [key.kid, key.status])).toEqual([
      ['active-kid', 'active'],
      ['rotated-kid', 'rotated'],
    ]);
  });
});
