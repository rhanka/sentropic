import type { Context, MiddlewareHandler } from 'hono';

import type {
  LockAccessLevel,
  LockPrincipal,
  LockRouteObjectType,
  LockScope,
  LocksNamespacePorts,
} from './locks-ports';

export const lockPrincipal = (context: Context): LockPrincipal =>
  context.get('user') as LockPrincipal;

export const lockScope = (
  principal: LockPrincipal,
  value: { objectType: LockRouteObjectType; objectId: string },
): LockScope => ({
  workspaceId: principal.workspaceId,
  objectType: value.objectType,
  objectId: value.objectId,
});

export const requireLocksAccess = (
  ports: LocksNamespacePorts,
  required: LockAccessLevel,
): MiddlewareHandler => async (context, next) => {
  const principal = context.get('user') as LockPrincipal | undefined;
  if (!principal) return context.json({ error: 'Authentication required' }, 401);
  if (!await ports.authorization.permits(principal, required)) {
    return context.json({ error: 'Insufficient permissions' }, 403);
  }
  await next();
};
