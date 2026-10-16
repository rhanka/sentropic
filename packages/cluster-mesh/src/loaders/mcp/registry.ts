import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the mcp-platform registry kernel through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadMcpPlatformRegistry(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/mcp-platform/registry')> {
  return (await modules.load('mcp-platform/registry')) as typeof import('@sentropic/mcp-platform/registry');
}
