import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@sentropic/oauth-verify', () => {
  class TokenVerifyError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TokenVerifyError';
    }
  }
  class DpopVerifyError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DpopVerifyError';
    }
  }
  return {
    TokenVerifyError,
    DpopVerifyError,
    fromRemoteJwks: vi.fn(() => ({ resolveKey: vi.fn() })),
    verifyAccessToken: vi.fn(),
    verifyDpopProof: vi.fn(),
  };
});

import { verifyAccessToken } from '@sentropic/oauth-verify';
import { createMcpAuth } from '../src/core.js';
import { mcpAuthRoutes, requireMcpAuth, getMcpAuthContext } from '../src/hono.js';

const RESOURCE = 'https://mcp.example.com';
const AS = 'https://auth.sent-tech.ca';

const buildApp = () => {
  const mcp = createMcpAuth({
    resource: RESOURCE,
    authorizationServers: [AS],
    scopesSupported: ['mcp:tools:invoke'],
  });
  const app = new Hono();
  app.route('/', mcpAuthRoutes(mcp));
  app.use('/mcp/*', requireMcpAuth(mcp, { requiredScopes: ['mcp:tools:invoke'] }));
  app.post('/mcp/invoke', (c) => {
    const auth = getMcpAuthContext(c);
    return c.json({ ok: true, sub: auth.sub, scopes: auth.scopes });
  });
  return app;
};

beforeEach(() => {
  vi.mocked(verifyAccessToken).mockReset();
});

describe('@sentropic/mcp-auth/hono', () => {
  it('mounts the RFC 9728 PRM well-known route', async () => {
    const app = buildApp();
    const res = await app.request('/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.resource).toBe(RESOURCE);
    expect(doc.authorization_servers).toEqual([AS]);
  });

  it('serves the RFC 9728 §3.1 canonical path + 308 shim for a path-ful resource (root mount)', async () => {
    const mcp = createMcpAuth({
      resource: 'https://immo.sent-tech.ca/mcp',
      authorizationServers: [AS],
    });
    const app = new Hono();
    app.route('/', mcpAuthRoutes(mcp));

    const canonical = await app.request('https://immo.sent-tech.ca/.well-known/oauth-protected-resource/mcp');
    expect(canonical.status).toBe(200);
    expect((await canonical.json()).resource).toBe('https://immo.sent-tech.ca/mcp');

    const shim = await app.request('https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource');
    expect(shim.status).toBe(308);
    expect(shim.headers.get('location')).toBe(
      'https://immo.sent-tech.ca/.well-known/oauth-protected-resource/mcp',
    );
  });

  it('keeps serving the mount-relative well-known when mounted UNDER the resource prefix', async () => {
    // Back-compat with the api sample router that mounts mcpAuthRoutes under /api/v1/mcp.
    const mcp = createMcpAuth({
      resource: 'https://api.example.com/api/v1/mcp',
      authorizationServers: [AS],
    });
    const app = new Hono();
    app.route('/api/v1/mcp', mcpAuthRoutes(mcp));
    const res = await app.request('https://api.example.com/api/v1/mcp/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect((await res.json()).resource).toBe('https://api.example.com/api/v1/mcp');
  });

  it('guards a protected route: 401 + PRM pointer without a token', async () => {
    const app = buildApp();
    const res = await app.request('/mcp/invoke', { method: 'POST' });
    expect(res.status).toBe(401);
    const www = res.headers.get('WWW-Authenticate')!;
    expect(www).toContain('error="invalid_token"');
    expect(www).toContain('resource_metadata=');
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('allows a valid token and exposes the context to the handler', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'user-7',
      iss: AS,
      aud: RESOURCE,
      exp: 0,
      iat: 0,
      scope: 'mcp:tools:invoke',
      client_id: 'cid',
    });
    const app = buildApp();
    const res = await app.request('/mcp/invoke', {
      method: 'POST',
      headers: { authorization: 'Bearer good' },
    });
    const next = await app.request('/mcp/invoke', {
      method: 'POST',
      headers: { authorization: 'Bearer next' },
    });
    expect(res.status).toBe(200);
    expect(next.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, sub: 'user-7', scopes: ['mcp:tools:invoke'] });
    expect(verifyAccessToken).toHaveBeenCalledTimes(2);
  });

  it('returns 403 insufficient_scope when the token lacks the required scope', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'user-7',
      iss: AS,
      aud: RESOURCE,
      exp: 0,
      iat: 0,
      scope: 'mcp:discover',
    });
    const app = buildApp();
    const res = await app.request('/mcp/invoke', {
      method: 'POST',
      headers: { authorization: 'Bearer scoped-out' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('WWW-Authenticate')).toContain('error="insufficient_scope"');
  });
});
