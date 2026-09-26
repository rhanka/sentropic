import '../../modules/topology-guard-gateway.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the llm-gateway root namespace; selects neither auth mode.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadGateway(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-gateway')> {
  return (await modules.load('gateway')) as typeof import('@sentropic/llm-gateway');
}
