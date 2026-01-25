import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db, pool } from '../../db/client';
import {
  chatGenerationTraces,
  chatSessions,
  contextDocuments,
  jobQueue,
  useCases,
  folders,
  organizations,
  users,
  workspaceMemberships,
  workspaces
} from '../../db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { requireEditor } from '../../middleware/rbac';
import { createId } from '../../utils/id';
import { getUserWorkspaces, requireWorkspaceAdmin } from '../../services/workspace-access';

export const workspacesRouter = new Hono();

const roleSchema = z.enum(['viewer', 'editor', 'admin']);

function escapeNotifyPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).replace(/'/g, "''");
}

async function notifyWorkspaceEvent(workspaceId: string, data: Record<string, unknown> = {}, userIds?: string[]) {
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

async function notifyWorkspaceMembershipEvent(
  workspaceId: string,
  userId: string,
  data: Record<string, unknown> = {}
) {
  const client = await pool.connect();
  try {
    const payload = { workspace_id: workspaceId, user_id: userId, data };
    await client.query(`NOTIFY workspace_membership_events, '${escapeNotifyPayload(payload)}'`);
  } finally {
    client.release();
  }
}

workspacesRouter.get('/', async (c) => {
  const user = c.get('user') as { userId: string };
  const items = await getUserWorkspaces(user.userId);
  return c.json({ items });
});

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(128),
});

// Create workspace: creator becomes admin member
workspacesRouter.post('/', requireEditor, zValidator('json', createWorkspaceSchema), async (c) => {
  const user = c.get('user') as { userId: string; role: string };

  const { name } = c.req.valid('json');
  const id = createId();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({
      id,
      ownerUserId: user.userId,
      name,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(workspaceMemberships).values({
      workspaceId: id,
      userId: user.userId,
      role: 'admin',
      createdAt: now,
    });
  });

  await notifyWorkspaceEvent(id, { action: 'created' });
  await notifyWorkspaceMembershipEvent(id, user.userId, { action: 'added', role: 'admin' });

  return c.json({ id }, 201);
});

// Update workspace metadata (admin-only)
const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(128),
});

workspacesRouter.put('/:id', requireEditor, zValidator('json', updateWorkspaceSchema), async (c) => {
  const user = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id');
  try {
    await requireWorkspaceAdmin(user.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const { name } = c.req.valid('json');
  const now = new Date();
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) return c.json({ message: 'Not found' }, 404);
  await db.update(workspaces).set({ name, updatedAt: now }).where(eq(workspaces.id, workspaceId));
  await notifyWorkspaceEvent(workspaceId, { action: 'renamed' });
  return c.json({ success: true });
});

// --- Hide / Unhide / Delete (admin-only) ---

workspacesRouter.post('/:id/hide', requireEditor, async (c) => {
  const user = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id');
  try {
    await requireWorkspaceAdmin(user.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const now = new Date();
  await db.update(workspaces).set({ hiddenAt: now, updatedAt: now }).where(eq(workspaces.id, workspaceId));
  await notifyWorkspaceEvent(workspaceId, { action: 'hidden' });
  return c.json({ success: true });
});

workspacesRouter.post('/:id/unhide', requireEditor, async (c) => {
  const user = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id');
  try {
    await requireWorkspaceAdmin(user.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const now = new Date();
  await db.update(workspaces).set({ hiddenAt: null, updatedAt: now }).where(eq(workspaces.id, workspaceId));
  await notifyWorkspaceEvent(workspaceId, { action: 'unhidden' });
  return c.json({ success: true });
});

// Hard delete (only if hidden)
workspacesRouter.delete('/:id', requireEditor, async (c) => {
  const user = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id');
  try {
    await requireWorkspaceAdmin(user.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const [ws] = await db
    .select({ hiddenAt: workspaces.hiddenAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!ws) return c.json({ message: 'Not found' }, 404);
  if (!ws.hiddenAt) return c.json({ message: 'Workspace must be hidden before deletion' }, 400);

  const members = await db
    .select({ userId: workspaceMemberships.userId })
    .from(workspaceMemberships)
    .where(eq(workspaceMemberships.workspaceId, workspaceId));
  const memberUserIds = members.map((m) => m.userId);

  await db.transaction(async (tx) => {
    // Detach traces that use workspace FK (optional; keep history)
    await tx.update(chatGenerationTraces).set({ workspaceId: null }).where(eq(chatGenerationTraces.workspaceId, workspaceId));

    // Delete chat sessions scoped to workspace (cascades to messages/contexts/events via FK)
    await tx.delete(chatSessions).where(eq(chatSessions.workspaceId, workspaceId));

    // Documents (versions cascade)
    await tx.delete(contextDocuments).where(eq(contextDocuments.workspaceId, workspaceId));

    // Jobs (history references are set null)
    await tx.delete(jobQueue).where(eq(jobQueue.workspaceId, workspaceId));

    // Core business tables
    await tx.delete(useCases).where(eq(useCases.workspaceId, workspaceId));
    await tx.delete(folders).where(eq(folders.workspaceId, workspaceId));
    await tx.delete(organizations).where(eq(organizations.workspaceId, workspaceId));

    // Memberships (FK cascade also applies, but explicit is fine)
    await tx.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));

    // Finally delete workspace
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  await notifyWorkspaceEvent(workspaceId, { action: 'deleted' }, memberUserIds);

  return c.body(null, 204);
});

// --- Members management (admin-only) ---

workspacesRouter.get('/:id/members', async (c) => {
  const user = c.get('user') as { userId: string };
  const workspaceId = c.req.param('id');

  try {
    await requireWorkspaceAdmin(user.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: workspaceMemberships.role,
      createdAt: workspaceMemberships.createdAt,
    })
    .from(workspaceMemberships)
    .innerJoin(users, eq(workspaceMemberships.userId, users.id))
    .where(eq(workspaceMemberships.workspaceId, workspaceId))
    .orderBy(desc(workspaceMemberships.createdAt));

  return c.json({ items: rows });
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: roleSchema,
});

workspacesRouter.post('/:id/members', requireEditor, zValidator('json', addMemberSchema), async (c) => {
  const actor = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id');
  try {
    await requireWorkspaceAdmin(actor.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const body = c.req.valid('json');
  const normalizedEmail = body.email.trim().toLowerCase();

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (!target) return c.json({ message: 'User not found' }, 404);

  const now = new Date();
  await db
    .insert(workspaceMemberships)
    .values({
      workspaceId,
      userId: target.id,
      role: body.role,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      set: { role: body.role },
    });

  await notifyWorkspaceMembershipEvent(workspaceId, target.id, { action: 'added', role: body.role });
  return c.json({ success: true });
});

const updateMemberSchema = z.object({
  role: roleSchema,
});

async function updateMemberRoleHandler(c: Context) {
  const actor = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  if (targetUserId === actor.userId) return c.json({ message: 'Cannot change your own role' }, 400);

  try {
    await requireWorkspaceAdmin(actor.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  // Avoid relying on typed `c.req.valid()` here: this handler is shared between PATCH and PUT,
  // and TypeScript cannot infer the validated type through the function boundary.
  const raw = await c.req.json().catch(() => null);
  const parsed = updateMemberSchema.safeParse(raw);
  if (!parsed.success) return c.json({ message: 'Invalid body' }, 400);
  const { role } = parsed.data;
  await db
    .update(workspaceMemberships)
    .set({ role })
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, targetUserId)));

  await notifyWorkspaceMembershipEvent(workspaceId, targetUserId, { action: 'role_updated', role });
  return c.json({ success: true });
}

// Support both PATCH and PUT for ergonomics/backward compatibility with UI callers.
workspacesRouter.patch('/:id/members/:userId', requireEditor, zValidator('json', updateMemberSchema), updateMemberRoleHandler);
workspacesRouter.put('/:id/members/:userId', requireEditor, zValidator('json', updateMemberSchema), updateMemberRoleHandler);

workspacesRouter.delete('/:id/members/:userId', requireEditor, async (c) => {
  const actor = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  if (targetUserId === actor.userId) return c.json({ message: 'Cannot remove yourself' }, 400);

  try {
    await requireWorkspaceAdmin(actor.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  await db
    .delete(workspaceMemberships)
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, targetUserId)));

  await notifyWorkspaceMembershipEvent(workspaceId, targetUserId, { action: 'removed' });
  return c.body(null, 204);
});


