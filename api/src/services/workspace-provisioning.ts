import { pool } from '../db/client';
import type { db } from '../db/client';
import { workspaces } from '../db/schema';
import { createId } from '../utils/id';
import { getDefaultGateConfig } from './gate-service';
import { todoOrchestrationService } from './todo-orchestration';
import { viewTemplateService } from './view-template-service';
import type { WorkspaceType } from './workspace-access';
import { enrolCmWorkspace, putCmWorkspaceMember } from './identity/cm-tenancy';
import { PLATFORM_TENANT_ID } from './workspace-service';

export type ProvisionWorkspaceClient = Pick<typeof db, 'insert'>;

export interface ProvisionWorkspaceInput {
  readonly ownerUserId: string;
  readonly name: string;
  readonly type: WorkspaceType;
  readonly tenantId?: string;
}

/**
 * Canonical workspace rows: the business row in the caller's transaction, plus
 * the CM directory enrolment and creator-as-admin membership in the CM store
 * (cm_identity.cm_workspaces / cm_workspace_members — the legacy
 * `workspace_memberships` table and `workspaces.owner_user_id` are dropped by
 * control migration 0014).
 */
export const provisionWorkspace = async (
  client: ProvisionWorkspaceClient,
  input: ProvisionWorkspaceInput,
): Promise<string> => {
  const id = createId();
  const now = new Date();
  const gateConfig = getDefaultGateConfig(input.type);
  await client.insert(workspaces).values({
    id,
    name: input.name,
    type: input.type,
    gateConfig: gateConfig ?? undefined,
    createdAt: now,
    updatedAt: now,
  });
  await enrolCmWorkspace({ workspaceId: id, tenantId: input.tenantId ?? PLATFORM_TENANT_ID });
  await putCmWorkspaceMember(id, input.ownerUserId, 'admin');
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
