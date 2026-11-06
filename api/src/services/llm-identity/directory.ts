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

import type { db } from '../../db/client';
import { serviceClients, workspaces } from '../../db/schema';
import { findCmMembership, findCmTenant, findCmWorkspace, listCmWorkspaceMembershipsForUser } from '../identity/cm-tenancy';
import { bindCmAppDatabase, runCmIdentityRead, type CmIdentityTransaction } from '../identity/cm-transaction';
import { findCmServiceClientTenant } from '../identity/cm-service-clients';
import type {
  LlmIdentityDirectoryPort,
  ServiceClientRecord,
  UserWorkspaceGrant,
  WorkspaceTenantRecord,
} from './caller-auth';

type Database = Pick<typeof db, 'select'>;

export const createLlmIdentityDirectory = (
  databaseForTransaction: (tx: CmIdentityTransaction) => Database = bindCmAppDatabase,
): LlmIdentityDirectoryPort => ({
  listUserWorkspaceGrants: (userId: string): Promise<readonly UserWorkspaceGrant[]> => runCmIdentityRead(async tx => {
    const database = databaseForTransaction(tx);
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
      if (!tenant) continue;
      const tenantMembership = await findCmMembership(userId, cmWorkspace.tenantId);
      grants.push({
        workspaceId: membership.workspaceId,
        workspaceTenantId: tenant.slug,
        workspaceHidden: ws.hiddenAt !== null,
        tenantStatus: tenant?.status ?? null,
        tenantMembershipStatus: tenantMembership?.status ?? null,
      });
    }
    return grants;
  }),

  findServiceClient: (clientId: string): Promise<ServiceClientRecord | null> => runCmIdentityRead(async tx => {
    const database = databaseForTransaction(tx);
    const [row] = await database
      .select({
        clientId: serviceClients.clientId,
        revokedAt: serviceClients.revokedAt,
        dpopBound: serviceClients.dpopBoundAccessTokens,
      })
      .from(serviceClients)
      .where(eq(serviceClients.clientId, clientId))
      .limit(1);
    if (!row) return null;
    return { clientId: row.clientId, tenantId: await findCmServiceClientTenant(clientId),
      revoked: row.revokedAt !== null, dpopBound: row.dpopBound };
  }),

  findWorkspaceTenant: (workspaceId: string): Promise<WorkspaceTenantRecord | null> => runCmIdentityRead(async tx => {
    const database = databaseForTransaction(tx);
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
    return tenant ? { workspaceId, tenantId: tenant.slug, hidden: row.hiddenAt !== null, tenantStatus: tenant.status } : null;
  }),
});
