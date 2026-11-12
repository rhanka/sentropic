import type {
  ExecutionNodeBaseRef,
  ExecutionNodeTenantId,
} from '../../../packages/contracts/src/execution-node-v1.js';
import { ExecutionNodeError } from './errors.js';
import type { SandboxMount } from './runtime-adapter.js';

export const NODE_ROOT = '/var/lib/execution-node';

export function tenantRoot(tenantId: ExecutionNodeTenantId): string {
  return `${NODE_ROOT}/tenants/${tenantId}`;
}

export interface TenantBase {
  readonly tenantId: ExecutionNodeTenantId;
  readonly baseId: string;
  readonly kind: ExecutionNodeBaseRef['kind'];
  readonly identityDigest: string;
}

export function basePath(base: TenantBase): string {
  return `${tenantRoot(base.tenantId)}/bases/${base.kind}/${base.identityDigest}.erofs`;
}

export function sandboxPaths(tenantId: ExecutionNodeTenantId, uid: string): {
  upper: string; work: string; retained: string;
} {
  const dir = `${tenantRoot(tenantId)}/sandboxes/${uid}`;
  return { upper: `${dir}/upper`, work: `${dir}/work`, retained: `${dir}/retained` };
}

/** Per-tenant base registry: a miss returns undefined, never a foreign object. */
export class TenantBaseRegistry {
  private readonly bases = new Map<string, TenantBase>();

  register(base: TenantBase): void {
    this.bases.set(`${base.tenantId}:${base.baseId}`, base);
  }

  get(tenantId: ExecutionNodeTenantId, baseId: string): TenantBase | undefined {
    return this.bases.get(`${tenantId}:${baseId}`);
  }
}

export function resolveMounts(
  tenantId: ExecutionNodeTenantId,
  refs: readonly ExecutionNodeBaseRef[],
  registry: TenantBaseRegistry,
): SandboxMount[] {
  return refs.map(ref => {
    const base = registry.get(tenantId, ref.baseId);
    if (!base || base.kind !== ref.kind || base.identityDigest !== ref.identityDigest) {
      throw new ExecutionNodeError('cross_tenant_base_forbidden', `base ${ref.baseId} not visible to ${tenantId}`);
    }
    return { source: basePath(base), target: `/bases/${base.kind}/${base.baseId}`, readOnly: true };
  });
}

/** Writes resolve inside /workspace only; anything else is rejected. */
export function checkWritePath(workspacePath: string): void {
  if (workspacePath !== '/workspace' && !workspacePath.startsWith('/workspace/')) {
    throw new ExecutionNodeError('cross_tenant_base_forbidden', `writes outside /workspace forbidden: ${workspacePath}`);
  }
}
