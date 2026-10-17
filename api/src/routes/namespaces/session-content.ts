import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { createSessionContentRateLimiters } from '../../middleware/session-content-rate-limiters';
import { resolveSessionContentIssuer, SessionContentError, SessionContentService } from '../../services/cluster-mesh/session-content';
import { validateSession } from '../../services/session-manager';

/** Product-only metadata and denial surface. No server claim substitutes for
 * CM2-F2/F7 source ownership, first-byte boundaries or locally enrolled keys. */
export function createSessionContentRouter(options: { content?: SessionContentService; websiteOrigin?: string } = {}) {
  const router = new Hono();
  const content = options.content ?? new SessionContentService({ issuer: resolveSessionContentIssuer() });
  const websiteOrigin = options.websiteOrigin ?? env.WEBAUTHN_ORIGIN;
  const budgets = createSessionContentRateLimiters();
  router.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (/\/source(?:\/|$)/.test(c.req.path)) return budgets.reject(c, 'source_auth_required');
    const token = c.req.header('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
    if (c.req.header('authorization') || !token) return budgets.reject(c, 'first_party_required');
    const session = await validateSession(token);
    if (!session) return budgets.reject(c, 'authentication_required');
    const origin = c.req.header('origin');
    const sameOriginRead = !origin && c.req.method === 'GET' && c.req.header('sec-fetch-site') === 'same-origin';
    if (c.req.header('x-session-content') !== 'browser' || (!sameOriginRead && (!websiteOrigin || origin !== websiteOrigin))
      || c.req.header('sec-fetch-site') === 'cross-site') return c.json({ error: 'origin_refused' }, 403);
    c.set('sessionContentIdentity', { ownerId: session.userId, sessionId: session.sessionId });
    return budgets.authenticated(c, next);
  });
  router.onError((error, c) => {
    if (error instanceof SessionContentError) {
      if (error.code === 'storage_unavailable') return c.json({ complete: false, status: 'purge_pending' }, 202);
      const status = error.code === 'membership_required' ? 403
        : ['not_found', 'cross_owner_refused'].includes(error.code) ? 404 : 503;
      return c.json({ error: error.code }, status);
    }
    return c.json({ error: 'control_unavailable' }, 503);
  });
  // Static routes precede binding IDs; this route deliberately has no membership requirement.
  router.get('/retained-content', async (c) =>
    c.json({ items: await content.listRetainedHandles(c.get('sessionContentIdentity').ownerId) }));
  router.get('/workspaces/:workspaceId/sessions', async (c) =>
    c.json(await content.discoverWorkspace(c.req.param('workspaceId'), c.get('sessionContentIdentity').ownerId)));
  router.delete('/workspaces/:workspaceId/consent', async (c) =>
    c.json(await content.denyWorkspaceContent(c.req.param('workspaceId'), c.get('sessionContentIdentity').ownerId)));
  const unavailable = (c: Context) =>
    c.json({ error: 'unsupported_source', dispatch: 'not_attempted', blockers: ['CM2-F2', 'CM2-F7'] }, 503);
  router.delete('/:bindingId/consent', async (c) => {
    const retainedScopeId = c.req.query('retainedScopeId');
    const ownerId = c.get('sessionContentIdentity').ownerId;
    if (!retainedScopeId) {
      const result = await content.denyBindingContent(c.req.param('bindingId'), ownerId, 'revoke');
      return c.json({ complete: result.remainingObjects === 0 });
    }
    const handles = await content.listRetainedHandles(ownerId);
    if (!handles.some((handle) => handle.bindingId === c.req.param('bindingId') && handle.retainedScopeId === retainedScopeId)) {
      return c.json({ error: 'not_found' }, 404);
    }
    const result = await content.requestRetainedPurge(retainedScopeId, ownerId);
    return c.json({ complete: result.remainingObjects === 0 });
  });
  router.put('/:bindingId/exclusion', bodyLimit({ maxSize: 128 }), async (c) => {
    const parsed = z.object({ excluded: z.literal(true) }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const result = await content.denyBindingContent(c.req.param('bindingId'), c.get('sessionContentIdentity').ownerId, 'exclude');
    return c.json({ complete: result.remainingObjects === 0 });
  });
  router.on('POST', ['/workspaces/:workspaceId/attachments', '/workspaces/:workspaceId/consent/prepare',
    '/workspaces/:workspaceId/consent', '/:bindingId/consent/prepare', '/:bindingId/consent',
    '/:bindingId/history-authorizations/prepare', '/:bindingId/history-authorizations',
    '/:bindingId/keyboard/lease', '/:bindingId/keyboard/prepare', '/:bindingId/keyboard/submissions',
    '/:bindingId/source/segments', '/:bindingId/source/snapshots', '/:bindingId/source/acks'], unavailable);
  router.on('GET', ['/:bindingId/frames', '/:bindingId/history', '/:bindingId/status',
    '/:bindingId/snapshots/:snapshotId', '/:bindingId/keyboard/submissions/:idempotencyKey', '/:bindingId/source/control'], unavailable);
  router.on('DELETE', ['/:bindingId/keyboard/lease',
    '/:bindingId/history-authorizations/:authorizationId'], unavailable);
  router.put('/workspaces/:workspaceId/exclusion', unavailable);
  return router;
}
