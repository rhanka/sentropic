/**
 * oauth-register-client.test.ts — BR-39l Lot 6.
 *
 * Unit-tests the pure `buildOAuthClientRegistration` env→values builder of the prod-safe OAuth
 * client registration script, focused on the new RFC 8707 `resource_indicators` support and the
 * preserved prod-safe guards. No DB: the builder is side-effect-free and the script's DB upsert
 * only runs when the module is invoked directly.
 */
import { describe, expect, it } from 'vitest';

import { buildOAuthClientRegistration } from '../../src/scripts/oauth-register-client';

const baseEnv: NodeJS.ProcessEnv = {
  OAUTH_CLIENT_ID: 'immo-mcp',
  OAUTH_CLIENT_NAME: 'Immo MCP (claude.ai)',
  OAUTH_CLIENT_REDIRECT_URIS: 'https://claude.ai/api/mcp/auth_callback',
  OAUTH_CLIENT_SECRET: 'a-strong-generated-secret-value',
  OAUTH_CLIENT_SCOPES: 'openid,immo:read,immo:search,immo:documents:read',
  OAUTH_CLIENT_RESOURCE_INDICATORS: 'https://immo.sent-tech.ca/mcp',
};

describe('buildOAuthClientRegistration', () => {
  it('sets resource_indicators from OAUTH_CLIENT_RESOURCE_INDICATORS and keeps the static-client shape', () => {
    const values = buildOAuthClientRegistration({ ...baseEnv });

    expect(values.resourceIndicators).toEqual(['https://immo.sent-tech.ca/mcp']);
    expect(values.clientId).toBe('immo-mcp');
    expect(values.id).toBe('client-immo-mcp');
    expect(values.redirectUris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(values.allowedScopes).toEqual(['openid', 'immo:read', 'immo:search', 'immo:documents:read']);
    expect(values.grantTypes).toEqual(['authorization_code']);
    expect(values.requirePkce).toBe(true);
    expect(values.tokenEndpointAuthMethod).toBe('client_secret_basic');
  });

  it('parses multiple comma-separated resource indicators (trimming whitespace)', () => {
    const values = buildOAuthClientRegistration({
      ...baseEnv,
      OAUTH_CLIENT_RESOURCE_INDICATORS: 'https://a.example.com/mcp, https://b.example.com/mcp',
    });
    expect(values.resourceIndicators).toEqual(['https://a.example.com/mcp', 'https://b.example.com/mcp']);
  });

  it('defaults resource_indicators to [] (RFC 8707 default-deny) when the env var is absent', () => {
    const withoutRi: NodeJS.ProcessEnv = { ...baseEnv };
    delete withoutRi.OAUTH_CLIENT_RESOURCE_INDICATORS;
    const values = buildOAuthClientRegistration(withoutRi);
    expect(values.resourceIndicators).toEqual([]);
  });

  it('rejects a non-https resource indicator', () => {
    expect(() =>
      buildOAuthClientRegistration({
        ...baseEnv,
        OAUTH_CLIENT_RESOURCE_INDICATORS: 'http://immo.sent-tech.ca/mcp',
      }),
    ).toThrow(/resource indicators/i);
  });

  it('hashes the client secret (sha256) and never stores plaintext', () => {
    const values = buildOAuthClientRegistration({ ...baseEnv });
    expect(values.clientSecretHash).not.toContain('a-strong-generated-secret-value');
    expect(values.clientSecretHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the prod-safe guards (localhost redirect + dev-only secret)', () => {
    expect(() =>
      buildOAuthClientRegistration({ ...baseEnv, OAUTH_CLIENT_REDIRECT_URIS: 'http://localhost:5173/cb' }),
    ).toThrow(/insecure\/localhost/i);
    expect(() =>
      buildOAuthClientRegistration({ ...baseEnv, OAUTH_CLIENT_SECRET: 'dev-only-secret' }),
    ).toThrow(/dev-only/i);
  });

  it('mints a PUBLIC client (token_endpoint_auth_method=none, PKCE, no secret) in none-mode', () => {
    const publicEnv: NodeJS.ProcessEnv = { ...baseEnv, OAUTH_CLIENT_TOKEN_AUTH: 'none' };
    delete publicEnv.OAUTH_CLIENT_SECRET;
    const values = buildOAuthClientRegistration(publicEnv);

    expect(values.tokenEndpointAuthMethod).toBe('none');
    expect(values.clientSecretHash).toBeNull();
    expect(values.requirePkce).toBe(true);
    expect(values.grantTypes).toEqual(['authorization_code']);
    expect(values.resourceIndicators).toEqual(['https://immo.sent-tech.ca/mcp']);
  });

  it('keeps confidential (client_secret_basic) as the default and still requires a secret', () => {
    const values = buildOAuthClientRegistration({ ...baseEnv });
    expect(values.tokenEndpointAuthMethod).toBe('client_secret_basic');

    const noSecret: NodeJS.ProcessEnv = { ...baseEnv };
    delete noSecret.OAUTH_CLIENT_SECRET;
    expect(() => buildOAuthClientRegistration(noSecret)).toThrow(/OAUTH_CLIENT_SECRET/);
  });

  it('rejects an unsupported OAUTH_CLIENT_TOKEN_AUTH value', () => {
    expect(() =>
      buildOAuthClientRegistration({ ...baseEnv, OAUTH_CLIENT_TOKEN_AUTH: 'private_key_jwt' }),
    ).toThrow(/OAUTH_CLIENT_TOKEN_AUTH/);
  });
});
