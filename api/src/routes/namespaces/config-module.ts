import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/rbac';
import {
  applyConfigAuthorFence,
  type ConfigCutoverControl,
} from './config-cutover';
import { productConfigPorts } from './config-product-ports';
import {
  CONFIG_ROUTES,
  createConfigTransportRouter,
  type ConfigNamespacePorts,
} from './config';

export {
  CONFIG_ADMIN_PATHS,
  CONFIG_PATHS,
  CONFIG_ROUTES,
  createConfigTransportRouter,
} from './config';
export { CONFIG_AUTHOR } from './config-cutover';
export type { ConfigNamespacePorts, ConfigRouterPort } from './config';

export interface CreateConfigNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly authorizeAdmin?: MiddlewareHandler;
  readonly ports?: ConfigNamespacePorts;
  readonly cutoverControl?: ConfigCutoverControl;
}

export const createConfigNamespaceModule = (
  options: CreateConfigNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/config',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const [method, path] of CONFIG_ROUTES) {
      router.on(method, path, options.authenticate ?? requireAuth);
      if (path !== '/me') router.on(method, path, options.authorizeAdmin ?? requireAdmin);
    }
    applyConfigAuthorFence(router, CONFIG_ROUTES, options.cutoverControl);
    router.route('/', createConfigTransportRouter(options.ports ?? productConfigPorts));
    return router;
  },
});

export const productConfigModule = createConfigNamespaceModule();
