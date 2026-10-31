import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MEMORY_TOOL_NAMES } from '@sentropic/engram/mcp-memory';
import { expect, it } from 'vitest';
import { memoryMcpHost, captureInput } from './mcp-host.js';

it('should list builtin descriptors through an SDK client and strictly dispatch all six tools', async () => {
  const host = await memoryMcpHost();
  const definition = await host.builtin.load();
  const server = new Server({ name: 'memory-registry-consumer', version: '1.0.0' }, { capabilities: { tools: {} } });
  const client = new Client({ name: 'memory-sdk-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // A generic registry consumer serves the builtin manifest, with no schema substitution.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definition.manifest.tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => host.call(params.name, params.arguments ?? {}));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result, `${name}: ${JSON.stringify(result)}`).toMatchObject({ isError: false, structuredContent: { ok: true } });
    return (result.structuredContent as any).output.value;
  };
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual(MEMORY_TOOL_NAMES);
    for (const tool of tools) {
      const producer = host.manifest.tools.find(candidate => candidate.name === tool.name)!;
      expect(tool.inputSchema).toEqual(producer.inputSchema);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema).toEqual((await host.runtime.server.listTools()).tools.find(candidate => candidate.name === tool.name)!.outputSchema);
      expect(producer.outputSchema).not.toHaveProperty('type');
    }
    const captured = await call('engram_memory_capture', captureInput('sdk-capture-0001'));
    expect(captured.status).toBe('committed_pending');
    expect((await call('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' })).records).toEqual([]);
    const admitted = await call('engram_memory_request_admission', {
      candidate_id: captured.candidate_id, idempotency_key: 'sdk-admit-memory-0001',
    });
    expect(admitted.outcome.status).toBe('accepted');
    const record_id = admitted.outcome.record_id;
    const get = { record_id, purpose_ref: 'purpose-memory' };
    expect((await call('engram_memory_get', get)).record.record_id).toBe(record_id);
    expect((await call('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' })).records).toHaveLength(1);
    // Bypass the shared bridge: rejection must still come from producer validation.
    for (const args of [{ ...get, tenant_id: 'forged' }, { record_id }, { ...get, purpose_ref: 42 }]) {
      const result = await client.callTool({ name: 'engram_memory_get', arguments: args });
      expect(result).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: 'INVALID_SCHEMA' } } });
    }
    const invalidCapture = captureInput('sdk-invalid-0001');
    expect(await client.callTool({ name: 'engram_memory_capture', arguments: {
      ...invalidCapture, payload: { ...invalidCapture.payload, unexpected: true },
    } })).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: 'INVALID_SCHEMA' } } });
    const forget = { record_id, idempotency_key: 'sdk-forget-memory-0001', reason_ref: 'reason-memory' };
    host.confirm(false);
    expect(await client.callTool({ name: 'engram_memory_forget', arguments: forget }))
      .toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: 'gate_failed' } } });
    expect((await call('engram_memory_get', get)).record.record_id).toBe(record_id);
    host.confirm(true);
    expect((await call('engram_memory_forget', forget)).receipt.to_state).toBe('tombstoned');
    expect((await call('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' })).records).toEqual([]);
    const pending = await call('engram_memory_capture', captureInput('sdk-capture-0002'));
    expect((await call('engram_memory_withdraw', {
      candidate_id: pending.candidate_id, idempotency_key: 'sdk-withdraw-0001', reason_ref: 'reason-memory',
    })).receipt.to_state).toBe('withdrawn');
  } finally {
    await client.close(); await server.close(); await host.close();
  }
});
