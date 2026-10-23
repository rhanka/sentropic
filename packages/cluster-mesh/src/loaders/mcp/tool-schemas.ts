import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

export async function loadMcpPlatformToolSchemas(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/mcp-platform/transport/tool-schemas')> {
  return await modules.load('mcp-platform/tool-schemas') as typeof import('@sentropic/mcp-platform/transport/tool-schemas');
}
