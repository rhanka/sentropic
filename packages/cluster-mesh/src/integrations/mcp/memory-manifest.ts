import type { AppMcpProviderManifest } from '@sentropic/mcp-platform';

/** SDK discovery requires object roots; preserve every producer constraint. */
export function createEngramMemoryWireManifest(manifest: AppMcpProviderManifest): AppMcpProviderManifest {
  return { ...manifest, tools: manifest.tools.map(tool => ({
    ...tool,
    inputSchema: { type: 'object', ...tool.inputSchema as Record<string, unknown> },
    outputSchema: { type: 'object', ...tool.outputSchema as Record<string, unknown> },
  })) };
}
