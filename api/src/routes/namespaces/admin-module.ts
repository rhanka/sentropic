import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono } from 'hono';

import {
  ADMIN_APP_PATHS,
  ADMIN_ROUTES,
  ADMIN_TENANT_METRICS_PATHS,
  assertAdminPorts,
  createAdminTransportRouter,
  type AdminNamespacePorts,
} from './admin';
import {
  applyAdminAuthorFence,
  type AdminCutoverControl,
} from './admin-cutover';
import { productAdminPorts } from './admin-product-ports';

export {
  ADMIN_APP_PATHS,
  ADMIN_APP_ROUTES,
  ADMIN_PATHS,
  ADMIN_ROUTES,
  ADMIN_TENANT_METRICS_PATHS,
  createAdminTransportRouter,
} from './admin';
export { ADMIN_AUTHOR } from './admin-cutover';
export type { AdminNamespacePorts, AdminRouterPort } from './admin';

export interface CreateAdminNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly ports?: AdminNamespacePorts;
  readonly cutoverControl?: AdminCutoverControl;
}

export const createAdminNamespaceModule = (
  options: CreateAdminNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/admin',
  enabled: options.enabled ?? true,
  createRouter() {
    const ports = options.ports ?? productAdminPorts;
    assertAdminPorts(ports);
    const router = new Hono();
    for (const [method, path] of ADMIN_ROUTES) {
      router.on(method, path, ports.authenticate);
      if (ADMIN_APP_PATHS.includes(path)) router.on(method, path, ports.authorizeAppAdmin);
      if (ADMIN_TENANT_METRICS_PATHS.includes(
        path as typeof ADMIN_TENANT_METRICS_PATHS[number],
      )) router.on(method, path, ports.authorizeAdmin);
    }
    applyAdminAuthorFence(router, ADMIN_ROUTES, options.cutoverControl);
    router.route('/', createAdminTransportRouter(ports));
    return router;
  },
});

export const productAdminModule = createAdminNamespaceModule();
