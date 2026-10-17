import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpOAuthNamespace, type McpOAuthNamespace } from '../src/compose/mcp-oauth.js';
import { fixture, initialize, post, rpc } from './packaging/fixtures/mcp-oauth/host.js';

const live: McpOAuthNamespace[] = [];
afterEach(async () => { await Promise.all(live.splice(0).map((secured) => secured.close())); });

describe('MCP OAuth session authority', () => {
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
