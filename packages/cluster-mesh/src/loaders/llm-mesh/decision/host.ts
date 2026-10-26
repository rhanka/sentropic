import '../../../modules/topology-guard-llm-mesh.js';
import type { ClusterMeshModules } from '../../../modules/contracts.js';

/**
 * Acquire the llm-mesh decision host namespace through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadLlmMeshDecisionHost(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-mesh/decision/host')> {
  return (await modules.load('llm-mesh/decision/host')) as typeof import('@sentropic/llm-mesh/decision/host');
}
