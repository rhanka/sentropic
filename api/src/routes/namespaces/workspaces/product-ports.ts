import type {
  WorkspaceHandlerChain,
  WorkspacesRouterPorts,
} from '@sentropic/cluster-mesh';
import type { Hono } from 'hono';

import { requireEditor } from '../../../middleware/rbac';
import { neutralRouter } from './product-neutral';
import { cmTenantPorts } from './cm-tenant-ports';
import { cmMemberPorts } from './cm-member-ports';
import { workspacesRouter } from './product-workspaces';

const handlers = (router: Hono, method: string, path: string): WorkspaceHandlerChain => {
  const chain = router.routes
    .filter((route) => route.method === method && route.path === path)
    .map(({ handler }) => handler)
    .filter((handler) => handler !== requireEditor);
  if (chain.length === 0) {
    throw new Error(`workspace product handler is unavailable: ${method} ${path}`);
  }
  return chain as unknown as WorkspaceHandlerChain;
};

export const productWorkspacePorts: WorkspacesRouterPorts = {
  workspaces: {
    list: handlers(workspacesRouter, 'GET', '/'),
    create: handlers(workspacesRouter, 'POST', '/'),
    update: handlers(workspacesRouter, 'PUT', '/:id'),
    updateGateConfig: handlers(workspacesRouter, 'PATCH', '/:id/gate-config'),
    hide: handlers(workspacesRouter, 'POST', '/:id/hide'),
    unhide: handlers(workspacesRouter, 'POST', '/:id/unhide'),
    remove: handlers(workspacesRouter, 'DELETE', '/:id'),
    ...cmMemberPorts,
  },
  tenants: cmTenantPorts,
  neutral: { dashboard: handlers(neutralRouter, 'GET', '/dashboard') },
};
