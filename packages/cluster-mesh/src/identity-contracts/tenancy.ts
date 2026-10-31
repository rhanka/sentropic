// Identity core contracts: tenant registry and tenant memberships (F01, F06, F07).
// Membership approval is the second approval, distinct from account approval.
// The read-only injected membership port disappears with these stores.

import { TenantBoundaryError } from '../errors.js';
import {
  IdentityConflictError,
  IdentityNotFoundError,
  MembershipTransitionError,
  TenantNotActiveError,
  TenantOffboardBlockedError,
} from './errors.js';
import type {
  IdentityAuditPort,
  LoginSessionStore,
  TenantMembershipStore,
  TenantRegistryStore,
} from './ports.js';
import {
  systemIdentityClock,
  type IdentityClock,
  type MembershipDecision,
  type MembershipRequestReceipt,
  type TenantMembershipRecord,
  type TenantRecord,
  type TenantRole,
} from './types.js';

export interface TenantRegistryDomain {
  createTenant(input: { readonly tenantId: string; readonly slug: string }, actorId: string): Promise<TenantRecord>;
  getTenant(tenantId: string): Promise<TenantRecord>;
  listTenants(): Promise<readonly TenantRecord[]>;
  suspendTenant(tenantId: string, actorId: string): Promise<TenantRecord>;
  offboardTenant(tenantId: string, input: { readonly actorId: string; readonly force?: boolean }): Promise<TenantRecord>;
}

export function createTenantRegistry(input: {
  readonly tenants: TenantRegistryStore;
  readonly memberships: TenantMembershipStore;
  readonly sessions: LoginSessionStore;
  readonly audit: IdentityAuditPort;
  readonly clock?: IdentityClock;
}): TenantRegistryDomain {
  const clock = input.clock ?? systemIdentityClock;
  async function requireTenant(tenantId: string): Promise<TenantRecord> {
    const tenant = await input.tenants.findTenant(tenantId);
    if (!tenant) throw new IdentityNotFoundError('tenant', tenantId);
    return tenant;
  }
  return {
    async createTenant(candidate, actorId) {
      if (await input.tenants.findTenant(candidate.tenantId)) {
        throw new IdentityConflictError('duplicate', `Tenant already exists: ${candidate.tenantId}`);
      }
      if (await input.tenants.findTenantBySlug(candidate.slug)) {
        throw new IdentityConflictError('slug', `Tenant slug is taken: ${candidate.slug}`);
      }
      const now = clock();
      const record: TenantRecord = { ...candidate, status: 'active', createdAt: now };
      await input.tenants.createTenant(record);
      await input.audit.append({ at: now, kind: 'tenant.created', actorId, subjectId: record.tenantId });
      return record;
    },
    async getTenant(tenantId) {
      return requireTenant(tenantId);
    },
    async listTenants() {
      return input.tenants.listTenants();
    },
    async suspendTenant(tenantId, actorId) {
      const tenant = await requireTenant(tenantId);
      if (tenant.status !== 'active') throw new TenantNotActiveError(tenantId);
      const now = clock();
      const updated = await input.tenants.setTenantStatus(tenantId, 'suspended', now);
      await input.audit.append({ at: now, kind: 'tenant.suspended', actorId, subjectId: tenantId });
      return updated;
    },
    async offboardTenant(tenantId, options) {
      const tenant = await requireTenant(tenantId);
      if (tenant.status === 'offboarded') throw new TenantNotActiveError(tenantId);
      if (options.force !== true) {
        const memberships = await input.memberships.listMembershipsForTenant(tenantId);
        let live = 0;
        for (const membership of memberships) {
          if (membership.status !== 'approved') continue;
          const sessions = await input.sessions.listSessionsForUser(membership.userId);
          live += sessions.filter((session) => session.status === 'active').length;
        }
        if (live > 0) throw new TenantOffboardBlockedError(tenantId, live);
      }
      const now = clock();
      const updated = await input.tenants.setTenantStatus(tenantId, 'offboarded', now);
      await input.audit.append({ at: now, kind: 'tenant.offboarded', actorId: options.actorId, subjectId: tenantId });
      return updated;
    },
  };
}

const DECISION_TRANSITIONS: Readonly<Record<MembershipDecision, readonly TenantMembershipRecord['status'][]>> = {
  approve: ['invited', 'requested', 'suspended'],
  reject: ['invited', 'requested'],
  suspend: ['approved'],
};

export interface TenantMembershipDomain {
  requestMembership(input: { readonly userId: string; readonly tenantId: string }): Promise<MembershipRequestReceipt>;
  inviteMember(input: {
    readonly userId: string;
    readonly tenantId: string;
    readonly role?: TenantRole;
    readonly actorId: string;
  }): Promise<TenantMembershipRecord>;
  decideMembership(input: {
    readonly userId: string;
    readonly tenantId: string;
    readonly decision: MembershipDecision;
    readonly actorId: string;
    readonly role?: TenantRole;
  }): Promise<TenantMembershipRecord>;
  listMembershipsForTenant(tenantId: string): Promise<readonly TenantMembershipRecord[]>;
  listMembershipsForUser(userId: string): Promise<readonly TenantMembershipRecord[]>;
  /** Internal read for the boundary domain; never served from caller input. */
  resolveApprovedMembership(userId: string, tenantId: string): Promise<TenantMembershipRecord | null>;
}

export function createTenantMemberships(input: {
  readonly memberships: TenantMembershipStore;
  readonly tenants: TenantRegistryStore;
  readonly audit: IdentityAuditPort;
  readonly clock?: IdentityClock;
}): TenantMembershipDomain {
  const clock = input.clock ?? systemIdentityClock;
  async function requireWritableTenant(tenantId: string): Promise<void> {
    const tenant = await input.tenants.findTenant(tenantId);
    if (!tenant) throw new IdentityNotFoundError('tenant', tenantId);
    if (tenant.status !== 'active') throw new TenantNotActiveError(tenantId);
  }
  return {
    async requestMembership(request) {
      const existing = await input.memberships.findMembership(request.userId, request.tenantId);
      if (!existing) {
        const now = clock();
        await input.memberships.upsertMembershipRequest({
          userId: request.userId,
          tenantId: request.tenantId,
          status: 'requested',
          tenantRole: 'member',
          updatedAt: now,
        });
      } else if (existing.status === 'rejected') {
        await input.memberships.upsertMembershipRequest({
          ...existing,
          status: 'requested',
          decidedBy: undefined,
          decidedAt: undefined,
          updatedAt: clock(),
        });
      }
      return { received: true };
    },
    async inviteMember(invitation) {
      await requireWritableTenant(invitation.tenantId);
      const existing = await input.memberships.findMembership(invitation.userId, invitation.tenantId);
      if (existing) {
        throw new IdentityConflictError(
          'duplicate',
          `Membership already exists: ${invitation.userId}/${invitation.tenantId}`,
        );
      }
      const now = clock();
      const record = await input.memberships.upsertMembershipRequest({
        userId: invitation.userId,
        tenantId: invitation.tenantId,
        status: 'invited',
        tenantRole: invitation.role ?? 'member',
        decidedBy: invitation.actorId,
        decidedAt: now,
        updatedAt: now,
      });
      await input.audit.append({
        at: now,
        kind: 'membership.invited',
        actorId: invitation.actorId,
        subjectId: `${invitation.userId}/${invitation.tenantId}`,
      });
      return record;
    },
    async decideMembership(decision) {
      await requireWritableTenant(decision.tenantId);
      const existing = await input.memberships.findMembership(decision.userId, decision.tenantId);
      if (!existing) throw new IdentityNotFoundError('membership', `${decision.userId}/${decision.tenantId}`);
      if (!DECISION_TRANSITIONS[decision.decision].includes(existing.status)) {
        throw new MembershipTransitionError();
      }
      const status =
        decision.decision === 'approve' ? 'approved' : decision.decision === 'reject' ? 'rejected' : 'suspended';
      const now = clock();
      const updated = await input.memberships.setMembershipState(decision.userId, decision.tenantId, {
        status,
        tenantRole: decision.role ?? existing.tenantRole,
        decidedBy: decision.actorId,
        decidedAt: now,
        updatedAt: now,
      });
      await input.audit.append({
        at: now,
        kind: `membership.${status}`,
        actorId: decision.actorId,
        subjectId: `${decision.userId}/${decision.tenantId}`,
      });
      return updated;
    },
    async listMembershipsForTenant(tenantId) {
      return input.memberships.listMembershipsForTenant(tenantId);
    },
    async listMembershipsForUser(userId) {
      return input.memberships.listMembershipsForUser(userId);
    },
    async resolveApprovedMembership(userId, tenantId) {
      const membership = await input.memberships.findApprovedMembership(userId, tenantId);
      if (!membership) return null;
      if (membership.userId !== userId || membership.status !== 'approved') {
        throw new TenantBoundaryError();
      }
      return membership;
    },
  };
}
