import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, jwtVerify, SignJWT, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpOAuthNamespace } from '../src/compose/mcp-oauth.js';
import { TokenExchangeHttpIssuer } from '../src/trust/token-exchange-http.js';
import { fixture, issuer, resource, tools } from './packaging/fixtures/mcp-oauth/host.js';
import { serve } from './packaging/fixtures/mcp-oauth/http.js';

describe('MCP OAuth real HTTP interoperability', () => {
  it('should exchange with Basic authentication and independently verify the API token', async () => {
    const { modules, options, token, keys } = await fixture();
    const apiAudience = 'https://preprod.immo.example';
    const workload = 'immo-mcp-workload';
    let minted = '';
    let basic = '';
    let grant = '';
    let mints = 0;
    let apiCalls = 0;
    const idp = await serve(async (request) => {
      basic = request.headers.get('authorization') ?? '';
      const form = new URLSearchParams(await request.text());
      grant = form.get('grant_type') ?? '';
      const human = await jwtVerify(form.get('subject_token')!, keys.publicKey, { issuer, audience: resource });
      const now = Math.floor(Date.now() / 1000);
      minted = await new SignJWT({ sub: human.payload.sub, iss: issuer, aud: form.get('resource'),
        scope: form.get('scope'), act: { sub: workload }, client_id: workload, iat: now, exp: now + 300,
      }).setProtectedHeader({ alg: 'RS256' }).sign(keys.privateKey);
      mints += 1;
      return Response.json({ access_token: minted, token_type: 'Bearer',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: form.get('scope'), expires_in: 300 });
    });
    const api = await serve(async (request) => {
      try {
        const { payload } = await jwtVerify((request.headers.get('authorization') ?? '').slice(7), keys.publicKey, { issuer, audience: apiAudience });
        if (payload.aud !== apiAudience || payload.sub !== 'alice' || payload.client_id !== workload
          || (payload.act as { sub?: unknown })?.sub !== workload || payload.scope !== 'immo:search'
          || request.method !== 'GET' || new URL(request.url).pathname !== '/api/graph-signals/longueuil') throw new Error();
        apiCalls += 1;
        return Response.json({ signals: [{ id: 'synthetic-signal' }] });
      } catch { return Response.json({ error: 'invalid_token' }, { status: 401 }); }
    });
    const exchangeIssuer = new TokenExchangeHttpIssuer({
      tokenEndpoint: `${idp.url}/oauth/token`, issuer, workloadClientId: workload,
      clientSecret: 'synthetic-workload-secret', actorSub: workload, allowLoopbackHttp: true,
      jwks: { keys: [await exportJWK(keys.publicKey)] }, crypto: {
        createKeySet: (jwks) => createLocalJWKSet(jwks as JSONWebKeySet),
        verifyJwt: async (jwt, key, verification) => (await jwtVerify(jwt, key as JWTVerifyGetKey, verification)).payload,
      },
    });
    const secured = await createMcpOAuthNamespace(modules, { ...options, exchange: {
      issuer: exchangeIssuer, workloadClientId: workload, workloadActorSub: workload, policyRevision: 'http-1',
      profiles: { signals: { tool: 'search_signals', method: 'GET', origin: api.url, audience: apiAudience,
        pathTemplate: '/api/graph-signals/:city', requiredScopes: ['immo:search'], validateParams: (params) => params } },
    }, invoke: async (tool, args, call) => tool === 'search_signals'
      ? { ok: true, output: (await call.egress.request('signals', { city: String(args.city) })).body,
        auditId: call.correlationId, redactionClass: 'low' }
      : options.invoke(tool, args, call) });
    const app = new Hono().route('/', secured.metadataRoutes).route('/mcp', secured.mcpRoutes);
    const mcp = await serve((request) => app.fetch(request));
    const bearer = await token();
    const client = new Client({ name: 'existing-client', version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${mcp.url}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      }));
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(tools.map((tool) => tool.name));
      const result = await client.callTool({ name: 'search_signals', arguments: { city: 'longueuil' } });
      expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({ signals: [{ id: 'synthetic-signal' }] });
      expect(basic).toBe(`Basic ${Buffer.from(`${workload}:synthetic-workload-secret`).toString('base64')}`);
      expect(grant).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
      expect(mints).toBe(1); expect(apiCalls).toBe(1);
    } finally {
      await client.close(); await secured.close(); await mcp.close(); await api.close(); await idp.close();
    }
  });
});
