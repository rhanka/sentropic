import type { ClusterMeshHonoNamespaceModule } from '../hono/plugin.js';

/** Unmounted namespace for intentionally disabled preparation (existing 404 behavior). */
export function disabledNamespaceModule(namespace: '/llm-mesh' | '/gw'): ClusterMeshHonoNamespaceModule {
  return {
    namespace,
    enabled: false,
    createRouter() {
      throw new Error(`Cluster Mesh namespace ${namespace} is disabled`);
    },
  };
}
