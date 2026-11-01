// Lot A4: tenancy facade over the A2.2 CM stores. Replaces the legacy
// `tenants` / `tenant_memberships` / `workspace_memberships` tables and the
// app-side `resolve-tenant.ts` seam: resolution goes through the CM
// `TenantResolver` (workspace -> tenant -> approved membership), and the `tid`
// claim through the CM `TidIssuer`. No TENANT_RESOLUTION_MODE, no legacy alias.

import { CM_IDENTITY_SCHEMA, cmStoreClient, getCmIdentity } from './cm-identity';

export interface CmTenantRecord {
  readonly tenantId: string;
  readonly slug: string;
  readonly status: string;
  readonly createdAt: Date;
}

export interface CmMembershipRecord {
  readonly userId: string;
  readonly tenantId: string;
  readonly status: string;
  readonly role: string;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly updatedAt: Date;
}

export interface CmWorkspaceRecord {
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly repoIdentity: string | null;
  readonly aliases: readonly string[];
  readonly enrolledAt: Date;
}

export const listCmTenants = async (): Promise<CmTenantRecord[]> => {
  const { tenancy } = getCmIdentity();
  const rows = await tenancy.tenants.listTenants();
  return rows.map((row) => ({
    tenantId: row.tenantId,
    slug: row.slug,
    status: row.status,
    createdAt: new Date(row.createdAt),
  }));
};

export const findCmTenant = async (tenantId: string): Promise<CmTenantRecord | null> => {
  const { tenancy } = getCmIdentity();
  const row = await tenancy.tenants.findTenant(tenantId);
  return row
    ? { tenantId: row.tenantId, slug: row.slug, status: row.status, createdAt: new Date(row.createdAt) }
    : null;
};

/** Create a tenant in the CM registry (fixtures/admin flows). */
export const createCmTenant = async (input: {
  tenantId: string;
  slug?: string;
  status?: 'active' | 'suspended' | 'offboarded';
  createdAt?: Date;
}): Promise<void> => {
  const { tenancy } = getCmIdentity();
  await tenancy.tenants.createTenant({
    tenantId: input.tenantId,
    slug: input.slug ?? input.tenantId,
    status: input.status ?? 'active',
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  });
};

/** Transition a tenant status in the CM registry. */
export const setCmTenantStatus = async (
  tenantId: string,
  status: 'active' | 'suspended' | 'offboarded',
): Promise<CmTenantRecord> => {
  const { tenancy } = getCmIdentity();
  const row = await tenancy.tenants.setTenantStatus(tenantId, status, new Date().toISOString());
  return { tenantId: row.tenantId, slug: row.slug, status: row.status, createdAt: new Date(row.createdAt) };
};

export const listCmMembershipsForUser = async (userId: string): Promise<CmMembershipRecord[]> => {
  const { tenancy } = getCmIdentity();
  const rows = await tenancy.memberships.listMembershipsForUser(userId);
  return rows.map((row) => ({
    userId: row.userId,
    tenantId: row.tenantId,
    status: row.status,
    role: row.tenantRole,
    decidedBy: row.decidedBy ?? null,
    decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
    updatedAt: new Date(row.updatedAt),
  }));
};

export const listCmMembershipsForTenant = async (tenantId: string): Promise<CmMembershipRecord[]> => {
  const { tenancy } = getCmIdentity();
  const rows = await tenancy.memberships.listMembershipsForTenant(tenantId);
  return rows.map((row) => ({
    userId: row.userId,
    tenantId: row.tenantId,
    status: row.status,
    role: row.tenantRole,
    decidedBy: row.decidedBy ?? null,
    decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
    updatedAt: new Date(row.updatedAt),
  }));
};

/** AuthHonoTenantPort.listApprovedTenantIds over the CM membership store. */
export const listCmApprovedTenantIds = async (userId: string): Promise<string[]> => {
  const memberships = await listCmMembershipsForUser(userId);
  return memberships.filter((m) => m.status === 'approved').map((m) => m.tenantId);
};

/** AuthHonoTenantPort.isApprovedMember over the CM membership store. */
export const isCmApprovedMember = async (userId: string, tenantId: string): Promise<boolean> => {
  const { tenancy } = getCmIdentity();
  return Boolean(await tenancy.memberships.findApprovedMembership(userId, tenantId));
};

const toCmMembershipRecord = (row: {
  userId: string; tenantId: string; status: string; tenantRole: string;
  decidedBy?: string | null; decidedAt?: string | null; updatedAt: string;
}): CmMembershipRecord => ({
  userId: row.userId,
  tenantId: row.tenantId,
  status: row.status,
  role: row.tenantRole,
  decidedBy: row.decidedBy ?? null,
  decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
  updatedAt: new Date(row.updatedAt),
});

/** Membership in ANY state (unlike findCmApprovedMembership). */
export const findCmMembership = async (userId: string, tenantId: string): Promise<CmMembershipRecord | null> => {
  const { tenancy } = getCmIdentity();
  const row = await tenancy.memberships.findMembership(userId, tenantId);
  return row ? toCmMembershipRecord(row) : null;
};

export const countCmPendingMembershipsForUser = async (userId: string): Promise<number> => {
  const result = await cmStoreClient.query(
    `SELECT COUNT(*)::int AS n FROM ${CM_IDENTITY_SCHEMA}.cm_tenant_memberships WHERE "user_id" = $1 AND "status" = 'requested'`,
    [userId],
  );
  return (result.rows[0] as { n: number } | undefined)?.n ?? 0;
};

export const countCmPendingMembershipsForTenant = async (tenantId: string): Promise<number> => {
  const result = await cmStoreClient.query(
    `SELECT COUNT(*)::int AS n FROM ${CM_IDENTITY_SCHEMA}.cm_tenant_memberships WHERE "tenant_id" = $1 AND "status" = 'requested'`,
    [tenantId],
  );
  return (result.rows[0] as { n: number } | undefined)?.n ?? 0;
};

export const findCmApprovedMembership = async (userId: string, tenantId: string): Promise<CmMembershipRecord | null> => {
  const { tenancy } = getCmIdentity();
  const row = await tenancy.memberships.findApprovedMembership(userId, tenantId);
  return row
    ? {
        userId: row.userId,
        tenantId: row.tenantId,
        status: row.status,
        role: row.tenantRole,
        decidedBy: row.decidedBy ?? null,
        decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
        updatedAt: new Date(row.updatedAt),
      }
    : null;
};

export const setCmMembershipState = async (
  userId: string,
  tenantId: string,
  state: { status: 'invited' | 'requested' | 'approved' | 'rejected' | 'suspended'; role?: 'member' | 'admin'; decidedBy: string },
): Promise<CmMembershipRecord> => {
  const { tenancy } = getCmIdentity();
  const now = new Date().toISOString();
  const existing = await tenancy.memberships.findMembership(userId, tenantId);
  const row = await tenancy.memberships.setMembershipState(userId, tenantId, {
    status: state.status,
    tenantRole: state.role ?? existing?.tenantRole ?? 'member',
    decidedBy: state.decidedBy,
    decidedAt: now,
    updatedAt: now,
  });
  return {
    userId: row.userId,
    tenantId: row.tenantId,
    status: row.status,
    role: row.tenantRole,
    decidedBy: row.decidedBy ?? null,
    decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
    updatedAt: new Date(row.updatedAt),
  };
};

export const upsertCmMembershipRequest = async (
  userId: string,
  tenantId: string,
  role: 'member' | 'admin' = 'member',
): Promise<CmMembershipRecord> => {
  const { tenancy } = getCmIdentity();
  const row = await tenancy.memberships.upsertMembershipRequest({
    userId,
    tenantId,
    status: 'requested',
    tenantRole: role,
    updatedAt: new Date().toISOString(),
  });
  return {
    userId: row.userId,
    tenantId: row.tenantId,
    status: row.status,
    role: row.tenantRole,
    decidedBy: row.decidedBy ?? null,
    decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
    updatedAt: new Date(row.updatedAt),
  };
};

export const findCmWorkspace = async (workspaceId: string): Promise<CmWorkspaceRecord | null> => {
  const { tenancy } = getCmIdentity();
  const row = await tenancy.workspaces.findWorkspace(workspaceId);
  return row
    ? {
        workspaceId: row.workspaceId,
        tenantId: row.tenantId,
        repoIdentity: row.repoIdentity,
        aliases: row.aliases,
        enrolledAt: new Date(row.enrolledAt),
      }
    : null;
};

export const listCmWorkspacesForTenant = async (tenantId: string): Promise<CmWorkspaceRecord[]> => {
  const { tenancy } = getCmIdentity();
  const rows = await tenancy.workspaces.listWorkspacesForTenant(tenantId);
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    tenantId: row.tenantId,
    repoIdentity: row.repoIdentity,
    aliases: row.aliases,
    enrolledAt: new Date(row.enrolledAt),
  }));
};

export const listCmWorkspaceMembers = async (workspaceId: string) => {
  const { tenancy } = getCmIdentity();
  return tenancy.workspaceMembers.listWorkspaceMembers(workspaceId);
};

export const findCmWorkspaceMember = async (workspaceId: string, userId: string) => {
  const { tenancy } = getCmIdentity();
  return tenancy.workspaceMembers.findWorkspaceMember(workspaceId, userId);
};

export interface CmWorkspaceMembershipRecord {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: 'viewer' | 'commenter' | 'editor' | 'admin';
}

/** Workspace memberships are keyed by workspace in the CM store; the per-user
 *  enumeration is a raw read over `cm_workspace_members`. */
export const listCmWorkspaceMembershipsForUser = async (userId: string): Promise<CmWorkspaceMembershipRecord[]> => {
  const { pool } = await import('../../db/client');
  const result = await pool.query(
    `SELECT "workspace_id", "user_id", "role" FROM "cm_identity"."cm_workspace_members" WHERE "user_id" = $1`,
    [userId],
  );
  return result.rows.map((row) => ({
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    role: String(row.role) as CmWorkspaceMembershipRecord['role'],
  }));
};

/** Authoritative workspace -> tenant resolution (replaces resolve-tenant.ts). */
export const resolveCmTenantAuthoritatively = async (input: {
  workspaceId: string;
  userId: string;
}) => {
  const { resolver } = getCmIdentity();
  return resolver.resolveAuthoritatively(input);
};

export type CmResolveTenantResult =
  | { tenantId: string }
  | { error: 'unknown' | 'ambiguous_tenant' };

/** Same result shape as the legacy `resolveTenantAuthoritatively` seam, over CM. */
export const resolveCmTenant = async (input: {
  workspaceId: string;
  userId: string;
}): Promise<CmResolveTenantResult> => {
  try {
    const resolved = await resolveCmTenantAuthoritatively(input);
    return { tenantId: resolved.tid };
  } catch {
    return { error: 'unknown' };
  }
};

/** Raised by `reconcileCmTenantId` when a tenant cannot be resolved (fail-closed). */
export class CmTenantResolutionError extends Error {
  constructor(
    public readonly reason: 'unknown' | 'ambiguous_tenant',
    public readonly path: string,
    public readonly workspaceId: string,
  ) {
    super(`tenant resolution failed (${reason}) at '${path}' for workspace '${workspaceId}'`);
    this.name = 'CmTenantResolutionError';
  }
}

/**
 * Strict-only replacement for the legacy mode-aware `reconcileTenantId`: resolution is
 * always authoritative through the CM resolver; an unresolved input DENIES (throws).
 * Without an acting user (background/AI-read paths) it resolves workspace -> tenant only.
 */
export const reconcileCmTenantId = async (input: {
  workspaceId: string;
  userId?: string;
  path: string;
}): Promise<string> => {
  try {
    if (input.userId) {
      const resolved = await resolveCmTenantAuthoritatively({ workspaceId: input.workspaceId, userId: input.userId });
      return resolved.tid;
    }
    const workspace = await findCmWorkspace(input.workspaceId);
    if (!workspace) throw new Error('unknown');
    const tenant = await findCmTenant(workspace.tenantId);
    if (!tenant || tenant.status !== 'active') throw new Error('unknown');
    return tenant.slug;
  } catch (error) {
    throw new CmTenantResolutionError('unknown', input.path, input.workspaceId);
  }
};

/** `tid` claim issuance from an approved membership (replaces the OAuth tid legs). */
export const issueCmTid = async (input: { userId: string; tenantId: string }, now = new Date()) => {
  const { tid } = getCmIdentity();
  return tid.issueTid(input, now.toISOString());
};

/** Enrol a workspace in the CM directory (A2.2). `repoIdentity` null = repo-less (Q-A). */
export const enrolCmWorkspace = async (input: {
  workspaceId: string;
  tenantId: string;
  repoIdentity?: string | null;
  aliases?: string[];
  enrolledAt?: Date;
}): Promise<void> => {
  const { tenancy } = getCmIdentity();
  await tenancy.workspaces.enrolWorkspace({
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    repoIdentity: input.repoIdentity ?? null,
    aliases: input.aliases ?? [],
    enrolledAt: (input.enrolledAt ?? new Date()).toISOString(),
  });
};

/** Put (upsert) a workspace member role in the CM store. */
export const putCmWorkspaceMember = async (
  workspaceId: string,
  userId: string,
  role: 'viewer' | 'commenter' | 'editor' | 'admin',
): Promise<void> => {
  const { tenancy } = getCmIdentity();
  await tenancy.workspaceMembers.putWorkspaceMember({ workspaceId, userId, role });
};

/** Remove a workspace member from the CM store. */
export const removeCmWorkspaceMember = async (workspaceId: string, userId: string): Promise<boolean> => {
  const { tenancy } = getCmIdentity();
  return tenancy.workspaceMembers.removeWorkspaceMember(workspaceId, userId);
};
