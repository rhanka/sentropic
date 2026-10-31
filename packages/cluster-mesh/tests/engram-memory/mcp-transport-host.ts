import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerEngramMemoryTools } from '../../src/integrations/mcp/memory.js';
import type { ChannelBindingKindV1 } from '@sentropic/mcp-platform/memory';
import type { memoryMcpHost } from './mcp-host.js';

export async function memoryWireServer(host: Awaited<ReturnType<typeof memoryMcpHost>>, channel: ChannelBindingKindV1) {
  const server = new Server({ name: 'memory-test-host', version: '1.0.0' }, { capabilities: { tools: {} } });
  await registerEngramMemoryTools(server, { modules: host.modules, registry: host.registry.compiled()!, builtin: host.builtin,
    definition: { resolveContext: (_tool, args) => {
      const ctx = host.context(args as { idempotency_key?: string });
      return { ...ctx, memory: { ...ctx.memory!, binding: { ...ctx.memory!.binding, channel_binding: channel } } };
    }, limits: { maxSchemaBytes: 1048576, maxSchemaDepth: 64, maxRequestBytes: 2097152,
      maxArgumentBytes: 1048576, maxArgumentDepth: 64, maxResultBytes: 2097152, maxResultDepth: 64 },
    formatFailure: () => ({ isError: true, content: [{ type: 'text', text: 'Memory tool invocation refused' }] }),
  } });
  return server;
}

export const initializeMessage = { jsonrpc: '2.0', id: 'initialize', method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'memory-test-client', version: '1.0.0' } } };
