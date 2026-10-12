import '../../../modules/topology-guard-llm-mesh.js';
import type { ClusterMeshModules } from '../../../modules/contracts.js';

/**
 * Acquire the llm-mesh judge host namespace through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadLlmMeshJudgeHost(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-mesh/judge/host')> {
  return (await modules.load('llm-mesh/judge/host')) as typeof import('@sentropic/llm-mesh/judge/host');
}

export const loadJudgeHost = loadLlmMeshJudgeHost;
