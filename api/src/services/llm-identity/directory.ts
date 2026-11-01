/**
 * Read-only LLM identity directory over EXISTING stores (D4, BRDP-EX8; G1b deferred: no identity
 * table). Every call reads the database, so a revoked client or a removed/suspended membership is
 * observed on the next admission. Errors propagate; `caller-auth.ts` turns them into a sanitized
 * unavailable error, never an allow.
 *
 * Lot A4: workspace memberships, tenants and tenant memberships resolve through the CM identity
 * stores; only business rows (workspaces) and the surviving service_clients table are app-side.
 */
import { eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { serviceClients, workspaces } from '../../db/schema';
import { findCmMembership, findCmTenant, findCmWorkspace, listCmWorkspaceMembershipsForUser } from '../identity/cm-tenancy';
import type {
  LlmIdentityDirectoryPort,
  ServiceClientRecord,
  UserWorkspaceGrant,
  WorkspaceTenantRecord,
} from './caller-auth';

type Database = Pick<typeof db, 'select'>;

export const createLlmIdentityDirectory = (database: Database = db): LlmIdentityDirectoryPort => ({
  async listUserWorkspaceGrants(userId: string): Promise<readonly UserWorkspaceGrant[]> {
    const memberships = await listCmWorkspaceMembershipsForUser(userId);
    const grants: UserWorkspaceGrant[] = [];
    for (const membership of memberships) {
      const [ws] = await database
        .select({ hiddenAt: workspaces.hiddenAt })
        .from(workspaces)
        .where(eq(workspaces.id, membership.workspaceId))
        .limit(1);
      if (!ws) continue;
      const cmWorkspace = await findCmWorkspace(membership.workspaceId);
      // Fail closed: a workspace without CM enrolment has no tenant and is skipped.
      if (!cmWorkspace) continue;
      const tenant = await findCmTenant(cmWorkspace.tenantId);
      const tenantMembership = await findCmMembership(userId, cmWorkspace.tenantId);
      grants.push({
        workspaceId: membership.workspaceId,
        workspaceTenantId: cmWorkspace.tenantId,
        workspaceHidden: ws.hiddenAt !== null,
        tenantStatus: tenant?.status ?? null,
        tenantMembershipStatus: tenantMembership?.status ?? null,
      });
    }
    return grants;
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
      .select({ hiddenAt: workspaces.hiddenAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!row) return null;
    // Lot A4: the workspace -> tenant binding lives in the CM workspace directory.
    // Fail closed: a workspace without CM enrolment resolves to no tenant record.
    const cmWorkspace = await findCmWorkspace(workspaceId);
    if (!cmWorkspace) return null;
    const tenant = await findCmTenant(cmWorkspace.tenantId);
    return { workspaceId, tenantId: cmWorkspace.tenantId, hidden: row.hiddenAt !== null, tenantStatus: tenant?.status ?? null };
  },
});
