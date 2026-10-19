import { expect, it, vi } from 'vitest';
import { createStatefulMcpNamespace, type VerifiedMcpRequest } from '../../src/compose/mcp-stateful.js';
import { createClusterMeshModules } from '../../src/modules/registry.js';
import { createArtifactsBuiltin, createArtifactsToolExecutor, type ArtifactsApp } from '../../src/integrations/mcp/artifacts.js';
import { makeStatefulHost } from './stateful-host.mjs';
import { fixture, makeRegistry, normalizeCorrelationId, openClient, optionsFor } from './stateful-fixture.mjs';

it('wraps the installed 27-tool Immo and artifacts tuple with verified authority', async () => {
  const modules = createClusterMeshModules();
  const handle = vi.fn<ArtifactsApp['handle']>(async () => ({ status: 200, body: { guide: 'qualified' } }));
  const definition = await createArtifactsBuiltin({ modules, definition: {
    app: { handle }, invocationScope: 'immo:read',
  } }).load();
  const tools = [...fixture.tools, ...definition.manifest.tools.map(({ name, description, inputSchema }) =>
    ({ name, description, inputSchema }))];
  const registry = makeRegistry(fixture.tools, [], [{ definition, parameters: { defaultStorageScopeId: 'scope-1' } }]);
  const executor = createArtifactsToolExecutor({ app: { handle } });
  const host = makeStatefulHost(tools);
  const tokenRef = { value: await host.token() };
  const connection = await openClient(host, tokenRef);
  const session = connection.transport.sessionId;
  let allowed = true;
  await createStatefulMcpNamespace(modules, optionsFor(host.host, 'http', {
    tools, registry, authorize: async () => allowed,
    invoke: async (name: string, args: Record<string, unknown>, context: VerifiedMcpRequest) => {
      if (!name.startsWith('artifacts_')) return structuredClone(fixture.captures.http.calls[name].result);
      const result = await executor.invoke({ tool: name, args, actorId: context.principal.sub });
      return { content: [{ type: 'text', text: JSON.stringify(result.body) }] };
    },
  }));
  try {
    expect((await connection.client.listTools()).tools).toEqual(tools);
    expect(tools).toHaveLength(27);
    for (const [name, captured] of Object.entries(fixture.captures.http.calls)) {
      const call = captured as { args: Record<string, unknown>; result: unknown };
      expect(normalizeCorrelationId(await connection.client.callTool({ name, arguments: call.args })))
        .toEqual(normalizeCorrelationId(call.result));
    }
    expect(await connection.client.callTool({ name: 'artifacts_get_api_guide', arguments: {} }))
      .toEqual({ content: [{ type: 'text', text: '{"guide":"qualified"}' }] });
    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0][0].actorId).toBe('owner');
    expect(JSON.stringify(handle.mock.calls)).not.toContain(tokenRef.value);
    allowed = false;
    expect((await connection.client.callTool({ name: 'artifacts_get_api_guide', arguments: {} })).isError).toBe(true);
    expect(handle).toHaveBeenCalledOnce();
    expect(connection.transport.sessionId).toBe(session);
    expect(host.stats).toMatchObject({ servers: 1, transports: 1, sdkCredentials: 0 });
  } finally { await connection.close(); await host.close(); }
});
