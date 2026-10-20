import { Hono } from 'hono';
import { validateCapacityDescriptor } from '@sentropic/comments';
import type { CanonicalRouterFactory, CanonicalLifecycleRequest, CanonicalReadSelection } from '@sentropic/comments';
import { commentsRouterBinding } from '../comments/router-binding.js';
import type { CommentsRevisionRequest } from '../comments/command-contracts.js';
import { commentsHttpError, readCommentsHttpBody, assertCommentsHttpKeys, commentsHttpId, commentsHttpResponse } from '../comments/http-boundary.js';
import { checkCommentsHttpTargets, checkCommentsHttpDecision, commentsHttpRevisionTargets } from '../comments/http-authority.js';
export const createCanonicalCommentsRouter: CanonicalRouterFactory<Hono> = (ports, options) => {
  validateCapacityDescriptor(options.capacity);
  const binding = commentsRouterBinding(ports.store);
  if (!binding || typeof ports.capabilities?.check !== 'function' || typeof ports.resolver?.resolve !== 'function' || typeof ports.decisions?.resolve !== 'function') throw new Error('Canonical comments requires an operational module store and injected ports');
  const router = new Hono();
  router.onError((error, context) => { const wire = commentsHttpError(error); return context.json({ code: wire.code, message: 'Comments operation could not be completed' }, wire.status); });
  router.use('*', async (context, next) => {
    try { binding.context.current(); } catch { return context.json({ code: 'unauthenticated', message: 'Verified comments context is required' }, 401); }
    return next();
  });
  const families = [{ path: '/annotations', kind: 'annotation' }, { path: '/threads', kind: 'thread' }, { path: '', kind: 'comment' }] as const;
  for (const family of families) {
    const selection = (id: string): CanonicalReadSelection => family.kind === 'annotation' ? { kind: 'annotation-revisions', annotationId: id } : family.kind === 'thread' ? { kind: 'thread-structure-revisions', threadId: id } : { kind: 'comment-revisions', commentId: id };
    for (const suffix of ['', '/revisions'] as const) router.get(`${family.path}/:id${suffix}`, async (context) => {
      const id = commentsHttpId(context.req.param('id')); const scope = binding.context.current().grant.scope;
      const query = context.req.query(); assertCommentsHttpKeys(query, suffix ? ['limit', 'cursor'] : []);
      const limit = query.limit === undefined ? 50 : /^\d+$/.test(query.limit) ? Number(query.limit) : NaN;
      const result = await binding.services.read({ scope, selection: selection(id), ...(suffix ? { page: { limit, cursor: query.cursor ?? null } } : {}) });
      if (result !== null) await checkCommentsHttpTargets(ports, binding, 'read', await binding.services.targets({ scope, selection: selection(id), capability: 'read' }));
      return commentsHttpResponse(context, result);
    });
    for (const suffix of ['', '/:id/revisions'] as const) router.post(`${family.path}${suffix || (family.path ? '' : '/')}`, async (context) => {
      const body = await readCommentsHttpBody(context); assertCommentsHttpKeys(body, ['scope', 'content', 'expected', 'idempotencyKey', 'decisionRef']);
      const request = { ...body, kind: family.kind } as CommentsRevisionRequest;
      if (suffix) {
        const id = commentsHttpId(context.req.param('id'));
        const actual = request.kind === 'annotation' ? request.content.annotationId : request.kind === 'thread' ? request.content.threadId : request.content.commentId;
        if (actual !== id) throw new SyntaxError('Revision path identity differs');
      }
      const result = await ports.store.transaction().run(async () => {
        const authority = await commentsHttpRevisionTargets(binding, request);
        await checkCommentsHttpTargets(ports, binding, authority.capability, authority.targets);
        await checkCommentsHttpDecision(ports, binding, request, authority.capability);
        const record = await binding.services.revise(request);
        await checkCommentsHttpDecision(ports, binding, request, authority.capability);
        await checkCommentsHttpTargets(ports, binding, authority.capability, authority.targets); return record;
      });
      return commentsHttpResponse(context, result);
    });
    router.post(`${family.path}/:id/lifecycle`, async (context) => {
      const id = commentsHttpId(context.req.param('id')); const body = await readCommentsHttpBody(context);
      assertCommentsHttpKeys(body, ['scope', 'objectKind', 'objectId', 'action', 'archiveKind', 'reason', 'decisionRef', 'idempotencyKey', 'expected']);
      if (body.objectKind !== family.kind || body.objectId !== id) throw new SyntaxError('Lifecycle path identity differs');
      const request = body as CanonicalLifecycleRequest;
      if (!['archive', 'restore', 'tombstone', 'purge-intent'].includes(request.action)) throw new SyntaxError('Unsupported lifecycle command');
      const capability = request.action === 'purge-intent' ? 'purge' as const : request.action === 'tombstone' ? 'tombstone' as const : request.action === 'restore' ? 'shared-restore' as const : request.archiveKind === 'personal' ? 'personal-archive' as const : 'shared-archive' as const;
      const result = await ports.store.transaction().run(async () => {
        const targets = await binding.services.targets({ scope: request.scope, selection: selection(id), capability });
        await checkCommentsHttpTargets(ports, binding, capability, targets);
        await checkCommentsHttpDecision(ports, binding, request, request.action);
        const value = await binding.services.lifecycle(request);
        await checkCommentsHttpDecision(ports, binding, request, request.action);
        await checkCommentsHttpTargets(ports, binding, capability, targets); return value;
      });
      return commentsHttpResponse(context, result);
    });
  }
  return router;
};
