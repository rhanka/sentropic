import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the artifacts web-pages MCP leaf through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`)
 * when the optional `@sentropic/artifacts` peer is absent or out of range.
 */
export async function loadWebPagesMcp(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/artifacts/mcp')> {
  return (await modules.load('mcp/web-pages')) as typeof import('@sentropic/artifacts/mcp');
}
