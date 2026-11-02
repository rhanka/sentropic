import { pool } from '../db/client';
import { createWorkspaceDirectory, IdentityCustodyErrorV1, TenantNotActiveError } from '@sentropic/cluster-mesh';
import { workspaces } from '../db/schema';
import { getDefaultGateConfig } from './gate-service';
import { todoOrchestrationService } from './todo-orchestration';
import { viewTemplateService } from './view-template-service';
import type { WorkspaceType } from './workspace-access';
import { bindCmAppDatabase, type CmIdentityTransaction } from './identity/cm-transaction';
import { CmIdentityForbiddenError } from './identity/cm-deletion-authorization';
import { PLATFORM_TENANT_ID } from './workspace-service';

export interface ProvisionWorkspaceInput {
  readonly workspaceId: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly type: WorkspaceType;
  readonly tenantId?: string;
}

/**
 * CM directory, creator membership and business metadata share one transaction.
 * The existing owner reference is business data used for destruction policy.
 */
export const provisionWorkspace = async (
  tx: CmIdentityTransaction,
  input: ProvisionWorkspaceInput,
): Promise<string> => {
  const id = input.workspaceId;
  await tx.lockSubject(input.ownerUserId);
  const account = await tx.stores.accounts.findAccount(input.ownerUserId);
  if (!account || account.accountStatus !== 'active' || !['editor', 'admin_org', 'admin_app'].includes(account.globalRole)) {
    throw new CmIdentityForbiddenError();
  }
  if (!await tx.custody.profiles.find(input.ownerUserId)) throw new IdentityCustodyErrorV1('identity_material_missing');
  const tenantId = input.tenantId ?? PLATFORM_TENANT_ID;
  const tenant = await tx.stores.tenants.findTenant(tenantId);
  if (!tenant || tenant.status !== 'active') throw new TenantNotActiveError(tenantId);
  if (!await tx.stores.memberships.findApprovedMembership(input.ownerUserId, tenantId)) throw new CmIdentityForbiddenError();
  await createWorkspaceDirectory({ workspaces: tx.stores.workspaces, members: tx.stores.workspaceMembers,
    audit: tx.stores.audit }).enrolWorkspace({ workspaceId: id, tenantId, repoIdentity: null, creatorUserId: input.ownerUserId });
  const now = new Date();
  const gateConfig = getDefaultGateConfig(input.type);
  await bindCmAppDatabase(tx).insert(workspaces).values({
    id,
    ownerUserId: input.ownerUserId,
    name: input.name,
    type: input.type,
    gateConfig: gateConfig ?? undefined,
    createdAt: now,
    updatedAt: now,
  });
  return id;
};

const escapeNotifyPayload = (payload: Record<string, unknown>): string =>
  JSON.stringify(payload).replace(/'/g, "''");

export async function notifyWorkspaceEvent(
  workspaceId: string,
  data: Record<string, unknown> = {},
  userIds?: string[],
): Promise<void> {
  const client = await pool.connect();
  try {
    const payload = {
      workspace_id: workspaceId,
      data,
      ...(userIds && userIds.length > 0 ? { user_ids: userIds } : {}),
    };
    await client.query(`NOTIFY workspace_events, '${escapeNotifyPayload(payload)}'`);
  } finally {
    client.release();
  }
}

export async function notifyWorkspaceMembershipEvent(
  workspaceId: string,
  userId: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const client = await pool.connect();
  try {
    const payload = { workspace_id: workspaceId, user_id: userId, data };
    await client.query(`NOTIFY workspace_membership_events, '${escapeNotifyPayload(payload)}'`);
  } finally {
    client.release();
  }
}

export async function notifyWorkspaceCreated(workspaceId: string, userId: string): Promise<void> {
  await notifyWorkspaceEvent(workspaceId, { action: 'created' });
  await notifyWorkspaceMembershipEvent(workspaceId, userId, { action: 'added', role: 'admin' });
}

export interface SeedWorkspaceTypeResourcesInput {
  readonly userId: string;
  readonly role: string;
  readonly workspaceId: string;
  readonly type: WorkspaceType;
}

/**
 * Post-commit seeds for a workspace of a given type: workflows/agents and
 * view templates. Each step is non-fatal (logs and continues), exactly like
 * the canonical product route. Shared by the route and session adoption so
 * both creation paths seed identically.
 */
export const seedWorkspaceTypeResources = async (
  input: SeedWorkspaceTypeResourcesInput,
): Promise<void> => {
  try {
    await todoOrchestrationService.seedWorkflowsForType(
      { userId: input.userId, role: input.role, workspaceId: input.workspaceId }, input.type,
    );
  } catch (seedErr) {
    console.error('Failed to seed workflows for workspace type', input.type, seedErr);
  }
  try {
    await viewTemplateService.seedForWorkspace(input.workspaceId, input.type);
  } catch (seedErr) {
    console.error('Failed to seed view templates for workspace type', input.type, seedErr);
  }
};
