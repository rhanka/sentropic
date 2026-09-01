import { Hono } from 'hono';

import type { LocksNamespacePorts } from './locks-ports';
import { registerLocksMutationRoutes } from './locks-mutation-routes';
import { registerLocksPresenceRoutes } from './locks-presence-routes';
import { productLocksPorts } from './locks-product-ports';

export const LOCK_PATHS = [
  '/locks',
  '/locks/request-unlock',
  '/locks/accept-unlock',
  '/locks/force-unlock',
  '/locks/presence',
  '/locks/presence/leave',
] as const;

export const createLocksTransportRouter = (
  ports: LocksNamespacePorts = productLocksPorts,
): Hono => {
  const router = new Hono();
  registerLocksMutationRoutes(router, ports);
  registerLocksPresenceRoutes(router, ports);
  return router;
};
