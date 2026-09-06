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
      'http://localhost:9197/api/v1/oauth/authorize',
    );
    expect(payload.token_endpoint).toBe('http://localhost:9197/api/v1/oauth/token');
    expect(payload.jwks_uri).toBe('http://localhost:9197/.well-known/jwks.json');
    expect(payload.end_session_endpoint).toBe(
      'http://localhost:9197/api/v1/oauth/end_session',
    );
    expect(payload.grant_types_supported).toEqual(['authorization_code', 'client_credentials']);
    expect(payload.code_challenge_methods_supported).toEqual(['S256']);
    expect(payload.prompt_values_supported).toEqual([
      'none',
      'login',
      'consent',
      'select_account',
    ]);
  });

  it('serves the RFC 8414 AS-metadata alias at /.well-known/oauth-authorization-server (N1 forward)', async () => {
    const res = await app.request(
      'http://localhost:9197/.well-known/oauth-authorization-server',
      { headers: { Origin: allowedOrigin } },
    );

    expect(res.status).toBe(200);
    const payload = await res.json();
    // Same source of truth as OIDC discovery (the api well-known router forwards to auth-hono).
    expect(payload.issuer).toBe('http://localhost:9197');
    expect(payload.authorization_endpoint).toBe(
      'http://localhost:9197/api/v1/oauth/authorize',
    );
    expect(payload.token_endpoint).toBe('http://localhost:9197/api/v1/oauth/token');
    expect(payload.jwks_uri).toBe('http://localhost:9197/.well-known/jwks.json');
    // RFC 9207 iss mix-up defense advertised; NO DCR (registration_endpoint absent).
    expect(payload.authorization_response_iss_parameter_supported).toBe(true);
    expect(payload.registration_endpoint).toBeUndefined();
  });

  it('advertises the MCP scope grammar it can actually grant', async () => {
    const res = await app.request(
      'http://localhost:9197/.well-known/oauth-authorization-server',
      { headers: { Origin: allowedOrigin } },
    );

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { scopes_supported: string[] };

    // A client that cross-checks its requested scopes against this list refuses one that is
    // missing, even though `authorize` would have granted it — the grant is gated on the client's
    // own allowlist (`authorize-handler.ts:358`), not on this document. Advertising a scope the AS
    // can grant is what keeps the two consistent.
    expect(payload.scopes_supported).toEqual(
      expect.arrayContaining(['mcp:discover', 'mcp:resources:read', 'mcp:tools:invoke']),
    );
    // The OIDC core is still there — the MCP scopes are additive, not a replacement.
    expect(payload.scopes_supported).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email']),
    );
    // No duplicates: the union is deduplicated, so a repeated value would signal the merge broke.
    expect(new Set(payload.scopes_supported).size).toBe(payload.scopes_supported.length);
  });

  it('mounts the advertised end_session endpoint (route reachable, not 404)', async () => {
    // The discovery doc advertises /api/v1/oauth/end_session; assert the host actually wires
    // the GET route. An unauthenticated, navigation-style request returns the logged-out page (200),
    // never a 404, proving the handler is mounted (host-wiring guard).
    const res = await app.request('http://localhost:9197/api/v1/oauth/end_session', {
      headers: { 'Sec-Fetch-Mode': 'navigate' },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('signed out');
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
