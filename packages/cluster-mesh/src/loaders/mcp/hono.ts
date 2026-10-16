import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the mcp-platform hono mount through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadMcpPlatformHono(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/mcp-platform/hono')> {
  return (await modules.load('mcp-platform/hono')) as typeof import('@sentropic/mcp-platform/hono');
}
