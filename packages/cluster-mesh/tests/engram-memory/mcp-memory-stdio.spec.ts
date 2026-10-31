import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { expect, it } from 'vitest';
import { loadMcpPlatformStdio } from '../../src/loaders/mcp/stdio.js';
import { memoryMcpHost, captureInput } from './mcp-host.js';
import { initializeMessage, memoryWireServer } from './mcp-transport-host.js';

it('should discover and capture through the qualified stdio bridge with unchanged schemas', async () => {
  const host = await memoryMcpHost();
  const input = new PassThrough(), output = new PassThrough();
  const lines = createInterface({ input: output });
  const pending = new Map<string, (value: any) => void>();
  lines.on('line', line => { const message = JSON.parse(line); pending.get(String(message.id))?.(message); });
  const rpc = (message: any) => new Promise<any>(resolve => {
    pending.set(String(message.id), resolve); input.write(JSON.stringify(message) + '\n');
  });
  const server = await memoryWireServer(host, 'stdio_host_managed_verified');
  try {
    expect((await loadMcpPlatformStdio(host.modules)).createStdioTransport).toBeTypeOf('function');
    await server.connect(new StdioServerTransport(input, output));
    expect((await rpc(initializeMessage)).result.protocolVersion).toBe('2025-06-18');
    input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const listed = await rpc({ jsonrpc: '2.0', id: 'list', method: 'tools/list' });
    expect(listed.result.tools).toEqual((await host.runtime.server.listTools()).tools);
    const called = await rpc({ jsonrpc: '2.0', id: 'capture', method: 'tools/call', params: {
      name: 'engram_memory_capture', arguments: captureInput('stdio-capture-memory-0001') } });
    expect(called.result).toMatchObject({ isError: false, structuredContent: { ok: true, output: { value: { status: 'committed_pending' } } } });
    const forged = await rpc({ jsonrpc: '2.0', id: 'forged', method: 'tools/call', params: {
      name: 'engram_memory_search', arguments: { query: 'memory', purpose_ref: 'purpose-memory', tenant_id: 'tenant-b' } } });
    expect(forged.result.isError).toBe(true);
  } finally { await server.close(); lines.close(); input.destroy(); output.destroy(); await host.close(); }
});
