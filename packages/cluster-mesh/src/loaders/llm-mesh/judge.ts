import '../../modules/topology-guard-llm-mesh.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Acquire the llm-mesh judge namespace through the registry.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadLlmMeshJudge(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-mesh/judge')> {
  return (await modules.load('llm-mesh/judge')) as typeof import('@sentropic/llm-mesh/judge');
}

export const loadJudgeClient = loadLlmMeshJudge;
