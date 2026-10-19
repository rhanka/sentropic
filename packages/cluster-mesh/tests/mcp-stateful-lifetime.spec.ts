import { expect, it } from 'vitest';
import { createStatefulMcpNamespace } from '../src/compose/mcp-stateful.js';
import { createClusterMeshModules } from '../src/modules/registry.js';
import { makeStatefulHost } from './conformance/stateful-host.mjs';
import { fixture, optionsFor, openClient } from './conformance/stateful-fixture.mjs';

it('retains host owner checks, expiry boundaries and per-request authentication', async () => {
  const host = makeStatefulHost(fixture.tools, { idle: 10, absolute: 100 });
  await createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host));
  const ref = { value: await host.token() }, connection = await openClient(host, ref);
  const sid = connection.transport.sessionId!, entry = host.sessions.get(sid);
  const request = async (token: string | undefined, id = sid) => host.app.request('/mcp', {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'mcp-session-id': id,
      accept: 'text/event-stream' },
  });
  host.setNow(5);
  for (const token of [await host.token({ sub: 'foreign' }), await host.token({ azp: 'foreign' })]) {
    const response = await request(token);
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe('Unknown or expired MCP session');
    expect(entry.lastSeenAt).toBe(0);
  }
  for (const token of [undefined, await host.token({ exp: 1 }), await host.token({ aud: 'https://wrong.test/mcp' })]) {
    expect((await request(token)).status).toBe(401);
    expect(entry.lastSeenAt).toBe(0);
  }
  const missingScope = await request(await host.token({ scope: '' }));
  expect(missingScope.status).toBe(403);
  expect(missingScope.headers.get('www-authenticate')).toContain('insufficient_scope');
  expect(missingScope.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/mcp');
  expect((await request(ref.value, 'unknown')).status).toBe(404);
  host.setNow(10);
  ref.value = await host.token({ azp: undefined, scope: 'immo:read' });
  await connection.client.callTool({ name: 'get_lot_card', arguments: fixture.captures.http.calls.get_lot_card.args });
  expect(entry.lastSeenAt).toBe(10);
  expect(connection.transport.sessionId).toBe(sid);
  host.setNow(21);
  expect((await request(ref.value)).status).toBe(404);
  expect(host.stats.servers).toBe(1);
  expect(host.stats.closes).toBe(1);
  await connection.client.close(); await host.close();
  expect(host.stats.closes).toBe(1);
});

it('preserves the strict absolute boundary and cleans sweep, DELETE and abandoned initialization once', async () => {
  const host = makeStatefulHost(fixture.tools, { idle: 1_000, absolute: 100 });
  await createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host));
  const token = await host.token(), connection = await openClient(host, { value: token });
  host.setNow(100);
  await connection.client.listTools();
  expect(host.sessions.size).toBe(1);
  host.setNow(101); await host.sweep();
  expect(host.sessions.size).toBe(0);
  expect(host.stats.closes).toBe(1);
  await connection.client.close();
  const later = await openClient(host, { value: token });
  await later.close();
  expect(host.stats.closes).toBe(2);
  const before = host.stats.servers;
  for (const body of ['{', JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' })]) {
    expect((await host.app.request('/mcp', { method: 'POST',
      headers: { authorization: `Bearer ${token}` }, body })).status).toBe(400);
  }
  expect(host.stats.servers).toBe(before);
  const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
  const failed = await host.app.request('/mcp', { method: 'POST', body: initialize,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/plain' } });
  expect(failed.status).toBe(406);
  expect(host.stats.closes).toBe(3);
  await host.close();
  expect(host.stats.closes).toBe(3);
});
