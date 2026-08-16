export type GatedCapability =
  | 'inter_server_discovery'
  | 'inter_server_revocation'
  | 'rfc8693_token_exchange'
  | 'remote_projection'
  | 'memory_replication';

/** A federal API seam that is intentionally unavailable in the v1 degenerate runtime. */
export class CapabilityGatedError extends Error {
  readonly code = 'capability_gated';

  constructor(public readonly capability: GatedCapability) {
    super(`Cluster mesh capability is gated: ${capability}`);
    this.name = 'CapabilityGatedError';
  }
}

/** Raised when no validated membership can establish the tenant boundary. */
export class TenantBoundaryError extends Error {
  readonly code = 'tenant_membership_required';

  constructor() {
    super('A validated tenant membership is required');
    this.name = 'TenantBoundaryError';
  }
}
