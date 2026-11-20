import type { TenantContext } from '@sentropic/contracts';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import {
  checkSectionKeyCap,
  isArtifactTarget,
  resolveHttpProvenance,
  serializeArtifactComment,
  serializeArtifactSummary,
  type ArtifactCommentsHttpPrincipal,
  type CreateArtifactCommentsRouterOptions,
} from './artifact-hono-ports.js';
import { CommentNotFoundError, ThreadNotFoundError } from './store.js';
import type { Comment } from './types.js';

export {
  ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH,
  PROVENANCE_TOOL_CALL_ID_REQUIRED_CODE,
  SECTION_KEY_TOO_LONG_CODE,
} from './artifact-hono-ports.js';
export type {
  ArtifactCommentActorKind,
  ArtifactCommentAuthzDecision,
  ArtifactCommentsAuthzPort,
  ArtifactCommentsEventPort,
  ArtifactCommentsHttpPrincipal,
  ArtifactCommentsTenantPort,
  CreateArtifactCommentsRouterOptions,
} from './artifact-hono-ports.js';

const listQuerySchema = z.object({ section_key: z.string().optional(), status: z.enum(['open', 'closed']).optional() });
const createSchema = z.object({
  content: z.string().trim().min(1),
  section_key: z.string().min(1).optional(),
  thread_id: z.string().trim().min(1).optional(),
  assigned_to: z.string().trim().min(1).nullable().optional(),
  actor_kind: z.enum(['human', 'agent', 'nhi']).optional(),
  provenance: z.object({ toolCallId: z.string().optional(), runId: z.string().optional() }).optional(),
});
const editSchema = z.object({ content: z.string().trim().min(1) });
const assignSchema = z.object({ assigned_to: z.string().trim().min(1).nullable() });

type Authorized = { principal: ArtifactCommentsHttpPrincipal; isAdmin: boolean };

const authorize = async (
  c: Context, options: CreateArtifactCommentsRouterOptions, artifactId: string, action: 'read' | 'comment',
): Promise<Authorized | Response> => {
  let principal: ArtifactCommentsHttpPrincipal | undefined;
  try { principal = await options.authz.resolvePrincipal(c); } catch { principal = undefined; }
  if (!principal || !principal.userId || !principal.workspaceId) {
    return c.json({ code: 'unauthenticated', error: 'Authentication required' }, 401);
  }
  try {
    const decision = await options.authz.authorizeArtifact({ principal, artifactId, action });
    if (decision.ok) return { principal, isAdmin: decision.isAdmin === true };
    return c.json({ code: decision.code, error: decision.status === 404 ? 'Not found' : 'Insufficient permissions' }, decision.status);
  } catch {
    return c.json({ code: 'comment_forbidden', error: 'Insufficient permissions' }, 403);
  }
};

const canModerate = async (auth: Authorized, options: CreateArtifactCommentsRouterOptions): Promise<boolean> => {
  if (auth.isAdmin) return true;
  if (!options.authz.isAdmin) return false;
  try { return Boolean(await options.authz.isAdmin(auth.principal)); } catch { return false; }
};

const parseListQuery = (c: Context) => {
  const rawSectionKey = c.req.query('section_key') || undefined;
  const capErr = checkSectionKeyCap(c, rawSectionKey);
  if (capErr) return capErr;
  const parsed = listQuerySchema.safeParse({ section_key: rawSectionKey, status: c.req.query('status') || undefined });
  return parsed.success ? parsed.data : c.json({ code: 'invalid_query', error: 'Invalid query' }, 400);
};

export const createArtifactCommentsRouter = (options: CreateArtifactCommentsRouterOptions): Hono => {
  const router = new Hono();
  const nonHumanClients = new Set(options.nonHumanClientIds ?? []);

  const emitEvent = (
    workspaceId: string, contextId: string,
    action: 'created' | 'updated' | 'closed' | 'reopened' | 'deleted' | 'reassigned',
    key: 'comment_id' | 'thread_id', threadId: string, commentId?: string,
  ) => options.events?.emit({ workspaceId, contextType: 'artifact', contextId, action, key, commentId, threadId, origin: 'rest' });

  const loadThread = async (tenant: TenantContext, artifactId: string, threadId: string): Promise<Comment[]> =>
    (await options.store.listThread(tenant, threadId)).filter((r) => isArtifactTarget(r.target) && r.target.id === artifactId);

  const loadAuthorizedRow = async (c: Context, artifactId: string, id: string) => {
    const auth = await authorize(c, options, artifactId, 'comment');
    if (auth instanceof Response) return auth;
    const tenant = await options.tenant.resolve(auth.principal);
    const row = await options.store.get(tenant, id);
    if (!row || !isArtifactTarget(row.target) || row.target.id !== artifactId) {
      return c.json({ code: 'comment_not_found', error: 'Not found' }, 404);
    }
    if (row.author.id !== auth.principal.userId && !(await canModerate(auth, options))) {
      return c.json({ code: 'comment_forbidden', error: 'Insufficient permissions' }, 403);
    }
    return { auth, tenant, row };
  };

  router.get('/artifacts/:artifactId/comments', async (c) => {
    const artifactId = c.req.param('artifactId');
    const auth = await authorize(c, options, artifactId, 'read');
    if (auth instanceof Response) return auth;
    const query = parseListQuery(c);
    if (query instanceof Response) return query;
    const rows = await options.store.listByTarget(await options.tenant.resolve(auth.principal), {
      kind: 'artifact', id: artifactId,
      ...(query.section_key ? { sectionKey: query.section_key } : {}),
      ...(query.status ? { status: query.status } : {}),
    });
    return c.json({ items: rows.filter((r) => isArtifactTarget(r.target)).map(serializeArtifactComment) });
  });

  router.get('/artifacts/:artifactId/comments/summaries', async (c) => {
    const artifactId = c.req.param('artifactId');
    const auth = await authorize(c, options, artifactId, 'read');
    if (auth instanceof Response) return auth;
    const query = parseListQuery(c);
    if (query instanceof Response) return query;
    const summaries = await options.store.listThreadSummaries(await options.tenant.resolve(auth.principal), {
      kind: 'artifact', id: artifactId,
      ...(query.section_key ? { sectionKey: query.section_key } : {}),
      ...(query.status ? { status: query.status } : {}),
    });
    return c.json({ items: summaries.filter((s) => isArtifactTarget(s.target)).map(serializeArtifactSummary) });
  });

  router.get('/artifacts/:artifactId/comments/threads/:threadId', async (c) => {
    const artifactId = c.req.param('artifactId');
    const auth = await authorize(c, options, artifactId, 'read');
    if (auth instanceof Response) return auth;
    const rows = await loadThread(await options.tenant.resolve(auth.principal), artifactId, c.req.param('threadId'));
    return rows.length === 0
      ? c.json({ code: 'thread_not_found', error: 'Thread not found' }, 404)
      : c.json({ items: rows.map(serializeArtifactComment) });
  });

  router.post('/artifacts/:artifactId/comments', async (c) => {
    const artifactId = c.req.param('artifactId');
    const auth = await authorize(c, options, artifactId, 'comment');
    if (auth instanceof Response) return auth;
    const raw = await c.req.json().catch(() => undefined);
    const capErr = typeof (raw as { section_key?: unknown } | undefined)?.section_key === 'string'
      ? checkSectionKeyCap(c, (raw as { section_key: string }).section_key) : null;
    if (capErr) return capErr;
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) return c.json({ code: 'invalid_request', error: 'Invalid request body' }, 400);
    const body = parsed.data;
    const prov = resolveHttpProvenance(c, auth.principal, nonHumanClients, body.actor_kind, body.provenance);
    if (!prov.ok) return prov.response;
    if (typeof body.assigned_to === 'string'
      && !(await options.tenant.memberExists({ userId: body.assigned_to, workspaceId: auth.principal.workspaceId }))) {
      return c.json({ code: 'assignee_not_in_workspace', error: 'Assigned user not in workspace' }, 400);
    }
    const tenant = await options.tenant.resolve(auth.principal);
    let inheritedSectionKey: string | undefined;
    let inheritedAssignee: string | undefined;
    if (body.thread_id) {
      const threadRows = await loadThread(tenant, artifactId, body.thread_id);
      if (threadRows.length === 0) return c.json({ code: 'thread_not_found', error: 'Thread not found' }, 404);
      inheritedSectionKey = threadRows.find((r) => r.target.sectionKey !== undefined)?.target.sectionKey;
      inheritedAssignee = threadRows.find((r) => r.assignedTo !== undefined)?.assignedTo;
    }
    const sectionKey = body.section_key ?? inheritedSectionKey;
    const assignedTo = body.assigned_to === undefined ? inheritedAssignee : (body.assigned_to ?? undefined);
    let created: Comment;
    try {
      created = await options.store.add(tenant, {
        tenant,
        target: { kind: 'artifact', id: artifactId, ...(sectionKey !== undefined ? { sectionKey } : {}) },
        author: { id: auth.principal.userId },
        body: body.content,
        ...(body.thread_id ? { threadId: body.thread_id } : {}),
        ...(assignedTo !== undefined ? { assignedTo } : {}),
        ...(prov.provenance ? { provenance: prov.provenance } : {}),
      });
    } catch (error) {
      if (error instanceof ThreadNotFoundError) return c.json({ code: 'thread_not_found', error: 'Thread not found' }, 404);
      throw error;
    }
    if (body.thread_id && body.assigned_to !== undefined) {
      await options.store.assign(tenant, created.threadId, body.assigned_to);
      created = { ...created, assignedTo: body.assigned_to ?? undefined };
    }
    await emitEvent(auth.principal.workspaceId, artifactId, 'created', 'comment_id', created.threadId, created.id);
    return c.json({ comment: serializeArtifactComment(created) }, 201);
  });

  const handleState = (state: 'open' | 'closed') => async (c: Context) => {
    const artifactId = c.req.param('artifactId') ?? '';
    const threadId = c.req.param('threadId') ?? '';
    const auth = await authorize(c, options, artifactId, 'comment');
    if (auth instanceof Response) return auth;
    const tenant = await options.tenant.resolve(auth.principal);
    if ((await loadThread(tenant, artifactId, threadId)).length === 0) {
      return c.json({ code: 'thread_not_found', error: 'Thread not found' }, 404);
    }
    try {
      const updated = await options.store.setState(tenant, threadId, state);
      await emitEvent(auth.principal.workspaceId, artifactId, state === 'closed' ? 'closed' : 'reopened', 'thread_id', threadId, updated[0]?.id);
      return c.json({ items: updated.map(serializeArtifactComment) });
    } catch (error) {
      if (error instanceof ThreadNotFoundError) return c.json({ code: 'thread_not_found', error: 'Thread not found' }, 404);
      throw error;
    }
  };

  router.post('/artifacts/:artifactId/comments/threads/:threadId/close', handleState('closed'));
  router.post('/artifacts/:artifactId/comments/threads/:threadId/reopen', handleState('open'));

  router.patch('/artifacts/:artifactId/comments/threads/:threadId/assignee', async (c) => {
    const artifactId = c.req.param('artifactId');
    const threadId = c.req.param('threadId');
    const auth = await authorize(c, options, artifactId, 'comment');
    if (auth instanceof Response) return auth;
    const parsed = assignSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ code: 'invalid_request', error: 'Invalid request body' }, 400);
    const { assigned_to } = parsed.data;
    if (assigned_to !== null
      && !(await options.tenant.memberExists({ userId: assigned_to, workspaceId: auth.principal.workspaceId }))) {
      return c.json({ code: 'assignee_not_in_workspace', error: 'Assigned user not in workspace' }, 400);
    }
    const tenant = await options.tenant.resolve(auth.principal);
    if ((await loadThread(tenant, artifactId, threadId)).length === 0) {
      return c.json({ code: 'thread_not_found', error: 'Thread not found' }, 404);
    }
    try {
      const updated = await options.store.assign(tenant, threadId, assigned_to);
      await emitEvent(auth.principal.workspaceId, artifactId, 'reassigned', 'thread_id', threadId, updated[0]?.id);
      return c.json({ items: updated.map(serializeArtifactComment) });
    } catch (error) {
      if (error instanceof ThreadNotFoundError) return c.json({ code: 'thread_not_found', error: 'Thread not found' }, 404);
      throw error;
    }
  });

  router.patch('/artifacts/:artifactId/comments/:id', async (c) => {
    const artifactId = c.req.param('artifactId');
    const id = c.req.param('id');
    const loaded = await loadAuthorizedRow(c, artifactId, id);
    if (loaded instanceof Response) return loaded;
    const parsed = editSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ code: 'invalid_request', error: 'Invalid request body' }, 400);
    try {
      const updated = await options.store.edit(loaded.tenant, id, { body: parsed.data.content });
      await emitEvent(loaded.auth.principal.workspaceId, artifactId, 'updated', 'comment_id', updated.threadId, updated.id);
      return c.json({ comment: serializeArtifactComment(updated) });
    } catch (error) {
      if (error instanceof CommentNotFoundError) return c.json({ code: 'comment_not_found', error: 'Not found' }, 404);
      throw error;
    }
  });

  router.delete('/artifacts/:artifactId/comments/:id', async (c) => {
    const artifactId = c.req.param('artifactId');
    const id = c.req.param('id');
    const loaded = await loadAuthorizedRow(c, artifactId, id);
    if (loaded instanceof Response) return loaded;
    try {
      await options.store.delete(loaded.tenant, id);
    } catch (error) {
      if (error instanceof CommentNotFoundError) return c.json({ code: 'comment_not_found', error: 'Not found' }, 404);
      throw error;
    }
    await emitEvent(loaded.auth.principal.workspaceId, artifactId, 'deleted', 'comment_id', loaded.row.threadId, loaded.row.id);
    return c.json({ deleted: true, id });
  });

  return router;
};
