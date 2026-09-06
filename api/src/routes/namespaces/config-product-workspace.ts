import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../../db/client';
import { workspaces } from '../../db/schema';

const patchMeSchema = z.object({
  workspaceName: z.string().min(1).max(128).optional(),
});

export const createProductWorkspaceConfigRouter = (): Hono => {
  const router = new Hono();

  router.patch('/', zValidator('json', patchMeSchema), async (context) => {
    const { userId, workspaceId } = context.get('user');
    const { workspaceName } = context.req.valid('json');
    const [workspace] = await db.select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerUserId, userId)))
      .limit(1);
    if (!workspace) return context.json({ error: 'Workspace not found' }, 404);

    await db.update(workspaces).set({
      ...(workspaceName === undefined ? {} : { name: workspaceName }),
      updatedAt: new Date(),
    }).where(eq(workspaces.id, workspaceId));
    return context.json({ success: true });
  });

  return router;
};
