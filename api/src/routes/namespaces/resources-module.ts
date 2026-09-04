import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono } from 'hono';

import {
  assertResourcesPorts,
  createResourcesTransportRouter,
  RESOURCE_ROUTES,
  type ResourcesNamespacePorts,
} from './resources';
import { applyResourcesAuthorFence, type ResourcesCutoverControl } from './resources-cutover';
import { productResourcesPorts } from './resources-product-ports';

export { RESOURCE_PATHS, RESOURCE_ROUTES, createResourcesTransportRouter } from './resources';
export { RESOURCES_AUTHOR, RESOURCES_PREDECESSOR } from './resources-cutover';
export type { ResourceProjectionPort, ResourcesNamespacePorts } from './resources';

export interface CreateResourcesNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly ports?: ResourcesNamespacePorts;
  readonly cutoverControl?: ResourcesCutoverControl;
}

export const createResourcesNamespaceModule = (
  options: CreateResourcesNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/resources',
  enabled: options.enabled ?? true,
  createRouter() {
    const ports = options.ports ?? productResourcesPorts;
    assertResourcesPorts(ports);
    const router = new Hono();
    for (const [method, path] of RESOURCE_ROUTES) router.on(method, path, ports.authenticate);
    applyResourcesAuthorFence(router, RESOURCE_ROUTES, options.cutoverControl);
    router.route('/', createResourcesTransportRouter(ports));
    return router;
  },
});

export const productResourcesModule = createResourcesNamespaceModule();
