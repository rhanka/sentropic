// Test-only trusted host; explicit fixture authorities are never production defaults.
import { MEMORY_PROVIDER_MANIFEST } from '@sentropic/engram/mcp-memory';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import { memoryMcpDefinition } from './mcp-host.js';

export async function createHost() {
  const host = await memoryMcpDefinition();
  return { definition: host.definition, close: host.close,
    compatibility: { 'sentropic.engram.memory': { manifestDigest: computeManifestDigest(MEMORY_PROVIDER_MANIFEST) } },
    transport: { resolveContext: (_tool: string, args: { idempotency_key?: string }) => {
      const ctx = host.context(args);
      return { ...ctx, memory: { ...ctx.memory!, binding: { ...ctx.memory!.binding,
        channel_binding: 'stdio_host_managed_verified' as const } } };
    }, limits: { maxSchemaBytes: 1048576, maxSchemaDepth: 64, maxRequestBytes: 2097152,
      maxArgumentBytes: 1048576, maxArgumentDepth: 64, maxResultBytes: 2097152, maxResultDepth: 64 },
    formatFailure: () => ({ isError: true, content: [{ type: 'text' as const, text: 'Memory tool invocation refused' }] }) },
  };
}
