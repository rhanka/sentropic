import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpOAuthNamespace, type McpOAuthNamespace } from '../src/compose/mcp-oauth.js';
import { fixture, initialize, post, rpc } from './packaging/fixtures/mcp-oauth/host.js';

const live: McpOAuthNamespace[] = [];
afterEach(async () => { await Promise.all(live.splice(0).map((secured) => secured.close())); });

describe('MCP OAuth session authority', () => {
  it('should isolate overlapping requests on the same session and apply current scopes immediately', async () => {
    const { modules, options, token } = await fixture();
    let arrived = 0;
    let ready!: () => void;
    let release!: () => void;
    const both = new Promise<void>((resolve) => { ready = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const secured = await createMcpOAuthNamespace(modules, { ...options, invoke: async (tool, args, call) => {
      if (++arrived === 2) ready();
      await gate;
      expect(Object.isFrozen(call.principal.scopes)).toBe(true);
      expect(Object.keys(call).sort()).toEqual(['correlationId', 'egress', 'principal']);
      return options.invoke(tool, args, call);
    } }); live.push(secured);
    const app = new Hono().route('/mcp', secured.mcpRoutes);
    const full = await token();
    const read = await token({ scope: 'immo:read' });
    const session = (await app.request('/mcp', post(initialize(), full))).headers.get('mcp-session-id')!;
    const calls = [full, read].map((bearer, index) => app.request('/mcp', post(rpc('tools/call', {
      name: 'get_zones_geojson', arguments: { city: 'longueuil' },
    }, index + 2), bearer, session)));
    await both; release();
    const results = await Promise.all(calls.map(async (pending) => {
      const body = await (await pending).json();
      return JSON.parse(body.result.content[0].text);
    }));
    expect(results[0].scopes).toContain('immo:search');
    expect(results[1].scopes).toEqual(['immo:read']);
    const denied = await (await app.request('/mcp', post(rpc('tools/call', {
      name: 'search_signals', arguments: { city: 'longueuil' },
    }, 4), read, session))).json();
    expect(denied.result.isError).toBe(true);
    expect(denied.result._meta.errorCode).toBe('insufficient_scope');
    expect(arrived).toBe(2);
  });

  it('should enforce idle and absolute deadlines, close SSE/DELETE and refuse work after shutdown', async () => {
    const { modules, options, token } = await fixture();
    let now = 0;
    const secured = await createMcpOAuthNamespace(modules, { ...options,
      sessions: { ...options.sessions, nowMs: () => now, idleTimeoutMs: 1000, maxLifetimeMs: 3000 },
    }); live.push(secured);
    const app = new Hono().route('/mcp', secured.mcpRoutes);
    const bearer = await token();
    const start = async () => (await app.request('/mcp', post(initialize(), bearer))).headers.get('mcp-session-id')!;
    let session = await start();
    const list = () => app.request('/mcp', post(rpc('tools/list'), bearer, session));
    now = 999; expect((await list()).status).toBe(200);
    now = 1999; expect((await list()).status).toBe(404);
    session = await start();
    for (const time of [2899, 3799, 4699]) { now = time; expect((await list()).status).toBe(200); }
    now = 4999; expect((await list()).status).toBe(404);
    session = await start();
    const headers = { authorization: `Bearer ${bearer}`, 'mcp-session-id': session,
      accept: 'text/event-stream', 'mcp-protocol-version': '2025-03-26' };
    const stream = await app.request('/mcp', { headers });
    expect(stream.status).toBe(200);
    await stream.body?.cancel();
    expect((await app.request('/mcp', { method: 'DELETE', headers })).status).toBe(200);
    expect((await list()).status).toBe(404);
    await secured.close(); await secured.close();
    expect((await app.request('/mcp', post(initialize(), bearer))).status).toBe(503);
  });

  it('should bind every session method to the verified human and optional client', async () => {
    const { modules, options, token } = await fixture();
    const secured = await createMcpOAuthNamespace(modules, options); live.push(secured);
    const app = new Hono().route('/mcp', secured.mcpRoutes);
    const first = await app.request('/mcp', post(initialize(), await token()));
    expect(first.status).toBe(200);
    const session = first.headers.get('mcp-session-id')!;
    expect(session).toBeTruthy();
    for (const claims of [{ sub: 'bob' }, { client_id: 'another-client' }]) {
      for (const method of ['POST', 'GET', 'DELETE']) {
        const init = post(rpc('tools/list'), await token(claims), session);
        const response = await app.request('/mcp', { ...init, method, ...(method === 'POST' ? {} : { body: undefined }) });
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: { code: 'session_not_found', message: 'MCP session not found.' } });
      }
    }
    expect((await app.request('/mcp', post(rpc('tools/list'), await token(), session))).status).toBe(200);
  });
});
