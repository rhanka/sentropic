import { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { expect, it } from 'vitest';
import { loadMcpPlatformHono } from '../../src/loaders/mcp/hono.js';
import { memoryMcpHost, captureInput } from './mcp-host.js';
import { initializeMessage, memoryWireServer } from './mcp-transport-host.js';

it('should discover and capture through the qualified HTTP bridge with unchanged schemas', async () => {
  const host = await memoryMcpHost();
  const servers: Awaited<ReturnType<typeof memoryWireServer>>[] = [];
  const router = new Hono().all('/mcp', async c => {
    const server = await memoryWireServer(host, 'http_mcp_auth_bearer_verified'); servers.push(server);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  const rpc = async (message: unknown) => {
    const response = await router.request('/mcp', { method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
    }, body: JSON.stringify(message) });
    expect(response.status).toBe(200);
    return await response.json() as any;
  };
  try {
    expect((await loadMcpPlatformHono(host.modules)).createMcpPlatformHono).toBeTypeOf('function');
    expect((await rpc(initializeMessage)).result.protocolVersion).toBe('2025-06-18');
    const listed = await rpc({ jsonrpc: '2.0', id: 'list', method: 'tools/list' });
    expect(listed.result.tools).toEqual((await host.runtime.server.listTools()).tools);
    const called = await rpc({ jsonrpc: '2.0', id: 'capture', method: 'tools/call', params: {
      name: 'engram_memory_capture', arguments: captureInput('http-capture-memory-0001') } });
    expect(called.result).toMatchObject({ isError: false, structuredContent: { ok: true, output: { value: { status: 'committed_pending' } } } });
  } finally { for (const server of servers) await server.close(); await host.close(); }
});
