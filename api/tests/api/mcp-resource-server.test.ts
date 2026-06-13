import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/app';

// BR-39l Lot 3 — first real consumption of @sentropic/mcp-auth (activation-by-consumption).
// These integration tests exercise the unauthenticated surface of the sample MCP resource
// server: the default-OFF gate, the RFC 9728 PRM document, and the 401 + resource_metadata
// pointer challenge a client gets without a token. The authenticated round-trip activates
// once @sentropic/oauth-verify's verify primitives land (Lot 1).

describe('MCP resource server (BR-39l Lot 3)', () => {
  const original = process.env.MCP_RESOURCE_SERVER_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.MCP_RESOURCE_SERVER_ENABLED;
    else process.env.MCP_RESOURCE_SERVER_ENABLED = original;
  });

  describe('when disabled (default)', () => {
    beforeEach(() => {
      delete process.env.MCP_RESOURCE_SERVER_ENABLED;
    });

    it('returns 404 for the PRM well-known', async () => {
      const res = await app.request('/api/v1/mcp/.well-known/oauth-protected-resource');
      expect(res.status).toBe(404);
    });

    it('returns 404 for the guarded invoke endpoint', async () => {
      const res = await app.request('/api/v1/mcp/invoke', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('when enabled', () => {
    beforeEach(() => {
      process.env.MCP_RESOURCE_SERVER_ENABLED = 'true';
    });

    it('serves the RFC 9728 Protected Resource Metadata document', async () => {
      const res = await app.request('/api/v1/mcp/.well-known/oauth-protected-resource');
      expect(res.status).toBe(200);
      const doc = await res.json();
      expect(typeof doc.resource).toBe('string');
      expect(Array.isArray(doc.authorization_servers)).toBe(true);
      expect(doc.authorization_servers.length).toBeGreaterThan(0);
      expect(doc.bearer_methods_supported).toEqual(['header']);
      expect(doc.scopes_supported).toContain('mcp:tools:invoke');
    });

    it('challenges an unauthenticated request with 401 + a PRM pointer', async () => {
      const res = await app.request('/api/v1/mcp/invoke', { method: 'POST' });
      expect(res.status).toBe(401);
      const www = res.headers.get('WWW-Authenticate');
      expect(www).toBeTruthy();
      expect(www).toContain('error="invalid_token"');
      expect(www).toContain('resource_metadata=');
      expect(www).toContain('/.well-known/oauth-protected-resource');
    });

    it('challenges a malformed Authorization header with 401', async () => {
      const res = await app.request('/api/v1/mcp/invoke', {
        method: 'POST',
        headers: { authorization: 'Bearer' },
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    });
  });
});
