import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the mcp-platform transport bridge through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadMcpPlatformBridge(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/mcp-platform/transport/bridge')> {
  return (await modules.load('mcp-platform/bridge')) as typeof import('@sentropic/mcp-platform/transport/bridge');
}
