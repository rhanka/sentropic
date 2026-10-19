import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { validateMcpWireResult } from '../src/transport/result-codec.js';
// The subprocess and HTTP probe use the same packaged registration and native runner.
import { register, tools, limits } from './fixtures/native-wire-server.mjs';

async function open(mode: 'http' | 'stdio') {
  const client = new Client({ name: 'conformance', version: '1' });
  const server = new Server({ name: 'native-probe', version: '1' }, { capabilities: { tools: {} } });
  register(server);
  const hostTransport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  if (mode === 'http') await server.connect(hostTransport);
  const transport = mode === 'http'
    ? new StreamableHTTPClientTransport(new URL('http://native.test/mcp'), {
      fetch: async (url, init) => hostTransport.handleRequest(new Request(url, init)),
    })
    : new StdioClientTransport({
      command: process.execPath, args: [fileURLToPath(new URL('./fixtures/native-wire-server.mjs', import.meta.url))],
    });
  await client.connect(transport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe.each(['http', 'stdio'] as const)('native results over %s', mode => {
  it('preserves descriptors and complete SDK results including text bytes and optional absence', async () => {
    const { client, close } = await open(mode);
    try {
      expect((await client.listTools()).tools).toEqual(tools);
      for (const result of [
        { content: [] },
        { content: [], isError: false },
        { content: [{ type: 'text', text: '{\n  "b":2, "a":1\n}\n' }], _meta: { x: 1 } },
        { content: [{ type: 'image', data: 'YQ==', mimeType: 'image/png' },
          { type: 'text', text: ' trailing  ' }], structuredContent: { x: 2 }, isError: true },
        { content: [{ type: 'resource_link', uri: 'https://example.test/a', name: 'a' }] },
      ]) {
        expect(await client.callTool({ name: 'probe', arguments: { result } })).toEqual(result);
      }
    } finally { await close(); }
  });
  it('keeps protocol errors distinct and never exposes exception details', async () => {
    const { client, close } = await open(mode);
    try {
      for (const [value, code] of [['protocol', -32602], ['custom-code', -32603]] as const) {
        await expect(client.callTool({ name: 'probe', arguments: { mode: value } }))
          .rejects.toMatchObject({ code, data: undefined });
      }
      const result = await client.callTool({ name: 'probe', arguments: { mode: 'ordinary' } });
      expect(result).toEqual({ content: [{ type: 'text', text: 'Safe failure' }], isError: true });
      expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
      await expect(client.callTool({ name: 'unknown' })).rejects.toMatchObject({ code: -32601 });
      expect(await client.callTool({ name: 'probe', arguments: { mode: 4 } })).toMatchObject({ isError: true });
      expect(await client.callTool({ name: 'probe', arguments: { result: { content: 'bad' } } }))
        .toMatchObject({ isError: true });
    } finally { await close(); }
  });
});

it('validates a view and returns the original finite JSON object', () => {
  const result = { content: [], extension: { retained: true } };
  expect(validateMcpWireResult(result, limits)).toBe(result);
  for (const invalid of [{ content: [], n: Infinity }, { content: [], isError: 'false' }]) {
    expect(() => validateMcpWireResult(invalid, limits)).toThrow();
  }
  expect(() => validateMcpWireResult({ content: [] }, { ...limits, maxResultBytes: 1 })).toThrow();
});
