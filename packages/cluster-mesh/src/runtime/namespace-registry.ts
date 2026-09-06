import type { ClusterMeshNamespace, ClusterMeshNamespaceModule } from '@sentropic/contracts';

export class NamespaceRegistrationError extends Error {
  readonly code = 'duplicate_cluster_mesh_namespace';

  constructor(namespace: ClusterMeshNamespace) {
    super(`Cluster mesh namespace is already registered: ${namespace}`);
    this.name = 'NamespaceRegistrationError';
  }
}

export interface NamespaceRegistry<TRouter, TContextPort, TReceiptPort> {
  get(
    namespace: ClusterMeshNamespace,
  ): ClusterMeshNamespaceModule<TRouter, TContextPort, TReceiptPort> | undefined;
  list(): readonly ClusterMeshNamespaceModule<TRouter, TContextPort, TReceiptPort>[];
  enabled(): readonly ClusterMeshNamespaceModule<TRouter, TContextPort, TReceiptPort>[];
}

export function createNamespaceRegistry<TRouter, TContextPort, TReceiptPort>(
  modules: readonly ClusterMeshNamespaceModule<TRouter, TContextPort, TReceiptPort>[],
): NamespaceRegistry<TRouter, TContextPort, TReceiptPort> {
  const entries = new Map<
    ClusterMeshNamespace,
    ClusterMeshNamespaceModule<TRouter, TContextPort, TReceiptPort>
  >();
  for (const module of modules) {
    if (entries.has(module.namespace)) throw new NamespaceRegistrationError(module.namespace);
    entries.set(module.namespace, module);
  }
  return {
    get(namespace) {
      return entries.get(namespace);
    },
    list() {
      return [...entries.values()];
    },
    enabled() {
      return [...entries.values()].filter((module) => module.enabled);
    },
  };
}
