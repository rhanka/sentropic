import {
  createWorkspacesRouter,
  WORKSPACE_PATHS,
  type ClusterMeshHonoNamespaceModule,
  type WorkspacesRouterPorts,
} from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../../middleware/auth';
import { requireEditor } from '../../../middleware/rbac';
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

const WORKSPACE_EDITOR_ROUTES = [
  ['POST', '/workspaces'],
  ['PUT', '/workspaces/:id'],
  ['PATCH', '/workspaces/:id/gate-config'],
  ['POST', '/workspaces/:id/hide'],
  ['POST', '/workspaces/:id/unhide'],
  ['DELETE', '/workspaces/:id'],
  ['POST', '/workspaces/:id/members'],
  ['PATCH', '/workspaces/:id/members/:userId'],
  ['PUT', '/workspaces/:id/members/:userId'],
  ['DELETE', '/workspaces/:id/members/:userId'],
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
    for (const [method, path] of WORKSPACE_EDITOR_ROUTES) {
      router.on(method, path, requireEditor);
    }
    applyWorkspacesAuthorFence(router, WORKSPACE_PATHS);
    router.route('/', createWorkspacesRouter(options.ports ?? productWorkspacePorts));
    return router;
  },
});

export const productWorkspacesModule = createWorkspacesNamespaceModule();
