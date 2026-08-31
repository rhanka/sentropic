import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { CommentsHttpPrincipal, CreateCommentsRouterOptions } from './hono-ports.js';
import { CommentNotFoundError, ThreadNotFoundError } from './store.js';
import { targetFromLive } from './types.js';

export type {
  CommentsAuthzPort,
  CommentsHttpEventPort,
  CommentsHttpPrincipal,
  CommentsHttpUser,
  CommentsTenantPort,
  CreateCommentsRouterOptions,
} from './hono-ports.js';

const contextTypeSchema = z.enum([
  'organization',
  'folder',
  'initiative',
  'usecase',
  'matrix',
  'executive_summary',
]);
const statusSchema = z.enum(['open', 'closed']);
const listQuerySchema = z.object({
  context_type: contextTypeSchema,
  context_id: z.string().min(1),
  section_key: z.string().optional(),
  status: statusSchema.optional(),
});
const createSchema = z.object({
  context_type: contextTypeSchema,
  context_id: z.string().min(1),
  section_key: z.string().optional(),
  content: z.string().min(1),
  assigned_to: z.string().optional(),
  thread_id: z.string().optional(),
});
const updateSchema = z.object({
  content: z.string().min(1).optional(),
  assigned_to: z.string().nullable().optional(),
});

const principalFor = async (
  context: Context,
  options: CreateCommentsRouterOptions,
  action: 'read' | 'comment',
): Promise<CommentsHttpPrincipal | Response> => {
  let principal: CommentsHttpPrincipal | undefined;
  try {
    principal = await options.authz.resolvePrincipal(context);
  } catch {
    principal = undefined;
  }
  if (!principal) return context.json({ error: 'Authentication required' }, 401);
  try {
    if (await options.authz.authorize({ principal, action })) return principal;
  } catch {
    // Authorization adapters fail closed.
  }
  return context.json({ error: 'Insufficient permissions' }, 403);
};

const isResponse = (value: CommentsHttpPrincipal | Response): value is Response =>
  value instanceof Response;

const isAdmin = async (
  principal: CommentsHttpPrincipal,
  options: CreateCommentsRouterOptions,
): Promise<boolean> => {
  try {
    return await options.authz.authorize({ principal, action: 'admin' });
  } catch {
    return false;
  }
};

export const createCommentsRouter = (options: CreateCommentsRouterOptions): Hono => {
  const router = new Hono();

  router.get('/comments', async (context) => {
    const principal = await principalFor(context, options, 'read');
    if (isResponse(principal)) return principal;
    const parsed = listQuerySchema.safeParse({
      context_type: context.req.query('context_type'),
      context_id: context.req.query('context_id'),
      section_key: context.req.query('section_key') || undefined,
      status: context.req.query('status') || undefined,
    });
    if (!parsed.success) return context.json({ message: 'Invalid query' }, 400);

    const { context_type, context_id, section_key, status } = parsed.data;
    if (!await options.tenant.contextExists({
      contextType: context_type,
      contextId: context_id,
      workspaceId: principal.workspaceId,
    })) return context.json({ message: 'Not found' }, 404);

    const tenant = await options.tenant.resolve(principal);
    const target = targetFromLive({
      contextType: context_type,
      contextId: context_id,
      sectionKey: section_key ?? null,
    });
    const list = await options.store.listByTarget(tenant, {
      kind: target.kind,
      id: target.id,
      ...(section_key ? { sectionKey: section_key } : {}),
      ...(status ? { status: status === 'closed' ? 'resolved' : 'open' } : {}),
    });
    const rows = list.filter(
      (comment) => (comment.target.recordType ?? comment.target.kind) === context_type,
    );
    const userIds = [...new Set(rows.flatMap(
      (row) => [row.author.id, row.assignedTo].filter((id): id is string => Boolean(id)),
    ))];
    const users = await options.tenant.resolveUsers({
      userIds,
      workspaceId: principal.workspaceId,
    });
    const usersById = new Map(users.map((user) => [user.id, user]));

    return context.json({ items: rows.map((row) => ({
      id: row.id,
      context_type: row.target.recordType ?? row.target.kind,
      context_id: row.target.id,
      section_key: row.target.sectionKey ?? null,
      created_by: row.author.id,
      assigned_to: row.assignedTo ?? null,
      status: row.state === 'resolved' ? 'closed' : 'open',
      thread_id: row.threadId,
      content: row.body,
      tool_call_id: row.provenance?.toolCallId ?? null,
      created_at: row.createdAt,
      updated_at: row.updatedAt ?? row.createdAt,
      created_by_user: usersById.get(row.author.id) ?? null,
      assigned_to_user: row.assignedTo ? usersById.get(row.assignedTo) ?? null : null,
    })) });
  });

  router.post('/comments', async (context) => {
    const principal = await principalFor(context, options, 'comment');
    if (isResponse(principal)) return principal;
    const parsed = await createSchema.safeParseAsync(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return context.json(parsed, 400);
    const body = parsed.data;
    if (!await options.tenant.contextExists({
      contextType: body.context_type,
      contextId: body.context_id,
      workspaceId: principal.workspaceId,
    })) return context.json({ message: 'Not found' }, 404);

    const tenant = await options.tenant.resolve(principal);
    let existingThreadAssignee: string | null = null;
    if (body.thread_id?.trim()) {
      const threadRows = await options.store.listThread(tenant, body.thread_id.trim());
      const threadInTarget = threadRows.filter(
        (row) => (row.target.recordType ?? row.target.kind) === body.context_type
          && row.target.id === body.context_id,
      );
      if (threadInTarget.length === 0) {
        return context.json({ message: 'Thread not found' }, 404);
      }
      existingThreadAssignee = threadInTarget.find((row) => row.assignedTo)?.assignedTo ?? null;
    }

    const assignedTo = body.assigned_to ?? existingThreadAssignee ?? principal.userId;
    if (!await options.tenant.memberExists({
      userId: assignedTo,
      workspaceId: principal.workspaceId,
    })) return context.json({ message: 'Assigned user not in workspace' }, 400);

    let created;
    try {
      created = await options.store.add(tenant, {
        tenant,
        target: targetFromLive({
          contextType: body.context_type,
          contextId: body.context_id,
          sectionKey: body.section_key ?? null,
        }),
        author: { id: principal.userId },
        body: body.content.trim(),
        ...(body.thread_id?.trim() ? { threadId: body.thread_id.trim() } : {}),
        assignedTo,
      });
    } catch (error) {
      if (error instanceof ThreadNotFoundError) {
        return context.json({ message: 'Thread not found' }, 404);
      }
      throw error;
    }
    if (body.assigned_to) await options.store.assign(tenant, created.threadId, assignedTo);

    await options.events.emit({
      workspaceId: principal.workspaceId,
      contextType: body.context_type,
      contextId: body.context_id,
      action: 'created',
      key: 'comment_id',
      commentId: created.id,
      origin: 'rest',
    });
    return context.json({ id: created.id, thread_id: created.threadId }, 201);
  });

  router.patch('/comments/:id', async (context) => {
    const principal = await principalFor(context, options, 'comment');
    if (isResponse(principal)) return principal;
    const parsed = await updateSchema.safeParseAsync(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) return context.json(parsed, 400);

    const tenant = await options.tenant.resolve(principal);
    const id = context.req.param('id');
    const row = await options.store.get(tenant, id);
    if (!row) return context.json({ message: 'Not found' }, 404);
    if (row.author.id !== principal.userId && !await isAdmin(principal, options)) {
      return context.json({ message: 'Insufficient permissions' }, 403);
    }

    const body = parsed.data;
    const hasContent = typeof body.content === 'string';
    const nextContent = hasContent ? body.content!.trim() : undefined;
    let nextAssigned: string | undefined;
    if (body.assigned_to !== undefined) {
      nextAssigned = body.assigned_to ?? row.author.id;
      if (!await options.tenant.memberExists({
        userId: nextAssigned,
        workspaceId: principal.workspaceId,
      })) return context.json({ message: 'Assigned user not in workspace' }, 400);
    }
    if (!hasContent && nextAssigned === undefined) {
      return context.json({ message: 'No updates' }, 400);
    }

    try {
      if (nextAssigned !== undefined) {
        if (hasContent) {
          await options.store.editThread(tenant, row.threadId, {
            content: nextContent!,
            assignedTo: nextAssigned,
          });
        } else {
          await options.store.assign(tenant, row.threadId, nextAssigned);
        }
      } else {
        await options.store.edit(tenant, id, { body: nextContent });
      }
    } catch (error) {
      if (error instanceof CommentNotFoundError || error instanceof ThreadNotFoundError) {
        return context.json({ message: 'Not found' }, 404);
      }
      throw error;
    }

    await options.events.emit({
      workspaceId: principal.workspaceId,
      contextType: row.target.recordType ?? row.target.kind,
      contextId: row.target.id,
      action: 'updated',
      key: 'comment_id',
      commentId: id,
      origin: 'rest',
    });
    return context.json({ success: true });
  });

  router.post('/comments/:id/close', async (context) => {
    const principal = await principalFor(context, options, 'comment');
    if (isResponse(principal)) return principal;
    const tenant = await options.tenant.resolve(principal);
    const id = context.req.param('id');
    const row = await options.store.get(tenant, id);
    if (!row) return context.json({ message: 'Not found' }, 404);
    if (row.author.id !== principal.userId && !await isAdmin(principal, options)) {
      return context.json({ message: 'Only the creator or admin can close the comment' }, 403);
    }
    await options.store.setState(tenant, row.threadId, 'resolved');
    await options.events.emit({
      workspaceId: principal.workspaceId,
      contextType: row.target.recordType ?? row.target.kind,
      contextId: row.target.id,
      action: 'closed',
      key: 'comment_id',
      commentId: id,
      origin: 'rest',
    });
    return context.json({ success: true });
  });

  router.post('/comments/:id/reopen', async (context) => {
    const principal = await principalFor(context, options, 'comment');
    if (isResponse(principal)) return principal;
    const tenant = await options.tenant.resolve(principal);
    const id = context.req.param('id');
    const row = await options.store.get(tenant, id);
    if (!row) return context.json({ message: 'Not found' }, 404);
    if (row.author.id !== principal.userId && !await isAdmin(principal, options)) {
      return context.json({ message: 'Only the creator or admin can reopen the comment' }, 403);
    }
    await options.store.setState(tenant, row.threadId, 'open');
    await options.events.emit({
      workspaceId: principal.workspaceId,
      contextType: row.target.recordType ?? row.target.kind,
      contextId: row.target.id,
      action: 'reopened',
      key: 'comment_id',
      commentId: id,
      origin: 'rest',
    });
    return context.json({ success: true });
  });

  router.delete('/comments/:id', async (context) => {
    const principal = await principalFor(context, options, 'comment');
    if (isResponse(principal)) return principal;
    const tenant = await options.tenant.resolve(principal);
    const id = context.req.param('id');
    const row = await options.store.get(tenant, id);
    if (!row) return context.json({ message: 'Not found' }, 404);
    if (row.author.id !== principal.userId && !await isAdmin(principal, options)) {
      return context.json({ message: 'Insufficient permissions' }, 403);
    }
    await options.store.delete(tenant, id);
    await options.events.emit({
      workspaceId: principal.workspaceId,
      contextType: row.target.recordType ?? row.target.kind,
      contextId: row.target.id,
      action: 'deleted',
      key: 'comment_id',
      commentId: id,
      origin: 'rest',
    });
    return context.json({ success: true });
  });

  return router;
};
