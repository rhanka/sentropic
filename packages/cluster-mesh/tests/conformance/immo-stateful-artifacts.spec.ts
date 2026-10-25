import { expect, it, vi } from 'vitest';
import { createStatefulMcpNamespace, type VerifiedMcpRequest } from '../../src/compose/mcp-stateful.js';
import { createClusterMeshModules } from '../../src/modules/registry.js';
import { createArtifactsBuiltin, createArtifactsToolExecutor, type ArtifactsApp } from '../../src/integrations/mcp/artifacts.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '@sentropic/artifacts/mcp';
import { makeStatefulHost } from './stateful-host.mjs';
import { fixture, makeRegistry, normalizeCorrelationId, openClient, optionsFor } from './stateful-fixture.mjs';

it('wraps the selected Immo and artifacts tuple with verified authority', async () => {
  const modules = createClusterMeshModules();
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const execute = vi.fn<ArtifactsApp['execute']>(async () => ({ ok: true,
    result: { status: 200, body: { artifact: 'qualified' } }, invocationId: 'probe',
    commitState: 'not_committed', replayed: false }));
  const app = { execute, profileDigest: profile.profileDigest, selectedCapabilities: profile.selectedCapabilities };
  const invocation = (actorId: string) => ({ invocationId: 'probe', actorId, storageScopeId: 'scope-1',
    authorizeCommit: async () => { throw new Error('unexpected guard for read'); } });
  const definition = await createArtifactsBuiltin({ modules, definition: {
    app, profile, createInvocation: (request) => invocation(request.ctx.principal.sub), invocationScope: 'immo:read',
  } }).load();
  const tools = [...fixture.tools, ...definition.manifest.tools.map(({ name, description, inputSchema }) =>
    ({ name, description, inputSchema }))];
  const registry = makeRegistry(fixture.tools, [], [{ definition, parameters: {} }]);
  const executor = createArtifactsToolExecutor({ app, profile });
  const host = makeStatefulHost(tools);
  const tokenRef = { value: await host.token() };
  const connection = await openClient(host, tokenRef);
  const session = connection.transport.sessionId;
  let allowed = true;
  await createStatefulMcpNamespace(modules, optionsFor(host.host, 'http', {
    tools, registry, authorize: async () => allowed,
    invoke: async (name: string, args: Record<string, unknown>, context: VerifiedMcpRequest) => {
      if (!name.startsWith('artifacts_')) return structuredClone(fixture.captures.http.calls[name].result);
      const result = await executor.invoke({ tool: name, args, invocation: invocation(context.principal.sub) });
      return { content: [{ type: 'text', text: JSON.stringify(result.body) }] };
    },
  }));
  try {
    expect((await connection.client.listTools()).tools).toEqual(tools);
    expect(tools).toHaveLength(fixture.tools.length + profile.selectedCapabilities.length);
    for (const [name, captured] of Object.entries(fixture.captures.http.calls)) {
      const call = captured as { args: Record<string, unknown>; result: unknown };
      expect(normalizeCorrelationId(await connection.client.callTool({ name, arguments: call.args })))
        .toEqual(normalizeCorrelationId(call.result));
    }
    expect(await connection.client.callTool({ name: 'artifacts_get', arguments: { artifactId: 'artifact' } }))
      .toEqual({ content: [{ type: 'text', text: '{"artifact":"qualified"}' }] });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0].actorId).toBe('owner');
    expect(JSON.stringify(execute.mock.calls)).not.toContain(tokenRef.value);
    allowed = false;
    expect((await connection.client.callTool({ name: 'artifacts_get', arguments: { artifactId: 'artifact' } })).isError).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(connection.transport.sessionId).toBe(session);
    expect(host.stats).toMatchObject({ servers: 1, transports: 1, sdkCredentials: 0 });
  } finally { await connection.close(); await host.close(); }
});
