import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono } from 'hono';

import {
  APP_ROUTES,
  assertAppsPorts,
  createAppsTransportRouter,
  type AppsNamespacePorts,
} from './apps';
import { applyAppsAuthorFence, type AppsCutoverControl } from './apps-cutover';
import { productAppsPorts } from './apps-product-ports';

export { APP_PATHS, APP_ROUTES, createAppsTransportRouter } from './apps';
export { APPS_AUTHOR } from './apps-cutover';
export type { AppsControlPlanePort, AppsNamespacePorts } from './apps';

export interface CreateAppsNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly ports?: AppsNamespacePorts;
  readonly cutoverControl?: AppsCutoverControl;
}

export const createAppsNamespaceModule = (
  options: CreateAppsNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/apps',
  enabled: options.enabled ?? true,
  createRouter() {
    const ports = options.ports ?? productAppsPorts;
    assertAppsPorts(ports);
    const router = new Hono();
    for (const [method, path] of APP_ROUTES) {
      router.on(method, path, ports.authenticate);
      router.on(method, path, ports.authorizeAdminApp);
    }
    applyAppsAuthorFence(router, APP_ROUTES, options.cutoverControl);
    router.route('/', createAppsTransportRouter(ports));
    return router;
  },
});

export const productAppsModule = createAppsNamespaceModule();
