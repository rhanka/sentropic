import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';
import { applyLocksAuthorFence } from './locks-cutover';
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

export interface CreateLocksNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly ports?: LocksNamespacePorts;
}

export const createLocksNamespaceModule = (
  options: CreateLocksNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/locks',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const path of LOCK_PATHS) router.use(path, options.authenticate ?? requireAuth);
    applyLocksAuthorFence(router, LOCK_PATHS);
    router.route('/', createLocksTransportRouter(options.ports ?? productLocksPorts));
    return router;
  },
});

export const productLocksModule = createLocksNamespaceModule();
