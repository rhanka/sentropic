import {
  createWorkspacesRouter,
  WORKSPACE_PATHS,
  type ClusterMeshHonoNamespaceModule,
  type WorkspacesRouterPorts,
} from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../../middleware/auth';
import { applyWorkspacesAuthorFence } from './cutover';
import { productWorkspacePorts } from './product-ports';

export { WORKSPACES_AUTHOR } from './cutover';
export { WORKSPACE_PATHS, createWorkspacesRouter } from '@sentropic/cluster-mesh';
export type { WorkspacesRouterPorts } from '@sentropic/cluster-mesh';

export const WORKSPACE_EDITOR_PATHS = [
  '/workspaces',
  '/workspaces/:id',
  '/workspaces/:id/gate-config',
  '/workspaces/:id/hide',
  '/workspaces/:id/unhide',
  '/workspaces/:id/members',
  '/workspaces/:id/members/:userId',
] as const;

export interface CreateWorkspacesNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly ports?: WorkspacesRouterPorts;
}

export const createWorkspacesNamespaceModule = (
  options: CreateWorkspacesNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/workspaces',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const path of WORKSPACE_PATHS) {
      router.use(path, options.authenticate ?? requireAuth);
    }
    applyWorkspacesAuthorFence(router, WORKSPACE_PATHS);
    router.route('/', createWorkspacesRouter(options.ports ?? productWorkspacePorts));
    return router;
  },
});

export const productWorkspacesModule = createWorkspacesNamespaceModule();
