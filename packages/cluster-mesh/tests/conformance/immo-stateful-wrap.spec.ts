import { describe, expect, it, vi } from 'vitest';
import { createStatefulMcpNamespace } from '../../src/compose/mcp-stateful.js';
import { createClusterMeshPlugin } from '../../src/hono/plugin.js';
import { createClusterMeshModules } from '../../src/modules/registry.js';
import { makeStatefulHost } from './stateful-host.mjs';
import { fixture, optionsFor, openClient, normalizeCorrelationId } from './stateful-fixture.mjs';

describe.each(['http', 'simulation'] as const)('Immo native wire conformance: %s', mode => {
  it('keeps identity, discovery, every complete captured result and refreshed-scope refusals', async () => {
    const host = makeStatefulHost(fixture.tools);
    const tokenRef = { value: await host.token() };
    const invoke = vi.fn(optionsFor(host.host, mode).invoke);
    const wrapped = await createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host, mode, { invoke }));
    const plugin = createClusterMeshPlugin({
      runtime: { context: {}, receiptPort: {} } as never,
      namespaces: [wrapped], mounts: { '/mcp': '/' },
    });
    const connection = await openClient(host, tokenRef, plugin);
    try {
      const { client, transport } = connection;
      expect(client.getServerVersion()).toEqual(fixture.serverVersion);
      expect(client.getServerCapabilities()).toEqual(fixture.serverCapabilities);
      expect((await client.listTools()).tools).toEqual(fixture.tools);
      for (const [name, call] of Object.entries(fixture.captures[mode].calls)) {
        const captured = call as { args: Record<string, unknown>; result: unknown };
        expect(normalizeCorrelationId(await client.callTool({ name, arguments: captured.args })))
          .toEqual(normalizeCorrelationId(captured.result));
      }
      const session = transport.sessionId;
      tokenRef.value = await host.token({ scope: 'immo:read' });
      for (const [name, expected] of Object.entries(fixture.captures[mode].limitedScope.calls)) {
        const actual = await client.callTool({ name, arguments: fixture.captures[mode].calls[name].args });
        expect(normalizeCorrelationId(actual)).toEqual(normalizeCorrelationId(expected));
      }
      expect(transport.sessionId).toBe(session);
      expect(host.stats.servers).toBe(1);
      expect(host.stats.oldCalls).toBe(0);
      expect(host.stats.sdkCredentials).toBe(0);
      expect(JSON.stringify(invoke.mock.calls)).not.toContain(tokenRef.value);
      for (const route of ['/.well-known/oauth-protected-resource/mcp', '/mcp/.well-known/oauth-protected-resource']) {
        const response = await plugin.request(route);
        expect(response.status).toBe(200);
        expect((await response.json()).resource).toBe('http://immo.test/mcp');
      }
      expect((await plugin.request('/mcp/mcp')).status).toBe(404);
    } finally { await connection.close(); await host.close(); }
    expect(host.stats.closes).toBe(1);
  });
});
