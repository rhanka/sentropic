import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, pool } from '../../db/client';
import { comments, folders, organizations, useCases, users, workspaceMemberships } from '../../db/schema';
import { requireWorkspaceAccessRole, requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';
import { requireWorkspaceAdmin } from '../../services/workspace-access';
import { createId } from '../../utils/id';

export const commentsRouter = new Hono();

const contextTypeSchema = z.enum(['organization', 'folder', 'usecase', 'matrix', 'executive_summary']);
const statusSchema = z.enum(['open', 'closed']);

function escapeNotifyPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).replace(/'/g, "''");
}

async function notifyCommentEvent(workspaceId: string, contextType: string, contextId: string, data: Record<string, unknown> = {}) {
  const client = await pool.connect();
  try {
    const payload = { workspace_id: workspaceId, context_type: contextType, context_id: contextId, data };
    await client.query(`NOTIFY comment_events, '${escapeNotifyPayload(payload)}'`);
  } finally {
    client.release();
  }
}

async function ensureContextExists(contextType: string, contextId: string, workspaceId: string): Promise<boolean> {
  if (contextType === 'organization') {
    const [row] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, contextId), eq(organizations.workspaceId, workspaceId)))
      .limit(1);
    return !!row;
  }
  if (contextType === 'folder' || contextType === 'matrix' || contextType === 'executive_summary') {
    const [row] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, contextId), eq(folders.workspaceId, workspaceId)))
      .limit(1);
    return !!row;
  }
  if (contextType === 'usecase') {
    const [row] = await db
      .select({ id: useCases.id })
      .from(useCases)
      .where(and(eq(useCases.id, contextId), eq(useCases.workspaceId, workspaceId)))
      .limit(1);
    return !!row;
  }
  return false;
}

async function ensureWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: workspaceMemberships.userId })
    .from(workspaceMemberships)
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId)))
    .limit(1);
  return !!row;
}

const listQuerySchema = z.object({
  context_type: contextTypeSchema,
  context_id: z.string().min(1),
  section_key: z.string().optional(),
  status: statusSchema.optional(),
});

commentsRouter.get('/', requireWorkspaceAccessRole(), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const parsed = listQuerySchema.safeParse({
    context_type: c.req.query('context_type'),
    context_id: c.req.query('context_id'),
    section_key: c.req.query('section_key') || undefined,
    status: c.req.query('status') || undefined,
  });
  if (!parsed.success) return c.json({ message: 'Invalid query' }, 400);

  const { context_type, context_id, section_key, status } = parsed.data;
  const ok = await ensureContextExists(context_type, context_id, user.workspaceId);
  if (!ok) return c.json({ message: 'Not found' }, 404);

  const conditions = [
    eq(comments.workspaceId, user.workspaceId),
    eq(comments.contextType, context_type),
    eq(comments.contextId, context_id),
  ];
  if (section_key) conditions.push(eq(comments.sectionKey, section_key));
  if (status) conditions.push(eq(comments.status, status));

  const rows = await db
    .select()
    .from(comments)
    .where(and(...conditions))
    .orderBy(asc(comments.createdAt));

  const userIds = new Set<string>();
  for (const row of rows) {
    if (row.createdBy) userIds.add(row.createdBy);
    if (row.assignedTo) userIds.add(row.assignedTo);
  }

  const usersById = new Map<string, { id: string; email: string | null; displayName: string | null }>();
  if (userIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, Array.from(userIds)));
    for (const u of userRows) {
      usersById.set(u.id, { id: u.id, email: u.email, displayName: u.displayName });
    }
  }

  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      context_type: row.contextType,
      context_id: row.contextId,
      section_key: row.sectionKey,
      created_by: row.createdBy,
      assigned_to: row.assignedTo,
      status: row.status,
      parent_comment_id: row.parentCommentId,
      content: row.content,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      created_by_user: usersById.get(row.createdBy) ?? null,
      assigned_to_user: row.assignedTo ? usersById.get(row.assignedTo) ?? null : null,
    })),
  });
});

const createSchema = z.object({
  context_type: contextTypeSchema,
  context_id: z.string().min(1),
  section_key: z.string().optional(),
  content: z.string().min(1),
  assigned_to: z.string().optional(),
  parent_comment_id: z.string().optional(),
});

commentsRouter.post('/', requireWorkspaceEditorRole(), zValidator('json', createSchema), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const body = c.req.valid('json');

  const ok = await ensureContextExists(body.context_type, body.context_id, user.workspaceId);
  if (!ok) return c.json({ message: 'Not found' }, 404);

  let parentCommentId: string | null = null;
  if (body.parent_comment_id) {
    const [parent] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, body.parent_comment_id), eq(comments.workspaceId, user.workspaceId)))
      .limit(1);
    if (!parent) return c.json({ message: 'Parent comment not found' }, 404);
    if (parent.parentCommentId) {
      return c.json({ message: 'Only one-level replies are allowed' }, 400);
    }
    if (parent.contextType !== body.context_type || parent.contextId !== body.context_id) {
      return c.json({ message: 'Parent comment context mismatch' }, 400);
    }
    parentCommentId = parent.id;
  }

  const assignedTo = body.assigned_to ?? user.userId;
  if (!(await ensureWorkspaceMember(assignedTo, user.workspaceId))) {
    return c.json({ message: 'Assigned user not in workspace' }, 400);
  }

  const id = createId();
  const now = new Date();
  await db.insert(comments).values({
    id,
    workspaceId: user.workspaceId,
    contextType: body.context_type,
    contextId: body.context_id,
    sectionKey: body.section_key,
    createdBy: user.userId,
    assignedTo,
    status: 'open',
    parentCommentId,
    content: body.content.trim(),
    createdAt: now,
    updatedAt: now,
  });

  await notifyCommentEvent(user.workspaceId, body.context_type, body.context_id, { action: 'created', comment_id: id });
  return c.json({ id }, 201);
});

const updateSchema = z.object({
  content: z.string().min(1).optional(),
  assigned_to: z.string().nullable().optional(),
});

commentsRouter.patch('/:id', requireWorkspaceEditorRole(), zValidator('json', updateSchema), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [row] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, id), eq(comments.workspaceId, user.workspaceId)))
    .limit(1);
  if (!row) return c.json({ message: 'Not found' }, 404);

  const isCreator = row.createdBy === user.userId;
  if (!isCreator) {
    try {
      await requireWorkspaceAdmin(user.userId, user.workspaceId);
    } catch {
      return c.json({ message: 'Insufficient permissions' }, 403);
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.content === 'string') updates.content = body.content.trim();
  if (body.assigned_to !== undefined) {
    const nextAssigned = body.assigned_to ?? row.createdBy;
    if (!(await ensureWorkspaceMember(nextAssigned, user.workspaceId))) {
      return c.json({ message: 'Assigned user not in workspace' }, 400);
    }
    updates.assignedTo = nextAssigned;
  }
  if (Object.keys(updates).length === 1) return c.json({ message: 'No updates' }, 400);

  await db.update(comments).set(updates).where(and(eq(comments.id, id), eq(comments.workspaceId, user.workspaceId)));
  await notifyCommentEvent(user.workspaceId, row.contextType, row.contextId, { action: 'updated', comment_id: id });
  return c.json({ success: true });
});

commentsRouter.post('/:id/close', requireWorkspaceEditorRole(), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id');

  const [row] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, id), eq(comments.workspaceId, user.workspaceId)))
    .limit(1);
  if (!row) return c.json({ message: 'Not found' }, 404);
  if (row.assignedTo !== user.userId) {
    return c.json({ message: 'Only the assigned user can close the comment' }, 403);
  }

  await db
    .update(comments)
    .set({ status: 'closed', updatedAt: new Date() })
    .where(and(eq(comments.id, id), eq(comments.workspaceId, user.workspaceId)));

  await notifyCommentEvent(user.workspaceId, row.contextType, row.contextId, { action: 'closed', comment_id: id });
  return c.json({ success: true });
});

commentsRouter.post('/:id/reopen', requireWorkspaceEditorRole(), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id');

  const [row] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, id), eq(comments.workspaceId, user.workspaceId)))
    .limit(1);
  if (!row) return c.json({ message: 'Not found' }, 404);
  if (row.assignedTo !== user.userId) {
    return c.json({ message: 'Only the assigned user can reopen the comment' }, 403);
  }

  await db
    .update(comments)
    .set({ status: 'open', updatedAt: new Date() })
    .where(and(eq(comments.id, id), eq(comments.workspaceId, user.workspaceId)));

  await notifyCommentEvent(user.workspaceId, row.contextType, row.contextId, { action: 'reopened', comment_id: id });
  return c.json({ success: true });
});
