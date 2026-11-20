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

  void [createSchema, editSchema, assignSchema, resolveHttpProvenance, CommentNotFoundError, ThreadNotFoundError, nonHumanClients, emitEvent, loadAuthorizedRow];

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

  return router;
};
