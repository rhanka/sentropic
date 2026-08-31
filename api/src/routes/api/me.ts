import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../../db/client';
import { workspaces } from '../../db/schema';

export const meRouter = new Hono();

const patchMeSchema = z.object({
  workspaceName: z.string().min(1).max(128).optional(),
});

meRouter.patch('/', zValidator('json', patchMeSchema), async (c) => {
  const { userId, workspaceId } = c.get('user');
  const { workspaceName } = c.req.valid('json');
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerUserId, userId)))
    .limit(1);

  if (!workspace) return c.json({ error: 'Workspace not found' }, 404);

  await db
    .update(workspaces)
    .set({
      ...(workspaceName === undefined ? {} : { name: workspaceName }),
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  return c.json({ success: true });
});
