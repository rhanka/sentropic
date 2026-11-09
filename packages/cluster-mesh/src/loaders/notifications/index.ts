import '../../modules/topology-guard.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';
/** Acquire the local notifications module after registry preflight. */
export async function loadNotifications(modules: ClusterMeshModules): Promise<typeof import('../../notifications/index.js')> {
  return await modules.load('notifications') as typeof import('../../notifications/index.js');
}
