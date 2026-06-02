import { describe, expect, it } from 'vitest';

import { app } from '../../../src/app';
import { env } from '../../../src/config/env';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';

const allowedOrigin = env.CORS_ALLOWED_ORIGINS.split(',')[0]?.trim() ?? 'http://localhost:5173';

describe('OAuth well-known routes', () => {
  it('serves OIDC discovery at the root well-known path with the request origin issuer', async () => {
    const res = await app.request('http://localhost:9197/.well-known/openid-configuration', {
      headers: { Origin: allowedOrigin },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    const payload = await res.json();
    expect(payload.issuer).toBe('http://localhost:9197');
    expect(payload.authorization_endpoint).toBe(
      'http://localhost:9197/api/v1/auth/oauth/authorize',
    );
    expect(payload.token_endpoint).toBe('http://localhost:9197/api/v1/auth/oauth/token');
    expect(payload.jwks_uri).toBe('http://localhost:9197/.well-known/jwks.json');
    expect(payload.grant_types_supported).toEqual(['authorization_code']);
    expect(payload.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('serves the public JWKS with a cache header', async () => {
    await ensureActiveSigningKey('test-wellknown-kid');

    const res = await app.request('http://localhost:9197/.well-known/jwks.json', {
      headers: { Origin: allowedOrigin },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const payload = await res.json();
    expect(payload.keys).toEqual(expect.arrayContaining([
      expect.objectContaining({
        alg: 'EdDSA',
        crv: 'Ed25519',
        kty: 'OKP',
        use: 'sig',
      }),
    ]));
  });
});

const ensureActiveSigningKey = async (kid: string): Promise<void> => {
  const jwks = createJwksAdapter();
  if (await jwks.getActiveKey()) return;
  try {
    await jwks.generateAndStoreNewKey({ kid });
  } catch (error) {
    if (!String(error).includes('duplicate key value')) throw error;
  }
};
