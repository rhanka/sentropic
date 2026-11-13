import type { ExecutionNodeErrorCode } from './contract.js';

export const EXECUTION_NODE_HTTP_STATUS: Record<ExecutionNodeErrorCode, number> = {
  network_isolation_violation: 500,
  ports_saturated: 429,
  ports_disabled: 409,
  sandbox_not_quiesced: 409,
  cgroup_tenant_mismatch: 500,
  custody_revoked: 403,
  control_plane_unavailable: 503,
  missing_tenant_id: 400,
  already_claimed: 409,
  command_id_payload_mismatch: 409,
  stale_node_epoch: 409,
  unknown_node_instance: 409,
  cross_tenant_base_forbidden: 403,
  deprecated_on_overlay_node: 410,
  sandbox_still_running: 409,
  tenant_quota_exceeded: 429,
};

export class ExecutionNodeError extends Error {
  readonly code: ExecutionNodeErrorCode;
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(code: ExecutionNodeErrorCode, detail?: string, retryAfterMs?: number) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ExecutionNodeError';
    this.code = code;
    this.status = EXECUTION_NODE_HTTP_STATUS[code];
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}
