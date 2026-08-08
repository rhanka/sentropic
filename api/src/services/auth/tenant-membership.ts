import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { oauthClients, tenantMemberships, tenants } from '../../db/schema';
import { invalidateResolveTenantCache } from '../tenancy/resolve-tenant';

// BR-39e Lot 2 — tenant-scoped membership acceptance.
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
  const [row] = await db
    .select({ status: tenantMemberships.status, role: tenantMemberships.role })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, callerId)))
    .limit(1);
  return !!row && row.status === 'approved' && row.role === 'admin';
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

/**
 * Request membership in a tenant.
 *
 * ANTI-ENUMERATION: always resolves to the same opaque `{ status: 'pending' }` regardless of
 * whether the tenant exists/is active, the user is already a member, or a cap was hit — the
 * endpoint can never be used to probe tenant/user existence or capacity.
 */
export async function requestMembership(
  userId: string,
  tenantId: string,
): Promise<{ status: 'pending' }> {
  const opaque = { status: 'pending' as const };

  const [tenant] = await db
    .select({ id: tenants.id, status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant || tenant.status !== 'active') return opaque;

  const [existing] = await db
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)))
    .limit(1);
  if (existing) return opaque;

  const [{ count: userPending }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, 'requested')));
  if (userPending >= MAX_PENDING_PER_USER) return opaque;

  const [{ count: tenantPending }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, 'requested')));
  if (tenantPending >= MAX_PENDING_PER_TENANT) return opaque;

  await db
    .insert(tenantMemberships)
    .values({ tenantId, userId, status: 'requested', role: 'member' })
    .onConflictDoNothing();
  return opaque;
}

/**
 * Decide a pending/active membership. The caller MUST be a tenant admin of `tenantId`
 * (enforced first, so a non-admin gets 403 without learning whether the membership exists).
 * The state transition is validated; `approvedByUserId`/`decidedAt` are stamped for audit.
 */
export async function decideMembership(
  callerId: string,
  callerGlobalRole: string | undefined,
  tenantId: string,
  targetUserId: string,
  decision: MembershipDecision,
): Promise<{ status: MembershipStatus }> {
  await assertTenantAdmin(callerId, tenantId, callerGlobalRole);

  const [membership] = await db
    .select({ status: tenantMemberships.status })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, targetUserId)))
    .limit(1);
  if (!membership) throw new MembershipNotFoundError();

  const from = membership.status as MembershipStatus;
  const to = DECISION_TARGET[decision];
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidMembershipTransitionError(from, to);
  }

  const now = new Date();
  await db
    .update(tenantMemberships)
    .set({ status: to, approvedByUserId: callerId, decidedAt: now, updatedAt: now })
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, targetUserId)));
  invalidateResolveTenantCache();
  return { status: to };
}

/** Tenant-admin only: list memberships of a tenant, optionally filtered by status. */
export async function listTenantMemberships(
  callerId: string,
  callerGlobalRole: string | undefined,
  tenantId: string,
  status?: MembershipStatus,
): Promise<Array<{ userId: string; status: string; role: string; requestedAt: Date; decidedAt: Date | null }>> {
  await assertTenantAdmin(callerId, tenantId, callerGlobalRole);
  return db
    .select({
      userId: tenantMemberships.userId,
      status: tenantMemberships.status,
      role: tenantMemberships.role,
      requestedAt: tenantMemberships.requestedAt,
      decidedAt: tenantMemberships.decidedAt,
    })
    .from(tenantMemberships)
    .where(
      status
        ? and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, status))
        : eq(tenantMemberships.tenantId, tenantId),
    );
}

/** Tenant-admin only: list the OAuth clients (RPs) belonging to a tenant — RP governance (Lot 4). */
export async function listTenantClients(
  callerId: string,
  callerGlobalRole: string | undefined,
  tenantId: string,
): Promise<Array<{ clientId: string; name: string; redirectUris: string[]; tokenEndpointAuthMethod: string }>> {
  await assertTenantAdmin(callerId, tenantId, callerGlobalRole);
  return db
    .select({
      clientId: oauthClients.clientId,
      name: oauthClients.name,
      redirectUris: oauthClients.redirectUris,
      tokenEndpointAuthMethod: oauthClients.tokenEndpointAuthMethod,
    })
    .from(oauthClients)
    .where(eq(oauthClients.tenantId, tenantId));
}
