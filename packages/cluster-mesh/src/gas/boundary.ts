// Synchronous boundary domain for GAS (the frozen async createBoundaryDomain needs crypto.subtle + Promise: F3).
// Same contract: tenant comes only from the validated-membership port; any miss throws TenantBoundaryError.
import { TenantBoundaryError } from '../errors.js';
import type { MembershipLookup, TenantResidenceContext, ValidatedTenantMembership, WorkspaceReference } from '../boundaries.js';
import type { ClusterNodeId } from '../membership.js';
import { sha256Utf8, type DigestPort } from './digest.js';

export interface SyncMembershipPort {
  resolveApproved(input: MembershipLookup): ValidatedTenantMembership | null;
}

export function deriveWorkspaceReferenceSync(digest: DigestPort, workspaceId: string): WorkspaceReference {
  return `ws:sha256:${sha256Utf8(digest, workspaceId)}`;
}

export function createSyncBoundaryDomain(input: {
  readonly homeNodeId: ClusterNodeId;
  readonly memberships: SyncMembershipPort;
  readonly digest: DigestPort;
}) {
  return {
    resolve(lookup: MembershipLookup): TenantResidenceContext {
      const m = input.memberships.resolveApproved(lookup);
      if (!m || m.status !== 'approved' || m.userId !== lookup.userId || typeof m.tenantId !== 'string' || m.tenantId.trim().length === 0) {
        throw new TenantBoundaryError();
      }
      return {
        tid: m.tenantId,
        workspace: deriveWorkspaceReferenceSync(input.digest, lookup.workspaceId),
        userId: m.userId,
        homeNodeId: input.homeNodeId,
      };
    },
  };
}
