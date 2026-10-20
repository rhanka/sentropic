import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

export async function loadMcpPlatformResultCodec(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/mcp-platform/transport/result-codec')> {
  return await modules.load('mcp-platform/result-codec') as typeof import('@sentropic/mcp-platform/transport/result-codec');
}
