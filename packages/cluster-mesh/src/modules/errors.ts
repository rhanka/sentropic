export const CLUSTER_MESH_MODULE_UNAVAILABLE = 'cluster_mesh_module_unavailable' as const;

export const CLUSTER_MESH_MODULE_UNAVAILABLE_REASONS = [
  'disabled',
  'not_installed',
  'incompatible_version',
  'export_unavailable',
  'load_failed',
  'source_unavailable',
] as const;

export type ClusterMeshModuleUnavailableReason = (typeof CLUSTER_MESH_MODULE_UNAVAILABLE_REASONS)[number];

export interface ClusterMeshModuleUnavailableDetails {
  readonly moduleId: string;
  readonly reason: ClusterMeshModuleUnavailableReason;
  readonly packageName?: string;
  readonly requiredRange?: string;
  readonly installedVersion?: string;
  /** Local diagnostic only; never serialized into public diagnostics. */
  readonly cause?: unknown;
}

function describe(details: ClusterMeshModuleUnavailableDetails): string {
  const head = `Cluster Mesh module "${details.moduleId}" is unavailable (${details.reason}).`;
  if (details.reason === 'not_installed' && details.packageName && details.requiredRange) {
    return `${head} Install ${details.packageName}@"${details.requiredRange}" and restart.`;
  }
  if (details.reason === 'incompatible_version' && details.packageName) {
    const installed = details.installedVersion ? `${details.packageName}@${details.installedVersion}` : details.packageName;
    const range = details.requiredRange ? ` (accepted "${details.requiredRange}")` : '';
    return `${head} Installed ${installed}${range} is not a compatible single instance; fix the installation and restart.`;
  }
  return head;
}

/**
 * Typed refusal raised by registry loaders. Recognize it by `code`
 * (see `isClusterMeshModuleUnavailableError`), not by `instanceof`.
 */
export class ClusterMeshModuleUnavailableError extends Error {
  readonly code = CLUSTER_MESH_MODULE_UNAVAILABLE;
  readonly moduleId: string;
  readonly reason: ClusterMeshModuleUnavailableReason;
  readonly packageName?: string;
  readonly requiredRange?: string;
  readonly installedVersion?: string;
  declare readonly cause?: unknown;

  constructor(details: ClusterMeshModuleUnavailableDetails) {
    super(describe(details));
    this.name = 'ClusterMeshModuleUnavailableError';
    this.moduleId = details.moduleId;
    this.reason = details.reason;
    if (details.packageName !== undefined) this.packageName = details.packageName;
    if (details.requiredRange !== undefined) this.requiredRange = details.requiredRange;
    if (details.installedVersion !== undefined) this.installedVersion = details.installedVersion;
    Object.defineProperty(this, 'cause', { value: details.cause, enumerable: false, configurable: true, writable: false });
  }
}

/** Structural, cross-copy recognition of the typed refusal. */
export function isClusterMeshModuleUnavailableError(value: unknown): value is ClusterMeshModuleUnavailableError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { code?: unknown; moduleId?: unknown; reason?: unknown };
  return candidate.code === CLUSTER_MESH_MODULE_UNAVAILABLE
    && typeof candidate.moduleId === 'string'
    && (CLUSTER_MESH_MODULE_UNAVAILABLE_REASONS as readonly unknown[]).includes(candidate.reason);
}
