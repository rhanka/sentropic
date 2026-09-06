import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { createCommentsRouter, type CreateCommentsRouterOptions } from '@sentropic/comments/hono';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';
import { applyCommentsAuthorFence, COMMENTS_PATHS } from './comments-cutover';
import { createProductCommentsRouterOptions } from './comments-ports';

export interface CreateCommentsNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly routerOptions?: CreateCommentsRouterOptions;
}

export const createCommentsNamespaceModule = (
  options: CreateCommentsNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/comments',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const path of COMMENTS_PATHS) {
      router.use(path, options.authenticate ?? requireAuth);
    }
    applyCommentsAuthorFence(router);
    router.route('/', createCommentsRouter(
      options.routerOptions ?? createProductCommentsRouterOptions(),
    ));
    return router;
  },
});

export const productCommentsModule = createCommentsNamespaceModule();
