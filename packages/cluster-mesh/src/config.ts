export const DEFAULT_CLUSTER_MESH_MAX_CONCURRENT = 12;

export interface ClusterMeshConfigInput {
  readonly capacity: {
    readonly poolSize: number;
    readonly maxConcurrent?: number;
  };
}

export interface ClusterMeshConfig {
  readonly capacity: {
    readonly poolSize: number;
    readonly maxConcurrent: number;
  };
}

export class ClusterMeshConfigError extends Error {
  readonly code = 'invalid_cluster_mesh_config';

  constructor(message: string) {
    super(message);
    this.name = 'ClusterMeshConfigError';
  }
}

export function resolveClusterMeshConfig(input: ClusterMeshConfigInput): ClusterMeshConfig {
  const maxConcurrent = input.capacity.maxConcurrent ?? DEFAULT_CLUSTER_MESH_MAX_CONCURRENT;
  const poolSize = input.capacity.poolSize;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent <= 0) {
    throw new ClusterMeshConfigError('clusterMesh.capacity.maxConcurrent must be a positive integer');
  }
  if (!Number.isInteger(poolSize) || poolSize <= 0 || poolSize > maxConcurrent) {
    throw new ClusterMeshConfigError(
      'clusterMesh.capacity.poolSize must be a positive integer not greater than maxConcurrent',
    );
  }
  return { capacity: { maxConcurrent, poolSize } };
}
