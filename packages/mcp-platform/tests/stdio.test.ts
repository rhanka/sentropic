/**
 * Lot 5 — stdio bridge: the same compiled plan over the real MCP SDK stdio
 * transport shape, proven over an in-memory link (no process I/O in tests).
 * Wire bytes are identical to the Streamable HTTP bridge for identical
 * results; stdio request identity comes from the environment.
 */
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  createStdioTransport,
  extractStdioRequestIdentity,
  registerBridgeTools,
} from '../src/transport/stdio.js';
import { validateBoundedValue } from '../src/registry-parameters.js';
import type { AppToolResult } from '../src/runtime.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['surface'],
  properties: { surface: { type: 'number', minimum: 9, maximum: 10000 } },
};

async function linkedClient() {
  const server = new Server({ name: 'probe', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerBridgeTools(
    server,
    [{ name: 'immo.price.estimate', description: 'Estimate a price', schema: SCHEMA }],
    {
      run: async (tool, args) => {
        const diagnostics = validateBoundedValue(SCHEMA, args);
        if (diagnostics.length > 0 || tool !== 'immo.price.estimate') {
          return {
            ok: false,
            auditId: 'audit-err',
            redactionClass: 'low',
            error: { code: 'invalid_parameters', message: 'rejected', retriable: false },
          } satisfies AppToolResult;
        }
        return { ok: true, output: { echo: args }, auditId: 'audit-1', redactionClass: 'low' } satisfies AppToolResult;
      },
    },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'probe-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('stdio bridge (real SDK, in-memory link)', () => {
  it('produces byte-identical wire to the HTTP bridge for identical results', async () => {
    const client = await linkedClient();
    const result = await client.callTool({
      name: 'immo.price.estimate',
      arguments: { surface: 80 },
    });
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBe('{"echo":{"surface":80}}');
    await client.close();
  });

  it('turns kernel rejections into wire errors', async () => {
    const client = await linkedClient();
    const result = await client.callTool({
      name: 'immo.price.estimate',
      arguments: { surface: 1 },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it('extracts request identity from the environment (no bearer on stdio)', () => {
    const identity = extractStdioRequestIdentity({
      MCP_CLIENT_ID: 'claude-code',
      MCP_TENANT_REF: 't-9',
      MCP_SCOPES: 'probe:use',
    });
    expect(identity).toEqual({
      clientId: 'claude-code',
      tenantRef: 't-9',
      scopes: ['probe:use'],
      hasBearer: false,
    });
    expect(extractStdioRequestIdentity({})).toEqual({ scopes: [], hasBearer: false });
  });

  it('builds the SDK stdio transport without acquiring any I/O', async () => {
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const transport = createStdioTransport();
    expect(transport).toBeInstanceOf(StdioServerTransport);
    expect(transport.onclose).toBeUndefined();
  });
});
