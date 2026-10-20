import { expect, it, vi } from 'vitest';
import { createStatefulMcpNamespace } from '../src/compose/mcp-stateful.js';
import { createClusterMeshModules } from '../src/modules/registry.js';
import { makeStatefulHost } from './conformance/stateful-host.mjs';
import { fixture, optionsFor, openClient, makeRegistry } from './conformance/stateful-fixture.mjs';

const deferred = () => {
  let resolve!: (value?: unknown) => void;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

it('drains an old call and wraps already connected McpServer objects without reconnecting', async () => {
  const entered = deferred(), release = deferred();
  const host = makeStatefulHost(fixture.tools, { oldInvoke: async () => {
    entered.resolve(); await release.promise; return { content: [] };
  } });
  const connection = await openClient(host, { value: await host.token() });
  const sid = connection.transport.sessionId;
  const entry = host.sessions.get(sid);
  const oldCall = connection.client.callTool({ name: 'search_lots' });
  await entered.promise;
  const binding = createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host));
  await vi.waitFor(() => expect(host.admission()).toBe('binding'));
  release.resolve(); await oldCall;
  const wrapped = await binding;
  expect(wrapped.createRouter({} as never)).toBe(host.app);
  expect(wrapped.createRouter({} as never)).toBe(host.app);
  expect((await connection.client.listTools()).tools).toEqual(fixture.tools);
  await connection.client.callTool({ name: 'search_lots', arguments: { city: 'longueuil' } });
  expect(connection.transport.sessionId).toBe(sid);
  expect(host.sessions.get(sid)).toBe(entry);
  expect(host.stats).toMatchObject({ servers: 1, transports: 1, oldCalls: 1, sdkCredentials: 0 });
  await expect(createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host))).rejects.toThrow(/already bound/);
  const later = await openClient(host, { value: await host.token() });
  expect(host.stats.servers).toBe(2);
  await connection.close(); await later.close(); await host.close();
  expect(host.stats.closes).toBe(2);
});

it('keeps host admission closed after failure between list/call installation', async () => {
  let installs = 0;
  const host = makeStatefulHost(fixture.tools, { failInstall: server => {
    const set = server.setRequestHandler.bind(server);
    server.setRequestHandler = (...args) => {
      if (++installs === 2) throw new Error('Injected installation failure');
      return set(...args);
    };
  } });
  const token = await host.token();
  const connection = await openClient(host, { value: token });
  const sid = connection.transport.sessionId, entry = host.sessions.get(sid);
  await expect(createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host))).rejects.toThrow(/installation/);
  const response = await host.app.request('/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'search_lots' } }),
  });
  expect(response.status).toBe(503);
  expect(host.sessions.get(sid)).toBe(entry);
  expect(host.stats.oldCalls).toBe(0);
  await connection.client.close(); await host.close();
  expect(host.stats.closes).toBe(1);
});

it('preflights collisions, full coverage, schemas and verified claims before host mutation', async () => {
  const host = makeStatefulHost(fixture.tools);
  const bind = vi.spyOn(host.host, 'bind');
  const options = optionsFor(host.host);
  for (const tools of [[...fixture.tools, fixture.tools[0]], fixture.tools.slice(1),
    [{ ...fixture.tools[0], inputSchema: { type: 'object' } }, ...fixture.tools.slice(1)]]) {
    await expect(createStatefulMcpNamespace(createClusterMeshModules(), { ...options, tools })).rejects.toThrow();
  }
  await expect(createStatefulMcpNamespace(createClusterMeshModules(), {
    ...options, registry: makeRegistry(fixture.tools, ['unmapped']),
  })).rejects.toThrow(/claim/);
  const unavailable = { load: async () => { throw new Error('Missing peer'); } } as never;
  await expect(createStatefulMcpNamespace(unavailable, options)).rejects.toThrow(/Missing peer/);
  expect(bind).not.toHaveBeenCalled();
  const original = structuredClone(fixture.tools);
  const registry = makeRegistry(original);
  original[0].inputSchema.properties.city.type = 'number';
  expect(registry.resolveTool(original[0].name)!.inputSchema).toEqual(fixture.tools[0].inputSchema);
});
