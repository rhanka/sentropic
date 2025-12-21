import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { ADMIN_WORKSPACE_ID, workspaces } from '../db/schema';

/**
 * Resolve a workspace scope for admin_app reads.
 * - Non-admins: always own workspace
 * - admin_app: can request another workspace only if share_with_admin=true (or Admin Workspace)
 */
export async function resolveReadableWorkspaceId(params: {
  user: { role?: string; workspaceId: string };
  requested?: string | null;
}): Promise<string> {
  const { user, requested } = params;
  const req = (requested ?? '').trim();

  if (!req) return user.workspaceId;
  if (user.role !== 'admin_app') return user.workspaceId;
  if (req === ADMIN_WORKSPACE_ID) return req;

  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, req), eq(workspaces.shareWithAdmin, true)))
    .limit(1);

  if (!ws) {
    // opaque (avoid information leaks)
    throw new Error('Workspace not accessible');
  }

  return req;
}


