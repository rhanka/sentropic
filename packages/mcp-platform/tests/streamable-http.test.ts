/**
 * Lot 5 — Streamable HTTP bridge: the compiled plan served over the real MCP
 * SDK (client + server linked in memory, zero sockets), with kernel
 * validation inside the handler and request identity from headers.
 */
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  extractHttpRequestIdentity,
  identityFromExtra,
  registerBridgeTools,
} from '../src/transport/streamable-http.js';
import { validateBoundedValue } from '../src/registry-parameters.js';
import type { AppToolResult } from '../src/runtime.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['surface'],
  properties: { surface: { type: 'number', minimum: 9, maximum: 10000 } },
};

async function linkedClient(runner: (tool: string, args: never) => Promise<AppToolResult>) {
  const server = new Server({ name: 'probe', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerBridgeTools(
    server,
    [{ name: 'immo.price.estimate', description: 'Estimate a price', schema: SCHEMA }],
    { run: runner },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'probe-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

const okRunner = async (tool: string, args: never) => {
  const diagnostics = validateBoundedValue(SCHEMA, args);
  if (diagnostics.length > 0 || tool !== 'immo.price.estimate') {
    return {
      ok: false,
      auditId: 'audit-err',
      redactionClass: 'low',
      error: { code: 'invalid_parameters', message: 'rejected', retriable: false },
    } satisfies AppToolResult;
  }
  return {
    ok: true,
    output: { echo: args },
    auditId: 'audit-1',
    redactionClass: 'low',
  } satisfies AppToolResult;
};

describe('streamable HTTP bridge (real SDK, in-memory link)', () => {
  it('lists the registered plan tools', async () => {
    const client = await linkedClient(okRunner);
    const list = await client.listTools();
    expect(list.tools.map((tool) => tool.name)).toEqual(['immo.price.estimate']);
    await client.close();
  });

  it('serves valid calls with the shared wire encoding', async () => {
    const client = await linkedClient(okRunner);
    const result = await client.callTool({
      name: 'immo.price.estimate',
      arguments: { surface: 80 },
    });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({ echo: { surface: 80 } });
    await client.close();
  });

  it('turns kernel rejections into wire errors, never wire exceptions', async () => {
    const client = await linkedClient(okRunner);
    const result = await client.callTool({
      name: 'immo.price.estimate',
      arguments: { surface: 1 },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it('fails unknown tools at the protocol level without executing anything', async () => {
    const client = await linkedClient(okRunner);
    await expect(client.callTool({ name: 'nope.tool', arguments: {} })).rejects.toThrow(
      /Unknown tool/,
    );
    await client.close();
  });

  it('still rejects genuinely unknown argument keys after extra stripping', async () => {
    const client = await linkedClient(okRunner);
    const result = await client.callTool({
      name: 'immo.price.estimate',
      arguments: { surface: 80, evil: 1 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('unknown property');
    await client.close();
  });

  it('derives per-request identity from the SDK handler extra', () => {
    expect(
      identityFromExtra({
        requestInfo: {
          headers: new Headers({
            'x-mcp-client-id': 'codex',
            'x-mcp-tenant-ref': 't-1',
            authorization: 'Bearer secret-token',
          }),
        },
      }),
    ).toEqual({ clientId: 'codex', tenantRef: 't-1', scopes: [], hasBearer: true });
    expect(identityFromExtra({})).toBeUndefined();
    expect(identityFromExtra(undefined)).toBeUndefined();
  });

  it('extracts request identity from headers without ever exposing the token', () => {
    const identity = extractHttpRequestIdentity({
      'x-mcp-client-id': 'codex',
      'x-mcp-tenant-ref': 't-1',
      'x-mcp-scopes': 'probe:use probe:admin',
      authorization: 'Bearer secret-token',
    });
    expect(identity).toEqual({
      clientId: 'codex',
      tenantRef: 't-1',
      scopes: ['probe:use', 'probe:admin'],
      hasBearer: true,
    });
    expect(JSON.stringify(identity)).not.toContain('secret-token');
  });
});
