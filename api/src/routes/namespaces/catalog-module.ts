import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono } from 'hono';

import {
  assertCatalogPorts,
  CATALOG_ROUTES,
  createCatalogTransportRouter,
  type CatalogNamespacePorts,
} from './catalog';
import { applyCatalogAuthorFence, type CatalogCutoverControl } from './catalog-cutover';
import { productCatalogPorts } from './catalog-product-ports';

export { CATALOG_PATHS, CATALOG_ROUTES, createCatalogTransportRouter } from './catalog';
export { CATALOG_AUTHOR, CATALOG_PREDECESSOR } from './catalog-cutover';
export type { CatalogDiscoveryPort, CatalogNamespacePorts } from './catalog';

export interface CreateCatalogNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly ports?: CatalogNamespacePorts;
  readonly cutoverControl?: CatalogCutoverControl;
}

export const createCatalogNamespaceModule = (
  options: CreateCatalogNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/catalog',
  enabled: options.enabled ?? true,
  createRouter() {
    const ports = options.ports ?? productCatalogPorts;
    assertCatalogPorts(ports);
    const router = new Hono();
    for (const [method, path] of CATALOG_ROUTES) {
      router.on(method, path, ports.authenticate);
    }
    applyCatalogAuthorFence(router, CATALOG_ROUTES, options.cutoverControl);
    router.route('/', createCatalogTransportRouter(ports));
    return router;
  },
});

export const productCatalogModule = createCatalogNamespaceModule();
