import '../../modules/topology-guard.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';
/** Acquire the local module only after registry preflight of its optional peer. */
export async function loadComments(modules: ClusterMeshModules): Promise<typeof import('../../comments/index.js')> {
  return await modules.load('comments') as typeof import('../../comments/index.js');
}
