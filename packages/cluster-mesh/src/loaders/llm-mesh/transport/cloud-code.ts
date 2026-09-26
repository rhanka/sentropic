import '../../../modules/topology-guard-llm-mesh.js';
import type { ClusterMeshModules } from '../../../modules/contracts.js';

/**
 * Acquire the llm-mesh Cloud Code transport namespace through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadCloudCodeTransport(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-mesh/transport/cloud-code')> {
  return (await modules.load('llm-mesh/transport/cloud-code')) as typeof import('@sentropic/llm-mesh/transport/cloud-code');
}
