import { eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { oauthClients } from '../../db/schema';
import {
  countCmPendingMembershipsForTenant,
  countCmPendingMembershipsForUser,
  findCmMembership,
  findCmTenant,
  listCmMembershipsForTenant,
  setCmMembershipState,
  upsertCmMembershipRequest,
} from '../identity/cm-tenancy';

// BR-39e Lot 2 — tenant-scoped membership acceptance.
//
// Lot A4: memberships and tenants live in the CM stores (cm_identity.cm_tenant_memberships
// / cm_tenants); the legacy tables are dropped by control migration 0014.
//
// The tenant-scoped approver ("auth-admin", D4) is a user holding an `approved` membership
// with role='admin' in that tenant. A global `admin_app` may also act (bootstrap). The
// tenant claim issued downstream is derived ONLY from an `approved` membership, never from
// a request parameter — acceptance is the single gate that turns a request into trust.

export type MembershipStatus = 'invited' | 'requested' | 'approved' | 'rejected' | 'suspended';
export type MembershipDecision = 'approve' | 'reject' | 'suspend';

// Anti-abuse caps. They are enforced silently (no distinct error) so they can never be used
// to probe a tenant's capacity or a user's footprint.
const MAX_PENDING_PER_TENANT = 200;
const MAX_PENDING_PER_USER = 20;

const DECISION_TARGET: Record<MembershipDecision, MembershipStatus> = {
  approve: 'approved',
  reject: 'rejected',
  suspend: 'suspended',
};

// Allowed state transitions. `rejected` is terminal (re-request creates a fresh row only
// after cleanup); `approved <-> suspended` supports reinstatement.
const ALLOWED_TRANSITIONS: Record<MembershipStatus, MembershipStatus[]> = {
  invited: ['approved', 'rejected'],
  requested: ['approved', 'rejected'],
  approved: ['suspended'],
  suspended: ['approved'],
  rejected: [],
};

export class TenantAdminRequiredError extends Error {
  constructor() {
    super('Tenant admin privileges required');
    this.name = 'TenantAdminRequiredError';
  }
}

export class MembershipNotFoundError extends Error {
  constructor() {
    super('Membership not found');
    this.name = 'MembershipNotFoundError';
  }
}

export class InvalidMembershipTransitionError extends Error {
  constructor(from: MembershipStatus, to: MembershipStatus) {
    super(`Invalid membership transition ${from} -> ${to}`);
    this.name = 'InvalidMembershipTransitionError';
  }
}

/** True if caller is an `approved` admin of `tenantId`, or a global `admin_app`. */
export async function isTenantAdmin(
  callerId: string,
  tenantId: string,
  callerGlobalRole?: string,
): Promise<boolean> {
  if (callerGlobalRole === 'admin_app') return true;
  const membership = await findCmMembership(callerId, tenantId);
  return !!membership && membership.status === 'approved' && membership.role === 'admin';
}

export async function assertTenantAdmin(
  callerId: string,
  tenantId: string,
  callerGlobalRole?: string,
): Promise<void> {
  if (!(await isTenantAdmin(callerId, tenantId, callerGlobalRole))) {
    throw new TenantAdminRequiredError();
  }
}

