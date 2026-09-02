import type {
  WorkspaceHandlerChain,
  WorkspacesRouterPorts,
} from '@sentropic/cluster-mesh';
import type { Hono } from 'hono';

import { neutralRouter } from './product-neutral';
import { tenantsRouter } from './product-tenants';
import { workspacesRouter } from './product-workspaces';

const handlers = (router: Hono, method: string, path: string): WorkspaceHandlerChain => {
  const chain = router.routes
    .filter((route) => route.method === method && route.path === path)
    .map(({ handler }) => handler);
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
    listMembers: handlers(workspacesRouter, 'GET', '/:id/members'),
    listMentions: handlers(workspacesRouter, 'GET', '/:id/members/mentions'),
    addMember: handlers(workspacesRouter, 'POST', '/:id/members'),
    updateMember: handlers(workspacesRouter, 'PATCH', '/:id/members/:userId'),
    removeMember: handlers(workspacesRouter, 'DELETE', '/:id/members/:userId'),
  },
  tenants: {
    requestMembership: handlers(tenantsRouter, 'POST', '/:tenantId/memberships'),
    listMemberships: handlers(tenantsRouter, 'GET', '/:tenantId/memberships'),
    listClients: handlers(tenantsRouter, 'GET', '/:tenantId/clients'),
    approveMembership: handlers(
      tenantsRouter, 'POST', '/:tenantId/memberships/:userId/approve',
    ),
    rejectMembership: handlers(
      tenantsRouter, 'POST', '/:tenantId/memberships/:userId/reject',
    ),
    suspendMembership: handlers(
      tenantsRouter, 'POST', '/:tenantId/memberships/:userId/suspend',
    ),
  },
  neutral: { dashboard: handlers(neutralRouter, 'GET', '/dashboard') },
};
