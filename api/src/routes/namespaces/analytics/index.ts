import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../../middleware/auth';
import { requireEditor } from '../../../middleware/rbac';
import { applyAnalyticsAuthorFence } from './cutover';
import type { AnalyticsNamespacePorts } from './ports';
import { productAnalyticsPorts } from './product-ports';
import { ANALYTICS_PATHS, createAnalyticsTransportRouter } from './router';

export { ANALYTICS_AUTHOR } from './cutover';
export type { AnalyticsNamespacePorts } from './ports';
export { ANALYTICS_PATHS, createAnalyticsTransportRouter } from './router';

export const ANALYTICS_EDITOR_PATHS = ['/analytics/executive-summary'] as const;

export interface CreateAnalyticsNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly authorizeEditor?: MiddlewareHandler;
  readonly ports?: AnalyticsNamespacePorts;
}

export const createAnalyticsNamespaceModule = (
  options: CreateAnalyticsNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/analytics',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const path of ANALYTICS_PATHS) {
      router.use(path, options.authenticate ?? requireAuth);
    }
    for (const path of ANALYTICS_EDITOR_PATHS) {
      router.use(path, options.authorizeEditor ?? requireEditor);
    }
    applyAnalyticsAuthorFence(router, ANALYTICS_PATHS);
    router.route('/', createAnalyticsTransportRouter(options.ports ?? productAnalyticsPorts));
    return router;
  },
});

export const productAnalyticsModule = createAnalyticsNamespaceModule();
