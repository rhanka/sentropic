import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the mcp-platform stdio transport leaf through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadMcpPlatformStdio(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/mcp-platform/transport/stdio')> {
  return (await modules.load('mcp-platform/stdio')) as typeof import('@sentropic/mcp-platform/transport/stdio');
}
