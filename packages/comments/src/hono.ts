import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { CommentsHttpPrincipal, CreateCommentsRouterOptions } from './hono-ports.js';
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

  return router;
};
