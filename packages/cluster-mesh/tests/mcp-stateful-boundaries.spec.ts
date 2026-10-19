import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Hono } from 'hono';
import { createStatefulMcpNamespace } from '../src/compose/mcp-stateful.js';
import { createClusterMeshModules } from '../src/modules/registry.js';
import { makeStatefulHost } from './conformance/stateful-host.mjs';
import { fixture, limits, optionsFor, openClient } from './conformance/stateful-fixture.mjs';
import { hostAuth, verifiedAuthority } from './conformance/stateful-host-auth.mjs';

it('refuses oversize raw bodies before parsing, allocation or invocation', async () => {
  const host = makeStatefulHost(fixture.tools), invoke = vi.fn();
  await createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host, 'http', {
    limits: { ...limits, maxRequestBytes: 64 }, invoke,
  }));
  const response = await host.app.request('/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${await host.token()}` }, body: 'x'.repeat(65),
  });
  expect(response.status).toBe(413);
  expect(host.stats.servers).toBe(0); expect(invoke).not.toHaveBeenCalled();
});

it('requires request authority and rejects credentials or undeclared verified labels', async () => {
  const server = new Server({ name: 'immo', version: '0.0.1' }, { capabilities: { tools: {} } });
  let hooks;
  const host = { verifiedClaimNames: ['admin'], bind: async next => {
    hooks = next; next.register(server); return new Hono();
  } };
  const invoke = vi.fn(async () => ({ content: [] }));
  await createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host, 'http', { invoke }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'untrusted-boundary', version: '1' });
  await server.connect(serverTransport); await client.connect(clientTransport);
  expect(await client.callTool({ name: 'search_lots', arguments: { city: 'longueuil' } }))
    .toMatchObject({ isError: true });
  expect(invoke).not.toHaveBeenCalled();
  const auth = hostAuth(), token = await auth.token();
  const principal = await auth.auth.verify(new Request('https://preprod.immo.sent-tech.ca/mcp', {
    headers: { authorization: `Bearer ${token}` },
  }));
  const authority = verifiedAuthority(principal, new AbortController().signal);
  for (const attributes of [{ accessToken: token }, { nested: { 'authorization-header': token } }, { x: NaN }]) {
    await expect(hooks.run({ ...authority, principal: { ...authority.principal, attributes } }, async () => {})).rejects.toThrow();
  }
  await expect(hooks.run({ ...authority, principal: { ...authority.principal, claims: ['unmapped'] } }, async () => {}))
    .rejects.toThrow();
  await client.close(); await server.close();
});

it('never permits a throwing or non-error refusal formatter to turn a denial into success', async () => {
  for (const formatRefusal of [() => ({ content: [] }), () => { throw new Error('SECRET_SENTINEL'); }]) {
    const host = makeStatefulHost(fixture.tools), invoke = vi.fn();
    await createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host, 'http', {
      authorize: async () => false, invoke, formatRefusal,
    }));
    const connection = await openClient(host, { value: await host.token() });
    for (const args of [{ city: 'longueuil' }, { city: 7 }]) {
      const result = await connection.client.callTool({ name: 'search_lots', arguments: args });
      expect(result).toEqual({ content: [{ type: 'text', text: 'Tool call failed' }], isError: true });
    }
    expect(invoke).not.toHaveBeenCalled();
    await connection.close(); await host.close();
  }
});

it('aborts a timed-out drain before installing either handler', async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const wait = new Promise<void>(r => { release = r; });
  const host = makeStatefulHost(fixture.tools, { drainTimeoutMs: 5, oldInvoke: async () => {
    entered(); await wait; return { content: [] };
  } });
  const connection = await openClient(host, { value: await host.token() });
  const entry = host.sessions.get(connection.transport.sessionId);
  const install = vi.spyOn(entry.server.server, 'setRequestHandler');
  const old = connection.client.callTool({ name: 'search_lots' }); await started;
  await expect(createStatefulMcpNamespace(createClusterMeshModules(), optionsFor(host.host))).rejects.toThrow(/drain deadline/);
  expect(install).not.toHaveBeenCalled();
  expect(host.admission()).toBe('failed');
  release(); await old;
  await connection.client.close(); await host.close();
});
