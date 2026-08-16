import { TenantBoundaryError } from './errors.js';
import type { ClusterNodeId } from './membership.js';

export type WorkspaceReference = `ws:sha256:${string}`;

export interface MembershipLookup {
  readonly workspaceId: string;
  readonly userId: string;
}

export interface ValidatedTenantMembership {
  readonly tenantId: string;
  readonly userId: string;
  readonly status: 'approved';
}

export interface ValidatedMembershipPort {
  resolveApproved(input: MembershipLookup): Promise<ValidatedTenantMembership | null>;
}

export interface TenantResidenceContext {
  readonly tid: string;
  readonly workspace: WorkspaceReference;
  readonly userId: string;
  readonly homeNodeId: ClusterNodeId;
}

export interface BoundaryDomain {
  resolve(input: MembershipLookup): Promise<TenantResidenceContext>;
  workspaceReference(workspaceId: string): Promise<WorkspaceReference>;
}

export async function deriveWorkspaceReference(workspaceId: string): Promise<WorkspaceReference> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(workspaceId));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `ws:sha256:${hex}`;
}

/** Tenant identity is obtained only from the validated-membership port, never from input data. */
export function createBoundaryDomain(input: {
  readonly homeNodeId: ClusterNodeId;
  readonly memberships: ValidatedMembershipPort;
}): BoundaryDomain {
  return {
    workspaceReference: deriveWorkspaceReference,
    async resolve(lookup) {
      const membership = await input.memberships.resolveApproved(lookup);
      if (
        !membership
        || membership.status !== 'approved'
        || membership.userId !== lookup.userId
        || typeof membership.tenantId !== 'string'
        || membership.tenantId.trim().length === 0
      ) {
        throw new TenantBoundaryError();
      }
      return {
        tid: membership.tenantId,
        workspace: await deriveWorkspaceReference(lookup.workspaceId),
        userId: membership.userId,
        homeNodeId: input.homeNodeId,
      };
    },
  };
}
