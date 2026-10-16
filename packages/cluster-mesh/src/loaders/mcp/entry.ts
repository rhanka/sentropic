import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the mcp-platform registry entry subpath through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadMcpPlatformEntry(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/mcp-platform/registry/entry')> {
  return (await modules.load('mcp-platform/entry')) as typeof import('@sentropic/mcp-platform/registry/entry');
}
