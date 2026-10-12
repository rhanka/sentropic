import '../../../modules/topology-guard-llm-mesh.js';
import type { ClusterMeshModules } from '../../../modules/contracts.js';

/**
 * Acquire the llm-mesh JEV transport namespace through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadLlmMeshJevTransport(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-mesh/transport/jev')> {
  return (await modules.load('llm-mesh/transport/jev')) as typeof import('@sentropic/llm-mesh/transport/jev');
}
