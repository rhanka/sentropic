import '../../modules/topology-guard-llm-mesh.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the llm-mesh Node namespace through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadLlmMeshNode(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-mesh/node')> {
  return (await modules.load('llm-mesh/node')) as typeof import('@sentropic/llm-mesh/node');
}
