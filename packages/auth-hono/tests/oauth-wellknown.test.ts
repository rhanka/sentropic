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
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      authorization_endpoint: 'http://localhost:9197/api/v1/auth/oauth/authorize',
      code_challenge_methods_supported: ['S256'],
      end_session_endpoint: 'http://localhost:9197/api/v1/auth/oauth/end_session',
      grant_types_supported: ['authorization_code', 'client_credentials'],
      id_token_signing_alg_values_supported: ['EdDSA'],
      issuer: 'http://localhost:9197',
      jwks_uri: 'http://localhost:9197/.well-known/jwks.json',
      prompt_values_supported: ['none', 'login', 'consent', 'select_account'],
      response_types_supported: ['code'],
      token_endpoint: 'http://localhost:9197/api/v1/auth/oauth/token',
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      userinfo_endpoint: 'http://localhost:9197/api/v1/auth/oauth/userinfo',
    });
    // RFC 9207: the AS advertises that it emits the authorization-response `iss` parameter.
    expect(payload.authorization_response_iss_parameter_supported).toBe(true);
    // DCR (RFC 7591) is deferred: never advertise a registration_endpoint (static clients only).
    expect(payload.registration_endpoint).toBeUndefined();
  });

  it('serves the RFC 8414 alias at /oauth-authorization-server with the identical metadata', async () => {
    const { ports } = await createOauthPorts();
    const router = createWellKnownRouter({ issuer: 'http://localhost:9197', ports });

    const oidcResponse = await router.request('/openid-configuration');
    const aliasResponse = await router.request('/oauth-authorization-server');
    expect(aliasResponse.status).toBe(200);

    const oidc = await oidcResponse.json();
    const alias = (await aliasResponse.json()) as Record<string, unknown>;

    expect(alias).toEqual(oidc);
    expect((alias as Record<string, unknown>).authorization_response_iss_parameter_supported).toBe(true);
    expect((alias as Record<string, unknown>).registration_endpoint).toBeUndefined();
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
