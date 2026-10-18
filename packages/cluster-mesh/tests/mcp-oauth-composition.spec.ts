import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpOAuthNamespace, type McpOAuthNamespace } from '../src/compose/mcp-oauth.js';
import { fixture, initialize, issuer, post, resource, rpc, tools } from './packaging/fixtures/mcp-oauth/host.js';

const live: McpOAuthNamespace[] = [];
afterEach(async () => { await Promise.all(live.splice(0).map((secured) => secured.close())); });

describe('MCP OAuth composition', () => {
  it('should reject incomplete trusted verifier or issuer bindings before listening', async () => {
    const { modules, options } = await fixture();
    const retain = (secured: McpOAuthNamespace) => { live.push(secured); return secured; };
    await expect(createMcpOAuthNamespace(modules, { ...options,
      keySource: { resolveKey: undefined as never },
    }).then(retain)).rejects.toThrow();
    await expect(createMcpOAuthNamespace(modules, { ...options, exchange: {
      issuer: undefined as never, workloadClientId: 'workload', workloadActorSub: 'workload', policyRevision: '1',
      profiles: { signals: { tool: 'search_signals', method: 'GET', origin: 'https://api.example',
        audience: 'https://api.example', pathTemplate: '/signals/:city', requiredScopes: ['immo:search'],
        validateParams: (params) => params } },
    } }).then(retain)).rejects.toThrow();
  });

  it('should preserve twelve wire schemas/defaults while validating real Radar tuples and bounds', async () => {
    const { modules, options, token } = await fixture();
    const secured = await createMcpOAuthNamespace(modules, options); live.push(secured);
    const router = secured.module.createRouter({
      context: { verify: async () => { throw new Error('unused host context'); } },
      receipts: { append: async () => undefined },
    });
    expect(router).toBe(secured.mcpRoutes);
    const app = new Hono().route('/mcp', router);
    const bearer = await token();
    const session = (await app.request('/mcp', post(initialize(), bearer))).headers.get('mcp-session-id')!;
    const list = await (await app.request('/mcp', post(rpc('tools/list'), bearer, session))).json();
    expect(list.result.tools).toEqual(tools.map((tool) => ({ name: tool.name,
      description: tool.description, inputSchema: tool.schema,
    })));
    const call = async (name: string, args: Record<string, unknown>) =>
      (await app.request('/mcp', post(rpc('tools/call', { name, arguments: args }), bearer, session))).json();
    const valid = await call('get_zones_geojson', { city: 'longueuil', bbox: [-74, 45, -73, 46] });
    expect(JSON.parse(valid.result.content[0].text).args.limit).toBe(500);
    for (const args of [{ city: 'longueuil', bbox: [1, 2, 3] }, { city: 'longueuil', limit: 2001 }, { city: 'longueuil', surprise: true }]) {
      expect((await call('get_zones_geojson', args)).result._meta.errorCode).toBe('invalid_parameters');
    }
  });

  it('should check current account approval on raw tools and stubs and redact thrown host errors', async () => {
    const { modules, options, token } = await fixture();
    let approved = true;
    const invoke = vi.fn(options.invoke);
    const secured = await createMcpOAuthNamespace(modules, { ...options, invoke,
      resolveAccount: async () => approved ? { allowed: true } : { allowed: false, reason: 'private-account-reason' },
    }); live.push(secured);
    const app = new Hono().route('/mcp', secured.mcpRoutes);
    const bearer = await token();
    const session = (await app.request('/mcp', post(initialize(), bearer))).headers.get('mcp-session-id')!;
    const call = async (name: string) => (await app.request('/mcp', post(rpc('tools/call', {
      name, arguments: { city: 'longueuil' },
    }), bearer, session))).json();
    expect((await call('get_zones_geojson')).result.isError).toBe(false);
    approved = false;
    for (const name of ['get_zones_geojson', 'search_lots']) {
      const denied = await call(name);
      expect(denied.result._meta.errorCode).toBe('account_denied');
      expect(JSON.stringify(denied)).not.toContain('private-account-reason');
    }
    expect(invoke).toHaveBeenCalledTimes(1);
    approved = true;
    invoke.mockRejectedValue(new Error('private-host-error'));
    const failure = await call('get_zones_geojson');
    expect(failure.result._meta.errorCode).toBe('invocation_failed');
    expect(JSON.stringify(failure)).not.toContain('private-host-error');
  });

  it('should fail closed on configured human assurance and accept the matching signed ACR', async () => {
    const { modules, options, token } = await fixture();
    const requiredAcr = 'urn:sentropic:loa:passkey-fresh';
    const secured = await createMcpOAuthNamespace(modules, { ...options, requiredAcr }); live.push(secured);
    const app = new Hono().route('/mcp', secured.mcpRoutes);
    for (const acr of [undefined, 'urn:sentropic:loa:bearer']) {
      const response = await app.request('/mcp', post(initialize(), await token({ acr })));
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('insufficient_user_authentication');
    }
    expect((await app.request('/mcp', post(initialize(), await token({ acr: requiredAcr })))).status).toBe(200);
  });

  it('should retain optional-client ingress and refuse conflicting signed clients', async () => {
    const { modules, options, token } = await fixture();
    const secured = await createMcpOAuthNamespace(modules, options); live.push(secured);
    const app = new Hono().route('/mcp', secured.mcpRoutes);
    for (const claims of [{ client_id: undefined }, { client_id: 'other-registered-client' }, { azp: 'immo-mcp' }]) {
      expect((await app.request('/mcp', post(initialize(), await token(claims)))).status).toBe(200);
    }
    expect((await app.request('/mcp', post(initialize(), await token({ azp: 'different' })))).status).toBe(401);
    await expect(createMcpOAuthNamespace(modules, { ...options, resolveAccount: undefined as never })).rejects.toThrow();
    await expect(createMcpOAuthNamespace(modules, { ...options, requiredAcr: '' })).rejects.toThrow();
    await expect(createMcpOAuthNamespace(modules, { ...options, tools: [...options.tools, options.tools[0]!] })).rejects.toThrow();
  });

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

  it.each([
    ['multiple audiences', { aud: [resource, 'https://other.example'] }, 'Invalid MCP resource identity.'],
    ['missing subject', { sub: undefined }, 'Invalid MCP resource identity.'],
    ['missing expiry', { exp: undefined }, 'Invalid MCP resource identity.'],
    ['conflicting clients', { azp: 'other-client' }, 'Invalid MCP resource identity.'],
    ['missing assurance', { acr: undefined }, 'insufficient_user_authentication'],
  ] as const)('should reject %s before checking ingress scopes', async (_label, invalid, message) => {
    const { modules, options, token } = await fixture();
    const requiredAcr = 'urn:sentropic:loa:passkey-fresh';
    const secured = await createMcpOAuthNamespace(modules, { ...options, requiredAcr }); live.push(secured);
    const app = new Hono().route('/mcp', secured.mcpRoutes);
    for (const scope of ['immo:read immo:search', 'immo:search']) {
      const response = await app.request('/mcp', post(initialize(), await token({ acr: requiredAcr, ...invalid, scope })));
      expect(response.status).toBe(401);
      const challenge = response.headers.get('www-authenticate');
      expect(challenge).toContain('Bearer error="invalid_token"');
      expect(challenge).toContain(`error_description="${message}"`);
      expect(challenge).toContain('resource_metadata="https://preprod.immo.example/.well-known/oauth-protected-resource/mcp"');
      expect(challenge).not.toContain('scope=');
    }
  });

  it('should distinguish missing scope from invalid or multi-audience tokens', async () => {
    const { modules, options, token } = await fixture();
    const secured = await createMcpOAuthNamespace(modules, options); live.push(secured);
    const app = new Hono().route('/mcp', secured.mcpRoutes);
    const denied = await app.request('/mcp', post(initialize(), await token({ scope: 'immo:search' })));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('www-authenticate')).toContain('Bearer error="insufficient_scope"');
    expect(denied.headers.get('www-authenticate')).toContain('scope="immo:read"');
    expect(denied.headers.get('www-authenticate')).toContain('resource_metadata="https://preprod.immo.example/.well-known/oauth-protected-resource/mcp"');
    for (const claims of [{ aud: [resource, 'https://other.example'] }, { iss: 'https://other.example' }, { sub: '' }]) {
      expect((await app.request('/mcp', post(initialize(), await token(claims)))).status).toBe(401);
    }
  });
});
