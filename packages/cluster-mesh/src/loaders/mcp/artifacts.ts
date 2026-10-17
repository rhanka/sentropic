import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the artifacts MCP leaf through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`)
 * when the optional `@sentropic/artifacts` peer is absent or out of range.
 */
export async function loadArtifactsMcp(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/artifacts/mcp')> {
  return (await modules.load('mcp/artifacts')) as typeof import('@sentropic/artifacts/mcp');
}
