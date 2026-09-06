import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../../middleware/auth';
import { applyBusinessAuthorFence } from './cutover';
import type { BusinessNamespacePorts } from './ports';
import { productBusinessPorts } from './product-ports';
import { BUSINESS_PATHS, createBusinessTransportRouter } from './router';

export { BUSINESS_PATHS, createBusinessTransportRouter } from './router';
export type { BusinessNamespacePorts, BusinessRouterPort } from './ports';

export interface CreateBusinessNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly ports?: BusinessNamespacePorts;
}

export const createBusinessNamespaceModule = (
  options: CreateBusinessNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/business',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const path of BUSINESS_PATHS) router.use(path, options.authenticate ?? requireAuth);
    applyBusinessAuthorFence(router, BUSINESS_PATHS);
    router.route('/', createBusinessTransportRouter(options.ports ?? productBusinessPorts));
    return router;
  },
});

export const productBusinessModule = createBusinessNamespaceModule();
