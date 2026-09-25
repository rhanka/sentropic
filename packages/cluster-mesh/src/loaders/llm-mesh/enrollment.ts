import '../../modules/topology-guard.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the llm-mesh enrollment namespace through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadLlmMeshEnrollment(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-mesh/enrollment')> {
  return (await modules.load('llm-mesh/enrollment')) as typeof import('@sentropic/llm-mesh/enrollment');
}
