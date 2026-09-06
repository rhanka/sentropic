import { zValidator } from '@hono/zod-validator';
import type { Hono } from 'hono';

import { lockScopeSchema } from './locks-contracts';
import type { LocksNamespacePorts } from './locks-ports';
import { lockPrincipal, lockScope, requireLocksAccess } from './locks-route-helpers';

export const registerLocksPresenceRoutes = (
  router: Hono,
  ports: LocksNamespacePorts,
): void => {
  const requireAccess = requireLocksAccess(ports, 'access');
  router.get('/locks/presence', requireAccess, zValidator('query', lockScopeSchema), async (context) => {
    const principal = lockPrincipal(context);
    return context.json(await ports.presence.list(lockScope(principal, context.req.valid('query'))));
  });
  router.post('/locks/presence', requireAccess, zValidator('json', lockScopeSchema), async (context) => {
    const principal = lockPrincipal(context);
    return context.json(await ports.presence.record({
      ...lockScope(principal, context.req.valid('json')),
      user: principal,
    }));
  });
  router.post('/locks/presence/leave', requireAccess, zValidator('json', lockScopeSchema), async (context) => {
    const principal = lockPrincipal(context);
    return context.json(await ports.presence.remove({
      ...lockScope(principal, context.req.valid('json')),
      userId: principal.userId,
    }));
  });
  router.delete('/locks/presence', requireAccess, zValidator('query', lockScopeSchema), async (context) => {
    const principal = lockPrincipal(context);
    return context.json(await ports.presence.remove({
      ...lockScope(principal, context.req.valid('query')),
      userId: principal.userId,
    }));
  });
};
