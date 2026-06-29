import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';
import type { TenantContext } from '@sentropic/contracts';
import {
  CommentNotFoundError,
  ThreadNotFoundError,
  targetFromLive,
  type CommentTarget,
} from '@sentropic/comments';
import { db } from '../../db/client';
import { folders, organizations, initiatives, users, workspaceMemberships, contextDocuments } from '../../db/schema';
import { requireWorkspaceAccessRole, requireWorkspaceCommenterRole } from '../../middleware/workspace-rbac';
import { requireWorkspaceAdmin } from '../../services/workspace-access';
import { commentStore, commentEventSink } from '../../services/comments/instance';

export const commentsRouter = new Hono();

const contextTypeSchema = z.enum(['organization', 'folder', 'initiative', 'usecase', 'matrix', 'executive_summary', 'artifact']); // TODO Lot 10: remove 'usecase'
const statusSchema = z.enum(['open', 'closed']);

/** Build a tenant context from the live session (tenantId := workspaceId). */
function tenantOf(user: { workspaceId: string; userId: string }): TenantContext {
  return { tenantId: user.workspaceId, workspaceId: user.workspaceId, userId: user.userId };
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
  if (contextType === 'initiative') {
    const [row] = await db
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(and(eq(initiatives.id, contextId), eq(initiatives.workspaceId, workspaceId)))
      .limit(1);
    return !!row;
  }
  if (contextType === 'artifact') {
    // The artifact target id IS the context_documents primary key (the docId),
    // workspace-scoped. Absent => 404 (no document annotation anchor created).
    const [row] = await db
      .select({ id: contextDocuments.id })
      .from(contextDocuments)
      .where(and(eq(contextDocuments.id, contextId), eq(contextDocuments.workspaceId, workspaceId)))
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

  const tenant = tenantOf(user);
  // The port is context_id-scoped (it ignores the live context_type — every live
  // record context collapses to kind:'record'); filter context_type host-side to
  // preserve the live (workspaceId, contextType, contextId[, sectionKey][, status])
  // query exactly (comments.ts:88-100).
  const target = targetFromLive({ contextType: context_type, contextId: context_id, sectionKey: section_key ?? null });
  const list = await commentStore.listByTarget(tenant, {
    kind: target.kind,
    id: target.id,
    ...(section_key ? { sectionKey: section_key } : {}),
    ...(status ? { status: status === 'closed' ? 'resolved' : 'open' } : {}),
  });

  // Map the package Comment shape back to the live row projection and re-apply
  // the host-only context_type filter (the port matches on context_id only).
  const rows = list
    .filter((comment) => (comment.target.recordType ?? comment.target.kind) === context_type)
    .map((comment) => ({
      id: comment.id,
      contextType: comment.target.recordType ?? comment.target.kind,
      contextId: comment.target.id,
      sectionKey: comment.target.sectionKey ?? null,
      createdBy: comment.author.id,
      assignedTo: comment.assignedTo ?? null,
      status: comment.state === 'resolved' ? 'closed' : 'open',
      threadId: comment.threadId,
      content: comment.body,
      toolCallId: comment.provenance?.toolCallId ?? null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt ?? comment.createdAt,
    }));

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
      thread_id: row.threadId,
      content: row.content,
      tool_call_id: row.toolCallId ?? null,
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
  thread_id: z.string().optional(),
});

commentsRouter.post('/', requireWorkspaceCommenterRole(), zValidator('json', createSchema), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const body = c.req.valid('json');

  const ok = await ensureContextExists(body.context_type, body.context_id, user.workspaceId);
  if (!ok) return c.json({ message: 'Not found' }, 404);

  const tenant = tenantOf(user);

  // Resolve the existing thread assignee host-side (the live default chain needs
  // the parent thread's assignee, comments.ts:158-176). The port's add() throws
  // ThreadNotFoundError for a bad reply, but the live default chain must read the
  // existing assignee BEFORE add(), so a single host lookup is kept here.
  let existingThreadAssignee: string | null = null;
  if (body.thread_id?.trim()) {
    const threadRows = await commentStore.listThread(tenant, body.thread_id.trim());
    const threadInTarget = threadRows.filter(
      (row) => (row.target.recordType ?? row.target.kind) === body.context_type && row.target.id === body.context_id,
    );
    if (threadInTarget.length === 0) return c.json({ message: 'Thread not found' }, 404);
    existingThreadAssignee = threadInTarget.find((row) => row.assignedTo)?.assignedTo ?? null;
  }

  const assignedTo = body.assigned_to ?? existingThreadAssignee ?? user.userId;
  if (!(await ensureWorkspaceMember(assignedTo, user.workspaceId))) {
    return c.json({ message: 'Assigned user not in workspace' }, 400);
  }

  const threadId = body.thread_id?.trim() || undefined;
  // Artifact (document/PDF) anchors carry the consensus-literal `kind:'artifact'`
  // directly — NOT through `targetFromLive` (which would collapse to
  // `kind:'record'`, recordType:'artifact'). `targetToLive` (store side) maps it
  // back to `context_type='artifact'`, so persistence/read-back round-trips and
  // the GET host-side filter (`recordType ?? kind`) still matches. The package
  // preserves `section_key` verbatim (the PDF-anchor convention; see
  // `services/comments/pdf-anchor.ts`).
  const target: CommentTarget =
    body.context_type === 'artifact'
      ? {
          kind: 'artifact',
          id: body.context_id,
          ...(body.section_key ? { sectionKey: body.section_key } : {}),
        }
      : targetFromLive({
          contextType: body.context_type,
          contextId: body.context_id,
          sectionKey: body.section_key ?? null,
        });

  let created;
  try {
    created = await commentStore.add(tenant, {
      tenant,
      target,
      author: { id: user.userId },
      body: body.content.trim(),
      ...(threadId ? { threadId } : {}),
      assignedTo,
    });
  } catch (error) {
    if (error instanceof ThreadNotFoundError) return c.json({ message: 'Thread not found' }, 404);
    throw error;
  }

  // POST-with-assignee cascades the assignee across the WHOLE thread (root+replies,
  // comments.ts:198-203). This is a SILENT host-local cascade (no second event) via
  // the emit-free store primitive; the single created event is emitted below.
  if (body.assigned_to) {
    await commentStore.assign(tenant, created.threadId, assignedTo);
  }

  await commentEventSink.emit({
    workspaceId: user.workspaceId,
    contextType: body.context_type,
    contextId: body.context_id,
    action: 'created',
    key: 'comment_id',
    commentId: created.id,
    origin: 'rest',
  });
  return c.json({ id: created.id, thread_id: created.threadId }, 201);
});

const updateSchema = z.object({
  content: z.string().min(1).optional(),
  assigned_to: z.string().nullable().optional(),
});

commentsRouter.patch('/:id', requireWorkspaceCommenterRole(), zValidator('json', updateSchema), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const tenant = tenantOf(user);
  const row = await commentStore.get(tenant, id);
  if (!row) return c.json({ message: 'Not found' }, 404);

  const isCreator = row.author.id === user.userId;
  if (!isCreator) {
    try {
      await requireWorkspaceAdmin(user.userId, user.workspaceId);
    } catch {
      return c.json({ message: 'Insufficient permissions' }, 403);
    }
  }

  // Reproduce the live combined-updates semantics (comments.ts:235-254): build a
  // single updates descriptor; when assigned_to is present the WHOLE update
  // (content + assignment) cascades thread-wide, else content is per-row.
  const hasContent = typeof body.content === 'string';
  const nextContent = hasContent ? (body.content as string).trim() : undefined;
  let nextAssigned: string | undefined;
  if (body.assigned_to !== undefined) {
    nextAssigned = body.assigned_to ?? row.author.id; // assigned_to:null -> createdBy (NOT unassign)
    if (!(await ensureWorkspaceMember(nextAssigned, user.workspaceId))) {
      return c.json({ message: 'Assigned user not in workspace' }, 400);
    }
  }
  if (!hasContent && nextAssigned === undefined) return c.json({ message: 'No updates' }, 400);

  try {
    if (nextAssigned !== undefined) {
      if (hasContent) {
        // COMBINED case: content + assignment cascade thread-wide in ONE atomic
        // emit-free statement (mirrors the OLD single combined-PATCH UPDATE,
        // comments.ts@40a23a35^:246-250) — NOT N per-row edits + separate assign,
        // which is non-atomic and can 404/500 under concurrent deletes.
        await commentStore.editThread(tenant, row.threadId, {
          content: nextContent as string,
          assignedTo: nextAssigned,
        });
      } else {
        // assigned_to-only -> thread-wide assignment cascade (comments.ts:246-250).
        await commentStore.assign(tenant, row.threadId, nextAssigned);
      }
    } else {
      // Content-only edit is per-row (comments.ts:251-252).
      await commentStore.edit(tenant, id, { body: nextContent });
    }
  } catch (error) {
    if (error instanceof CommentNotFoundError || error instanceof ThreadNotFoundError) {
      return c.json({ message: 'Not found' }, 404);
    }
    throw error;
  }

  await commentEventSink.emit({
    workspaceId: user.workspaceId,
    contextType: row.target.recordType ?? row.target.kind,
    contextId: row.target.id,
    action: 'updated',
    key: 'comment_id',
    commentId: id,
    origin: 'rest',
  });
  return c.json({ success: true });
});

commentsRouter.post('/:id/close', requireWorkspaceCommenterRole(), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id')!;

  const tenant = tenantOf(user);
  const row = await commentStore.get(tenant, id);
  if (!row) return c.json({ message: 'Not found' }, 404);
  const isCreator = row.author.id === user.userId;
  if (!isCreator) {
    try {
      await requireWorkspaceAdmin(user.userId, user.workspaceId);
    } catch {
      return c.json({ message: 'Only the creator or admin can close the comment' }, 403);
    }
  }

  await commentStore.setState(tenant, row.threadId, 'resolved'); // THREAD cascade

  await commentEventSink.emit({
    workspaceId: user.workspaceId,
    contextType: row.target.recordType ?? row.target.kind,
    contextId: row.target.id,
    action: 'closed',
    key: 'comment_id',
    commentId: id,
    origin: 'rest',
  });
  return c.json({ success: true });
});

commentsRouter.post('/:id/reopen', requireWorkspaceCommenterRole(), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id')!;

  const tenant = tenantOf(user);
  const row = await commentStore.get(tenant, id);
  if (!row) return c.json({ message: 'Not found' }, 404);
  const isCreator = row.author.id === user.userId;
  if (!isCreator) {
    try {
      await requireWorkspaceAdmin(user.userId, user.workspaceId);
    } catch {
      return c.json({ message: 'Only the creator or admin can reopen the comment' }, 403);
    }
  }

  await commentStore.setState(tenant, row.threadId, 'open'); // THREAD cascade

  await commentEventSink.emit({
    workspaceId: user.workspaceId,
    contextType: row.target.recordType ?? row.target.kind,
    contextId: row.target.id,
    action: 'reopened',
    key: 'comment_id',
    commentId: id,
    origin: 'rest',
  });
  return c.json({ success: true });
});

commentsRouter.delete('/:id', requireWorkspaceCommenterRole(), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id')!;

  const tenant = tenantOf(user);
  const row = await commentStore.get(tenant, id);
  if (!row) return c.json({ message: 'Not found' }, 404);

  const isCreator = row.author.id === user.userId;
  if (!isCreator) {
    try {
      await requireWorkspaceAdmin(user.userId, user.workspaceId);
    } catch {
      return c.json({ message: 'Insufficient permissions' }, 403);
    }
  }

  await commentStore.delete(tenant, id); // PER-ROW HARD delete (replies survive)

  await commentEventSink.emit({
    workspaceId: user.workspaceId,
    contextType: row.target.recordType ?? row.target.kind,
    contextId: row.target.id,
    action: 'deleted',
    key: 'comment_id',
    commentId: id,
    origin: 'rest',
  });
  return c.json({ success: true });
});
