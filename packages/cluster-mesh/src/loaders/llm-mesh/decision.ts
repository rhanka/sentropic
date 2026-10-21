import '../../modules/topology-guard-llm-mesh.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the llm-mesh decision namespace through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadLlmMeshDecision(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-mesh/decision')> {
  return (await modules.load('llm-mesh/decision')) as typeof import('@sentropic/llm-mesh/decision');
}
