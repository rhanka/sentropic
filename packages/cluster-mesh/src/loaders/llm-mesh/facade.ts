import '../../modules/topology-guard.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the llm-mesh facade namespace through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadLlmMeshFacade(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-mesh/facade')> {
  return (await modules.load('llm-mesh/facade')) as typeof import('@sentropic/llm-mesh/facade');
}
