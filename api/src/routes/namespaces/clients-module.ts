import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';
import { requireAdmin, requireEditor } from '../../middleware/rbac';
import {
  CLIENT_ADMIN_PATHS,
  CLIENT_EDITOR_PATHS,
  CLIENT_ROUTES,
  createClientsTransportRouter,
  type ClientsNamespacePorts,
} from './clients';
import {
  applyClientAuthorFence,
  type ClientsCutoverControl,
} from './clients-cutover';
import { productClientsPorts } from './clients-product-ports';

export {
  CLIENT_ADMIN_PATHS,
  CLIENT_EDITOR_PATHS,
  CLIENT_PATHS,
  CLIENT_ROUTES,
  createClientsTransportRouter,
} from './clients';
export { CLIENT_AUTHOR } from './clients-cutover';
export type { ClientRouterPort, ClientsNamespacePorts } from './clients';

export interface CreateClientsNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly authorizeAdmin?: MiddlewareHandler;
  readonly authorizeEditor?: MiddlewareHandler;
  readonly ports?: ClientsNamespacePorts;
  readonly cutoverControl?: ClientsCutoverControl;
}

export const createClientsNamespaceModule = (
  options: CreateClientsNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/clients',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const [method, path] of CLIENT_ROUTES) {
      router.on(method, path, options.authenticate ?? requireAuth);
      if (CLIENT_ADMIN_PATHS.includes(path as typeof CLIENT_ADMIN_PATHS[number])) {
        router.on(method, path, options.authorizeAdmin ?? requireAdmin);
      }
      if (CLIENT_EDITOR_PATHS.includes(path as typeof CLIENT_EDITOR_PATHS[number])) {
        router.on(method, path, options.authorizeEditor ?? requireEditor);
      }
    }
    applyClientAuthorFence(router, CLIENT_ROUTES, options.cutoverControl);
    router.route('/', createClientsTransportRouter(options.ports ?? productClientsPorts));
    return router;
  },
});

export const productClientsModule = createClientsNamespaceModule();
