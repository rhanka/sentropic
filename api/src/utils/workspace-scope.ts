import { ADMIN_WORKSPACE_ID } from '../db/schema';
import { getWorkspaceRole } from '../services/workspace-access';

/**
 * Resolve a workspace scope for admin_app reads.
 * - Non-admins: always own workspace
 * - admin_app: can request another workspace only if they are a member (or Admin Workspace)
 */
export async function resolveReadableWorkspaceId(params: {
  user: { role?: string; workspaceId: string; userId: string };
  requested?: string | null;
}): Promise<string> {
  const { user, requested } = params;
  const req = (requested ?? '').trim();

  if (!req) return user.workspaceId;
  if (user.role !== 'admin_app') return user.workspaceId;
  if (req === ADMIN_WORKSPACE_ID) return req;

  const role = await getWorkspaceRole(user.userId, req);
  if (!role) {
    // opaque (avoid information leaks)
    throw new Error('Workspace not accessible');
  }

  return req;
}


