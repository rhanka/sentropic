import { Hono } from 'hono';
import { db } from '../../db/client';
import { workspaces, workspaceMemberships, folders, initiatives } from '../../db/schema';
import { and, count, eq, isNull, max, sql } from 'drizzle-orm';

export const neutralRouter = new Hono();

/**
 * GET /api/v1/neutral/dashboard
 *
 * Aggregates workspace stats for the authenticated user:
 * - initiative count per workspace
 * - folder count per workspace
 * - last activity (most recent initiative/folder creation)
 *
 * Excludes hidden workspaces and the user's neutral workspace itself
 * (neutral is the orchestrator, not a listed item).
 */
neutralRouter.get('/dashboard', async (c) => {
  const user = c.get('user') as { userId: string };

  // Get all non-hidden workspaces the user is a member of (except neutral)
  const userWorkspaces = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      type: workspaces.type,
      createdAt: workspaces.createdAt,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMemberships.userId, user.userId),
        isNull(workspaces.hiddenAt),
        sql`${workspaces.type} != 'neutral'`
      )
    );

  // Aggregate stats per workspace
  const result = await Promise.all(
    userWorkspaces.map(async (ws) => {
      const [initiativeStats] = await db
        .select({
          count: count(),
          lastCreated: max(initiatives.createdAt),
        })
        .from(initiatives)
        .where(eq(initiatives.workspaceId, ws.id));

      const [folderStats] = await db
        .select({
          count: count(),
          lastCreated: max(folders.createdAt),
        })
        .from(folders)
        .where(eq(folders.workspaceId, ws.id));

      // Last activity = most recent between initiative and folder creation
      const dates = [
        initiativeStats?.lastCreated,
        folderStats?.lastCreated,
        ws.createdAt,
      ].filter(Boolean) as Date[];

      const lastActivity = dates.length > 0
        ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString()
        : null;

      return {
        id: ws.id,
        name: ws.name,
        type: ws.type,
        initiativeCount: Number(initiativeStats?.count ?? 0),
        folderCount: Number(folderStats?.count ?? 0),
        lastActivity,
      };
    })
  );

  // Sort by last activity descending
  result.sort((a, b) => {
    if (!a.lastActivity && !b.lastActivity) return 0;
    if (!a.lastActivity) return 1;
    if (!b.lastActivity) return -1;
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
  });

  return c.json({ workspaces: result });
});
