import { pool } from '../db/client';
import type { db } from '../db/client';
import { workspaceMemberships, workspaces } from '../db/schema';
import { createId } from '../utils/id';
import { getDefaultGateConfig } from './gate-service';
import type { WorkspaceType } from './workspace-access';

export type ProvisionWorkspaceClient = Pick<typeof db, 'insert'>;

export interface ProvisionWorkspaceInput {
  readonly ownerUserId: string;
  readonly name: string;
  readonly type: WorkspaceType;
  readonly tenantId?: string;
}

/**
 * Canonical workspace rows: the workspace plus its creator-as-admin
 * membership. Runs inside the caller's transaction so a failed follow-up
 * step rolls the workspace back instead of orphaning it.
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
    ownerUserId: input.ownerUserId,
    name: input.name,
    type: input.type,
    gateConfig: gateConfig ?? undefined,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    createdAt: now,
    updatedAt: now,
  });
  await client.insert(workspaceMemberships).values({
    workspaceId: id,
    userId: input.ownerUserId,
    role: 'admin',
    createdAt: now,
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
