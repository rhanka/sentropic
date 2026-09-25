import '../../modules/topology-guard.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the llm-mesh root namespace through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadLlmMesh(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-mesh')> {
  return (await modules.load('llm-mesh')) as typeof import('@sentropic/llm-mesh');
}
