import { zValidator } from '@hono/zod-validator';
import type { Hono } from 'hono';

import {
  acquireLockSchema,
  isLocksHttpError,
  lockScopeSchema,
  requestUnlockSchema,
} from './locks-contracts';
import type { LocksNamespacePorts } from './locks-ports';
import { lockPrincipal, lockScope, requireLocksAccess } from './locks-route-helpers';

export const registerLocksMutationRoutes = (
  router: Hono,
  ports: LocksNamespacePorts,
): void => {
  const requireEditor = requireLocksAccess(ports, 'editor');
  router.get('/locks', zValidator('query', lockScopeSchema), async (context) => {
    const principal = lockPrincipal(context);
    return context.json({
      lock: await ports.locks.read(lockScope(principal, context.req.valid('query'))),
    });
  });
  router.post('/locks', requireEditor, zValidator('json', acquireLockSchema), async (context) => {
    const principal = lockPrincipal(context);
    const body = context.req.valid('json');
    const result = await ports.locks.acquire({
      ...lockScope(principal, body),
      userId: principal.userId,
      ttlMs: body.ttlMs,
    });
    return result.acquired ? context.json(result, 201) : context.json(result, 409);
  });
  router.delete('/locks', requireEditor, zValidator('query', lockScopeSchema), async (context) => {
    const principal = lockPrincipal(context);
    try {
      return context.json(await ports.locks.release({
        ...lockScope(principal, context.req.valid('query')),
        userId: principal.userId,
      }));
    } catch (error) {
      if (isLocksHttpError(error) && error.status === 403) {
        return context.json({ error: 'Insufficient permissions' }, 403);
      }
      throw error;
    }
  });
  router.post('/locks/request-unlock', requireEditor, zValidator('json', requestUnlockSchema), async (context) => {
    const principal = lockPrincipal(context);
    const body = context.req.valid('json');
    try {
      return context.json(await ports.locks.requestUnlock({
        ...lockScope(principal, body),
        userId: principal.userId,
        message: body.message,
      }));
    } catch (error) {
      if (isLocksHttpError(error) && error.status === 409) {
        return context.json({ error: 'Unlock already requested' }, 409);
      }
      throw error;
    }
  });
  router.post('/locks/accept-unlock', requireEditor, zValidator('json', lockScopeSchema), async (context) => {
    const principal = lockPrincipal(context);
    try {
      return context.json(await ports.locks.acceptUnlock({
        ...lockScope(principal, context.req.valid('json')),
        userId: principal.userId,
      }));
    } catch (error) {
      if (isLocksHttpError(error) && error.status === 403) {
        return context.json({ error: 'Insufficient permissions' }, 403);
      }
      throw error;
    }
  });
  router.post(
    '/locks/force-unlock',
    requireLocksAccess(ports, 'admin'),
    zValidator('json', lockScopeSchema),
    async (context) => {
      const principal = lockPrincipal(context);
      try {
        return context.json(await ports.locks.forceUnlock({
          ...lockScope(principal, context.req.valid('json')),
          userId: principal.userId,
        }));
      } catch (error) {
        if (isLocksHttpError(error) && error.status === 403) {
          return context.json({ error: 'Insufficient permissions' }, 403);
        }
        throw error;
      }
    },
  );
};
