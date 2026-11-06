import { zValidator } from '../../utils/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../../db/client';
import { workspaces } from '../../db/schema';
import { findCmWorkspaceMember } from '../../services/identity/cm-tenancy';

const patchMeSchema = z.object({
  workspaceName: z.string().min(1).max(128).optional(),
});

export const createProductWorkspaceConfigRouter = (): Hono => {
  const router = new Hono();

  router.patch('/', zValidator('json', patchMeSchema), async (context) => {
    const { userId, workspaceId } = context.get('user');
    const { workspaceName } = context.req.valid('json');
    // Rename is a business-owner capability (the deletion plane likewise authorizes
    // destruction via owner_user_id); CM admin membership additionally qualifies.
    const [workspace, membership] = await Promise.all([
      db.select({ id: workspaces.id, ownerUserId: workspaces.ownerUserId })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1),
      findCmWorkspaceMember(workspaceId, userId),
    ]);
    if (!workspace[0] || (workspace[0].ownerUserId !== userId && membership?.role !== 'admin')) {
      return context.json({ error: 'Workspace not found' }, 404);
    }

    await db.update(workspaces).set({
      ...(workspaceName === undefined ? {} : { name: workspaceName }),
      updatedAt: new Date(),
    }).where(eq(workspaces.id, workspaceId));
    return context.json({ success: true });
  });

  return router;
};
