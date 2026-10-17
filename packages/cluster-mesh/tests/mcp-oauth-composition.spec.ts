import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpOAuthNamespace, type McpOAuthNamespace } from '../src/compose/mcp-oauth.js';
import { fixture, initialize, issuer, post, resource } from './packaging/fixtures/mcp-oauth/host.js';

const live: McpOAuthNamespace[] = [];
afterEach(async () => { await Promise.all(live.splice(0).map((secured) => secured.close())); });

describe('MCP OAuth composition', () => {
  it('should expose public canonical metadata and both qualified aliases without verifying keys', async () => {
    const { modules, options } = await fixture();
    const resolveKey = vi.fn(async () => { throw new Error('must stay lazy'); });
    const secured = await createMcpOAuthNamespace(modules, { ...options, keySource: { resolveKey } });
    live.push(secured);
    const app = new Hono().route('/', secured.metadataRoutes).route('/mcp', secured.mcpRoutes);
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      expect(await (await app.request(path)).json()).toMatchObject({ resource, authorization_servers: [issuer] });
    }
    const redirect = await app.request('/mcp/.well-known/oauth-protected-resource');
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe('https://preprod.immo.example/.well-known/oauth-protected-resource/mcp');
    const denied = await app.request('/mcp', post(initialize()));
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect(resolveKey).not.toHaveBeenCalled();
    expect((await app.request('/mcp/mcp', post(initialize()))).status).toBe(404);
  });

  it('should distinguish missing scope from invalid or multi-audience tokens', async () => {
    const { modules, options, token } = await fixture();
    const secured = await createMcpOAuthNamespace(modules, options); live.push(secured);
    const app = new Hono().route('/mcp', secured.mcpRoutes);
    const denied = await app.request('/mcp', post(initialize(), await token({ scope: 'immo:search' })));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('www-authenticate')).toContain('scope="immo:read"');
    for (const claims of [{ aud: [resource, 'https://other.example'] }, { iss: 'https://other.example' }, { sub: '' }]) {
      expect((await app.request('/mcp', post(initialize(), await token(claims)))).status).toBe(401);
    }
  });
});
