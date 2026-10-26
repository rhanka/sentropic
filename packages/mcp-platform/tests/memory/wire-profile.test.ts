import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerBridgeTools, type BridgeOptions, type BridgeTool } from '../../src/transport/bridge.js';
import { encodeMemoryEnvelope } from '../../src/transport/result-codec.js';
import { encodeBoundedMemoryEnvelope } from '../../src/memory/wire-profile.js';
import { hostContext } from './host-fixture.js';

const tool: BridgeTool = { name: 'engram_memory_search', profile: 'sentropic.engram.memory-wire/v1',
  schemaProfile: 'sentropic.engram.memory-tools/2020-12-v1',
  schema: { type: 'object', additionalProperties: false, properties: { purpose_ref: { type: 'string' } } },
  outputSchema: { type: 'object', additionalProperties: false, properties: {
    ok: { const: true }, output: { type: 'object', additionalProperties: false, required: ['schema_version', 'value'],
      properties: { schema_version: { const: 1 }, value: { type: 'string' } } },
    auditId: { type: 'string' }, redactionClass: { const: 'high' },
  }, required: ['ok', 'output', 'auditId', 'redactionClass'] },
  _meta: { source: 'mcp:engram-memory', capability: 'search' } };
const envelope = { ok: true as const, output: { schema_version: 1 as const, value: 'é' }, auditId: 'audit-host-1', redactionClass: 'high' as const };
async function linked(run: (...args: any[]) => Promise<any>, options: BridgeOptions = {}) {
  const server = new Server({ name: 'memory', version: '1' }, { capabilities: { tools: {} } });
  registerBridgeTools(server, [tool], { run }, options);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: 'memory-test', version: '1' });
  await client.connect(a);
  return client;
}
describe('P04.platform.wire-profile-v1', () => {
  it('should preserve the full dual-channel envelope, output schema and metadata over SDK', async () => {
    const ctx = hostContext();
    const client = await linked(async (_name, _args, _identity, call) => {
      expect(call.context).toBe(ctx);
      expect(call.signal).toBeInstanceOf(AbortSignal);
      return envelope;
    }, { memoryContext: async () => ctx });
    try {
      const listed = (await client.listTools()).tools[0]!;
      expect(listed.outputSchema).toEqual(tool.outputSchema);
      expect(listed._meta).toEqual(tool._meta);
      expect(await client.callTool({ name: tool.name, arguments: { purpose_ref: 'purpose-1' } })).toEqual({
        content: [{ type: 'text', text: JSON.stringify(envelope) }], structuredContent: envelope, isError: false,
      });
    } finally { await client.close(); }
  });
  it('should preserve missing audit as protocol -32603 before runner contact', async () => {
    let calls = 0;
    const client = await linked(async () => { calls++; return envelope; });
    try { await expect(client.callTool({ name: tool.name, arguments: {} })).rejects.toMatchObject({ code: -32603 }); }
    finally { await client.close(); }
    expect(calls).toBe(0);
  });
  it('should use JSON.stringify of the entire envelope for success and domain failure', () => {
    for (const e of [envelope, { ok: false as const, auditId: 'a', redactionClass: 'high' as const,
      error: { code: 'UNAUTHORIZED' as const, message: 'refused', retriable: false } }]) {
      expect(encodeMemoryEnvelope(e)).toEqual({ content: [{ type: 'text', text: JSON.stringify(e) }],
        structuredContent: e, isError: !e.ok });
    }
  });
  it('should enforce full-envelope exact/+1 UTF-8 and the independent escaped result ceiling', () => {
    const e = { ...envelope, output: { schema_version: 1 as const, value: 'é'.repeat(2000) } };
    const bytes = Buffer.byteLength(JSON.stringify(e));
    expect(() => encodeBoundedMemoryEnvelope(e, bytes)).not.toThrow();
    expect(() => encodeBoundedMemoryEnvelope(e, bytes - 1)).toThrow();
    const escaped = { ...envelope, output: { schema_version: 1 as const, value: '\u0000'.repeat(174730) } };
    expect(Buffer.byteLength(JSON.stringify(escaped))).toBeLessThan(1048576);
    expect(() => encodeBoundedMemoryEnvelope(escaped, 1048576)).toThrow();
  });
  it('should refuse unknown profiles before installing SDK handlers', () => {
    const server = new Server({ name: 'bad', version: '1' });
    expect(() => registerBridgeTools(server, [{ ...tool, profile: 'unknown' }], { run: async () => envelope })).toThrow();
  });
});
