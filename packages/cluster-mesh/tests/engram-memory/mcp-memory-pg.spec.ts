import { afterEach, describe, expect, it } from 'vitest';
import { MEMORY_TOOL_NAMES } from '@sentropic/engram/mcp-memory';
import { memoryMcpHost, captureInput } from './mcp-host.js';

const hosts: Awaited<ReturnType<typeof memoryMcpHost>>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); });
const open = async (tenant = 'tenant-a') => {
  const host = await memoryMcpHost(tenant); hosts.push(host); return host;
};
const value = (result: unknown): any => {
  expect(result).toMatchObject({ isError: false, structuredContent: { ok: true } });
  return (result as any).structuredContent.output.value;
};

describe('memory MCP over real PostgreSQL', () => {
  it('should publish the producer schemas and all six tools only after selected compilation', async () => {
    const host = await open();
    const tools = (await host.runtime.server.listTools()).tools;
    expect(tools.map(tool => tool.name)).toEqual(MEMORY_TOOL_NAMES);
    for (const tool of tools) {
      expect(tool.inputSchema).toEqual(host.manifest.tools.find(t => t.name === tool.name)!.inputSchema);
      expect(tool.outputSchema).toMatchObject({ type: 'object', oneOf: expect.any(Array) });
      expect(tool._meta).toHaveProperty('sentropic.engram/memory');
    }
    expect(host.registry.compiled()).toBeDefined();
  });

  it('should capture pending material, admit, search, read and forget with receipts', async () => {
    const host = await open();
    const captured = value(await host.call('engram_memory_capture', captureInput('capture-roundtrip-0001')));
    expect(captured).toMatchObject({ status: 'committed_pending', transaction_receipt_digest: expect.stringMatching(/^sha256:/) });
    expect(value(await host.call('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' })).records).toEqual([]);
    const admitted = value(await host.call('engram_memory_request_admission', {
      candidate_id: captured.candidate_id, idempotency_key: 'admit-roundtrip-0001',
    }));
    expect(admitted.outcome.status).toBe('accepted');
    const record_id = admitted.outcome.record_id;
    expect(value(await host.call('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' })).records).toHaveLength(1);
    expect(value(await host.call('engram_memory_get', { record_id, purpose_ref: 'purpose-memory' })).record.record_id).toBe(record_id);
    const forgotten = value(await host.call('engram_memory_forget', {
      record_id, idempotency_key: 'forget-roundtrip-0001', reason_ref: 'reason-memory',
    }));
    expect(forgotten.receipt.to_state).toBe('tombstoned');
    expect(value(await host.call('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' })).records).toEqual([]);
  });

  it('should refuse destructive effects without confirmation and withdraw once confirmed', async () => {
    const host = await open();
    const captured = value(await host.call('engram_memory_capture', captureInput('capture-withdraw-0001')));
    host.confirm(false);
    const args = { candidate_id: captured.candidate_id, idempotency_key: 'withdraw-memory-0001', reason_ref: 'reason-memory' };
    expect(await host.call('engram_memory_withdraw', args)).toMatchObject({
      isError: true, structuredContent: { ok: false, error: { code: 'gate_failed' } },
    });
    host.confirm(true);
    expect(value(await host.call('engram_memory_withdraw', args))).toMatchObject({
      receipt: { to_state: 'withdrawn' }, key_destruction_confirmed: true,
    });
  });

  it('should isolate two tenants and refuse a forged invocation before disclosure', async () => {
    const a = await open(); const b = await open('tenant-b');
    const captured = value(await a.call('engram_memory_capture', captureInput('capture-tenant-a-0001')));
    const admitted = value(await a.call('engram_memory_request_admission', {
      candidate_id: captured.candidate_id, idempotency_key: 'admit-tenant-a-0001',
    }));
    expect(value(await b.call('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' })).records).toEqual([]);
    expect(await b.call('engram_memory_get', { record_id: admitted.outcome.record_id, purpose_ref: 'purpose-memory' }))
      .toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: 'NOT_FOUND' } } });
    await expect(b.runtime.server.callTool('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' },
      a.context())).rejects.toMatchObject({ code: -32603 });
  });
});
