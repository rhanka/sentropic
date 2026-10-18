import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createLocalJWKSet, exportJWK, jwtVerify, SignJWT, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpOAuthNamespace, type McpOAuthNamespaceOptions } from '../../../../src/compose/mcp-oauth.js';
import { TokenExchangeHttpIssuer } from '../../../../src/index.js';
import { fixture, initialize, issuer, post, resource, tools } from './host.js';
import { serve } from './http.js';

/** The same source scenario runs on the ordinary SDK and on Radar's installed SDK/Hono patches. */
export async function runHttpScenario(factory: typeof createMcpOAuthNamespace = createMcpOAuthNamespace) {
  const { modules, options, token, keys } = await fixture();
  const apiAudience = 'https://preprod.immo.example';
  const workload = 'immo-mcp-workload';
  const requiredAcr = 'urn:sentropic:loa:passkey-fresh';
  let minted = '', basic = '', grant = '';
  let mints = 0, apiCalls = 0;
  const cleanup: (() => Promise<void>)[] = [];
  try {
    const idp = await serve(async (request) => {
      basic = request.headers.get('authorization') ?? '';
      const form = new URLSearchParams(await request.text());
      grant = form.get('grant_type') ?? '';
      const human = await jwtVerify(form.get('subject_token')!, keys.publicKey, { issuer, audience: resource });
      const now = Math.floor(Date.now() / 1000);
      minted = await new SignJWT({ sub: human.payload.sub, iss: issuer, aud: form.get('resource')!,
        scope: form.get('scope'), act: { sub: workload }, client_id: workload, iat: now, exp: now + 300,
      }).setProtectedHeader({ alg: 'RS256' }).sign(keys.privateKey);
      mints += 1;
      return Response.json({ access_token: minted, token_type: 'Bearer',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: form.get('scope'), expires_in: 300 });
    });
    cleanup.push(idp.close);
    const api = await serve(async (request) => {
      try {
        const { payload } = await jwtVerify((request.headers.get('authorization') ?? '').slice(7), keys.publicKey, { issuer, audience: apiAudience });
        assert.equal(payload.aud, apiAudience); assert.equal(payload.sub, 'alice');
        assert.equal(payload.client_id, workload); assert.equal((payload.act as { sub?: unknown })?.sub, workload);
        assert.equal(payload.scope, 'immo:search'); assert.equal(payload.acr, undefined);
        assert.equal(request.method, 'GET'); assert.equal(new URL(request.url).pathname, '/api/graph-signals/longueuil');
        apiCalls += 1;
        return Response.json({ signals: [{ id: 'synthetic-signal' }] });
      } catch { return Response.json({ error: 'invalid_token' }, { status: 401 }); }
    });
    cleanup.push(api.close);
    const jwks = { keys: [await exportJWK(keys.publicKey)] };
    const makeIssuer = () => new TokenExchangeHttpIssuer({
      tokenEndpoint: `${idp.url}/oauth/token`, issuer, workloadClientId: workload,
      clientSecret: 'synthetic-workload-secret', actorSub: workload, allowLoopbackHttp: true, jwks,
      crypto: { createKeySet: (document) => createLocalJWKSet(document as JSONWebKeySet),
        verifyJwt: async (jwt, key, verification) => (await jwtVerify(jwt, key as JWTVerifyGetKey, verification)).payload },
    });
    const composition: McpOAuthNamespaceOptions = { ...options, requiredAcr, exchange: {
      issuer: makeIssuer(), workloadClientId: workload, workloadActorSub: workload, policyRevision: 'http-1',
      profiles: { signals: { tool: 'search_signals', method: 'GET', origin: api.url, audience: apiAudience,
        pathTemplate: '/api/graph-signals/:city', requiredScopes: ['immo:search'], validateParams: (params) => params } },
    }, invoke: async (tool, args, call) => tool === 'search_signals'
      ? { ok: true, output: (await call.egress.request('signals', { city: String(args.city) })).body,
        auditId: call.correlationId, redactionClass: 'low' } : options.invoke(tool, args, call) };
    let secured = await factory(modules, composition);
    cleanup.push(() => secured.close());
    let app = new Hono().route('/', secured.metadataRoutes).route('/mcp', secured.mcpRoutes);
    let mcp = await serve((request) => app.fetch(request));
    cleanup.push(() => mcp.close());
    const bearer = await token({ acr: requiredAcr });
    const insufficient = await fetch(`${mcp.url}/mcp`, post(initialize(), await token()));
    assert.equal(insufficient.status, 401);
    assert.match(insufficient.headers.get('www-authenticate')!, /insufficient_user_authentication/u);
    const client = new Client({ name: 'existing-client', version: '1' });
    cleanup.push(() => client.close());
    const transport = () => new StreamableHTTPClientTransport(new URL(`${mcp.url}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    });
    await client.connect(transport());
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), tools.map((tool) => tool.name));
    const result = await client.callTool({ name: 'search_signals', arguments: { city: 'longueuil' } });
    assert.deepEqual(JSON.parse((result.content as { text: string }[])[0]!.text), { signals: [{ id: 'synthetic-signal' }] });
    assert.equal(basic, `Basic ${Buffer.from(`${workload}:synthetic-workload-secret`).toString('base64')}`);
    assert.equal(grant, 'urn:ietf:params:oauth:grant-type:token-exchange');
    assert.equal(mints, 1); assert.equal(apiCalls, 1);
    assert.equal((await fetch(`${api.url}/api/graph-signals/longueuil`, {
      headers: { authorization: `Bearer ${bearer}` },
    })).status, 401);
    assert.equal((await fetch(`${mcp.url}/mcp`, post(initialize(), minted))).status, 401);
    await client.callTool({ name: 'get_zones_geojson', arguments: { city: 'longueuil' } });
    const stub = await client.callTool({ name: 'search_lots', arguments: { city: 'longueuil' } });
    assert.equal(stub.isError, true); assert.equal(stub._meta?.errorCode, 'not_wired_yet');
    assert.equal(mints, 1); assert.equal(apiCalls, 1);
    const address = mcp.url;
    await secured.close(); await mcp.close();
    secured = await factory(modules, { ...composition, exchange: { ...composition.exchange!, issuer: makeIssuer() } });
    app = new Hono().route('/', secured.metadataRoutes).route('/mcp', secured.mcpRoutes);
    mcp = await serve((request) => app.fetch(request), Number(new URL(address).port));
    assert.equal(mcp.url, address);
    await assert.rejects(client.callTool({ name: 'search_signals', arguments: { city: 'longueuil' } }), { code: 404 });
    // The automated client reinitializes its transport; SDK itself reports 404, without a new login.
    await client.close(); await client.connect(transport());
    assert.equal((await client.callTool({ name: 'search_signals', arguments: { city: 'longueuil' } })).isError, false);
    assert.equal(mints, 2); assert.equal(apiCalls, 2);
    return { mints, apiCalls, tools: tools.length, assurance: 'enforced' };
  } finally {
    const results = await Promise.allSettled(cleanup.reverse().map((close) => close()));
    for (const result of results) assert.equal(result.status, 'fulfilled');
  }
}
