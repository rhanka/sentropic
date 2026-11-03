// A4 composition gaps, bundle 1.2.0 — P2 (F12): boundary resolution over the
// CM tenancy stores. Pure domain over the frozen store ports; the frozen 1.0
// createBoundaryDomain / ValidatedMembershipPort stay untouched (§3.2) and the
// app seam cut-over is lot G6. Port-level misses are null, store errors throw;
// the domain maps any miss to the frozen TenantBoundaryError.

import { TenantBoundaryError } from '../errors.js';
import { deriveWorkspaceReference, type BoundaryDomain, type MembershipLookup } from '../boundaries.js';
import type { ClusterNodeId } from '../membership.js';
import type { TenantMembershipStore, TenantRegistryStore, WorkspaceDirectoryStore } from './ports.js';
import type { TenantRole } from './types.js';

export interface TenantBoundaryResolutionV1 {
  /** Registry id (TenantRecord.tenantId). */
  readonly tenantId: string;
  /** Immutable slug (TenantRecord.slug); this is the tid on the wire. */
  readonly tid: string;
  readonly userId: string;
  readonly tenantRole: TenantRole;
  /** TenantMembershipRecord.updatedAt; keys membership-revision caches (r2 F12). */
  readonly membershipRevision: string;
}

export interface TenantBoundaryPortV1 {
  resolveApproved(input: MembershipLookup): Promise<TenantBoundaryResolutionV1 | null>;
}

/** Authoritative read chain: workspace → tenant (must be active) → approved
    membership. Attempt-agnostic: works over standalone or transaction-bound
    (`tx.stores`) stores. No caching; fresh reads per call. */
export function createTenantBoundaryPortV1(input: {
  readonly workspaces: WorkspaceDirectoryStore;
  readonly tenants: TenantRegistryStore;
  readonly memberships: TenantMembershipStore;
}): TenantBoundaryPortV1 {
  return {
    async resolveApproved(lookup) {
      const workspace = await input.workspaces.findWorkspace(lookup.workspaceId);
      if (!workspace) return null;
      const tenant = await input.tenants.findTenant(workspace.tenantId);
      if (!tenant || tenant.status !== 'active') return null;
      const membership = await input.memberships.findApprovedMembership(lookup.userId, workspace.tenantId);
      if (!membership || membership.status !== 'approved' || membership.userId !== lookup.userId) return null;
      if (tenant.tenantId.trim().length === 0 || tenant.slug.trim().length === 0) return null;
      return {
        tenantId: tenant.tenantId,
        tid: tenant.slug,
        userId: membership.userId,
        tenantRole: membership.tenantRole,
        membershipRevision: membership.updatedAt,
      };
    },
  };
}

/** Frozen BoundaryDomain shape over the new port; tid is the tenant slug. */
export function createIdentityBoundaryDomainV1(input: {
  readonly homeNodeId: ClusterNodeId;
  readonly boundary: TenantBoundaryPortV1;
}): BoundaryDomain {
  return {
    workspaceReference: deriveWorkspaceReference,
    async resolve(lookup) {
      const resolution = await input.boundary.resolveApproved(lookup);
      if (
        !resolution
        || resolution.userId !== lookup.userId
        || resolution.tenantId.trim().length === 0
        || resolution.tid.trim().length === 0
      ) {
        throw new TenantBoundaryError();
      }
      return {
        tid: resolution.tid,
        workspace: await deriveWorkspaceReference(lookup.workspaceId),
        userId: resolution.userId,
        homeNodeId: input.homeNodeId,
      };
    },
  };
}
