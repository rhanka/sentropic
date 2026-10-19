import { expect, it, vi } from 'vitest';
import { createStatefulMcpNamespace } from '../src/compose/mcp-stateful.js';
import { createClusterMeshModules } from '../src/modules/registry.js';
import { makeStatefulHost } from './conformance/stateful-host.mjs';
import { fixture, optionsFor, openClient, makeRegistry } from './conformance/stateful-fixture.mjs';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

it('isolates overlapping same-session and independent-user authority including refreshed attributes', async () => {
  const entered = deferred(), release = deferred();
  const host = makeStatefulHost(fixture.tools), seen: unknown[] = [];
  const invoke = vi.fn(async (_name, _args, context) => {
    seen.push(context);
    if (seen.length === 1) { entered.resolve(); await release.promise; }
    expect(Object.isFrozen(context.principal.attributes.roles)).toBe(true);
    return { content: [] };
  });
  await createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host, 'http', { invoke }));
  const ref = { value: await host.token({ roles: ['first'], workspaces: ['one'], org_id: 'org-a' }) };
  const connection = await openClient(host, ref);
  const args = fixture.captures.http.calls.get_lot_card.args;
  const first = connection.client.callTool({ name: 'get_lot_card', arguments: args });
  await entered.promise;
  ref.value = await host.token({ roles: ['second'], workspaces: ['two'], org_id: 'org-b', scope: 'immo:read' });
  await connection.client.callTool({ name: 'get_lot_card', arguments: args });
  const other = await openClient(host, { value: await host.token({ sub: 'another' }) });
  await other.client.callTool({ name: 'get_lot_card', arguments: args });
  release.resolve(); await first;
  const [a, b, c] = seen as Array<{ principal: { sub: string; scopes: string[]; attributes: unknown } }>;
  expect(a.principal.attributes).toEqual({ roles: ['first'], workspaces: ['one'], org_id: 'org-a' });
  expect(b.principal.attributes).toEqual({ roles: ['second'], workspaces: ['two'], org_id: 'org-b' });
  expect(a.principal.scopes).toContain('immo:search');
  expect(b.principal.scopes).toEqual(['immo:read']);
  expect(c.principal.sub).toBe('another');
  expect(JSON.stringify(seen)).not.toContain(ref.value);
  await connection.close(); await other.close(); await host.close();
});

it('evaluates configured verified claim labels on the next call and denies absent claims before account resolution', async () => {
  const host = makeStatefulHost(fixture.tools);
  const authorize = vi.fn(async () => true), invoke = vi.fn(async () => ({ content: [] }));
  await createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host, 'http', {
    registry: makeRegistry(fixture.tools, ['admin']), authorize, invoke,
  }));
  const ref = { value: await host.token({ roles: ['admin'] }) }, connection = await openClient(host, ref);
  const args = fixture.captures.http.calls.get_lot_card.args;
  expect(await connection.client.callTool({ name: 'get_lot_card', arguments: args })).toEqual({ content: [] });
  ref.value = await host.token({ roles: ['viewer'] });
  expect(await connection.client.callTool({ name: 'get_lot_card', arguments: args })).toMatchObject({ isError: true });
  expect(authorize).toHaveBeenCalledTimes(1); expect(invoke).toHaveBeenCalledTimes(1);
  await connection.close(); await host.close();
});

it('combines SDK cancellation and host session expiry without later effects or double close', async () => {
  for (const abortSource of ['sdk', 'expiry']) {
    const host = makeStatefulHost(fixture.tools, { idle: 10 });
    const entered = deferred(), aborted = deferred();
    let effects = 0;
    await createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host, 'http', {
      invoke: async (_tool, _args, context) => {
        entered.resolve();
        await new Promise<void>(resolve => context.signal.addEventListener('abort', () => {
          aborted.resolve(); resolve();
        }, { once: true }));
        if (!context.signal.aborted) effects++;
        context.signal.throwIfAborted();
        return { content: [] };
      },
    }));
    const connection = await openClient(host, { value: await host.token() });
    const controller = new AbortController();
    const pending = connection.client.callTool({
      name: 'get_lot_card', arguments: fixture.captures.http.calls.get_lot_card.args,
    }, undefined, { signal: controller.signal }).catch(error => error);
    await entered.promise;
    if (abortSource === 'sdk') controller.abort();
    else { host.setNow(11); await host.sweep(); }
    await aborted.promise; await pending;
    expect(effects).toBe(0);
    await connection.client.close(); await host.close();
    expect(host.stats.closes).toBe(1);
  }
});

it('refuses protected egress and failed account resolution without exchange, bearer propagation or invocation', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected egress'));
  try {
    const host = makeStatefulHost(fixture.tools), invoke = vi.fn();
    await createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host, 'http', {
      authorize: async () => { throw new Error('SECRET_SENTINEL'); }, invoke,
    }));
    const token = await host.token(), connection = await openClient(host, { value: token });
    const result = await connection.client.callTool({ name: 'search_signals', arguments: { city: 'longueuil' } });
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
    expect(JSON.stringify(result)).not.toContain(token);
    expect(invoke).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
    expect(host.stats.sdkCredentials).toBe(0);
    await connection.close(); await host.close();
  } finally { fetchSpy.mockRestore(); }
});
