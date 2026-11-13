import type {
  ExecutionNodeDevScope,
  ExecutionNodeBaseRef,
  ExecutionNodeTenantId,
} from './contract.js';
import { lstatSync } from 'node:fs';
import { posix, matchesGlob, join } from 'node:path';
import { ExecutionNodeError } from './errors.js';
import type { SandboxMount } from './runtime-adapter.js';

export const NODE_ROOT = '/var/lib/builder';

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
    if (!['sentropic', 'immo'].includes(base.tenantId) || !/^[a-zA-Z0-9_-]+$/.test(base.baseId)
      || !/^[a-zA-Z0-9:_-]+$/.test(base.identityDigest)) throw new ExecutionNodeError('command_id_payload_mismatch', 'invalid base identity');
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
export function checkWritePath(workspacePath: string, scope?: ExecutionNodeDevScope, root?: string): string {
  validateDevScope(scope);
  const normalized = posix.normalize(workspacePath);
  if (workspacePath.includes('\0') || workspacePath.includes('\\') || !normalized.startsWith('/workspace/')) {
    throw new ExecutionNodeError('cross_tenant_base_forbidden', `writes outside /workspace forbidden: ${workspacePath}`);
  }
  const relative = normalized.slice('/workspace/'.length);
  if (!scope!.writable.some(glob => matchesGlob(relative, glob))
    || scope!.refused.some(glob => matchesGlob(relative, glob) || glob.endsWith('/**') && relative === glob.slice(0, -3))) throw new ExecutionNodeError('cross_tenant_base_forbidden', 'devScope write denied');
  if (root) {
    let current = root;
    for (const segment of relative.split('/')) {
      current = join(current, segment);
      try {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) throw new ExecutionNodeError('cross_tenant_base_forbidden', 'linked write denied');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  return relative;
}

export function validateDevScope(scope: ExecutionNodeDevScope | undefined): asserts scope is ExecutionNodeDevScope {
  if (!scope || !['ui', 'api', 'jobs', 'data', 'fullstack'].includes(scope.kind)
    || !Array.isArray(scope.writable) || !scope.writable.length || !Array.isArray(scope.refused)
    || !scope.source?.repo || !scope.source.path || !scope.source.commit
    || [...scope.writable, ...scope.refused].some(glob => typeof glob !== 'string' || glob.startsWith('/') || glob.split('/').includes('..'))) {
    throw new ExecutionNodeError('command_id_payload_mismatch', 'valid host-resolved devScope with provenance required');
  }
}
