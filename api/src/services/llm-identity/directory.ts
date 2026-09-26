/**
 * Read-only LLM identity directory over EXISTING stores (D4, BRDP-EX8; G1b deferred: no identity
 * table). Every call reads the database, so a revoked client or a removed/suspended membership is
 * observed on the next admission. Errors propagate; `caller-auth.ts` turns them into a sanitized
 * unavailable error, never an allow.
 */
import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { serviceClients, tenantMemberships, tenants, workspaceMemberships, workspaces } from '../../db/schema';
import type {
  LlmIdentityDirectoryPort,
  ServiceClientRecord,
  UserWorkspaceGrant,
  WorkspaceTenantRecord,
} from './caller-auth';

type Database = Pick<typeof db, 'select'>;

export const createLlmIdentityDirectory = (database: Database = db): LlmIdentityDirectoryPort => ({
  async listUserWorkspaceGrants(userId: string): Promise<readonly UserWorkspaceGrant[]> {
    const rows = await database
      .select({
        workspaceId: workspaceMemberships.workspaceId,
        workspaceTenantId: workspaces.tenantId,
        hiddenAt: workspaces.hiddenAt,
        tenantStatus: tenants.status,
        tenantMembershipStatus: tenantMemberships.status,
      })
      .from(workspaceMemberships)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
      .leftJoin(tenants, eq(tenants.id, workspaces.tenantId))
      .leftJoin(
        tenantMemberships,
        and(eq(tenantMemberships.tenantId, workspaces.tenantId), eq(tenantMemberships.userId, workspaceMemberships.userId)),
      )
      .where(eq(workspaceMemberships.userId, userId));
    return rows.map((row) => ({
      workspaceId: row.workspaceId,
      workspaceTenantId: row.workspaceTenantId,
      workspaceHidden: row.hiddenAt !== null,
      tenantStatus: row.tenantStatus ?? null,
      tenantMembershipStatus: row.tenantMembershipStatus ?? null,
    }));
  },

  async findServiceClient(clientId: string): Promise<ServiceClientRecord | null> {
    const [row] = await database
      .select({
        clientId: serviceClients.clientId,
        tenantId: serviceClients.tenantId,
        revokedAt: serviceClients.revokedAt,
        dpopBound: serviceClients.dpopBoundAccessTokens,
      })
      .from(serviceClients)
      .where(eq(serviceClients.clientId, clientId))
      .limit(1);
    if (!row) return null;
    return { clientId: row.clientId, tenantId: row.tenantId ?? null, revoked: row.revokedAt !== null, dpopBound: row.dpopBound };
  },

  async findWorkspaceTenant(workspaceId: string): Promise<WorkspaceTenantRecord | null> {
    const [row] = await database
      .select({ tenantId: workspaces.tenantId, hiddenAt: workspaces.hiddenAt, tenantStatus: tenants.status })
      .from(workspaces)
      .leftJoin(tenants, eq(tenants.id, workspaces.tenantId))
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!row) return null;
    return { workspaceId, tenantId: row.tenantId, hidden: row.hiddenAt !== null, tenantStatus: row.tenantStatus ?? null };
  },
});
