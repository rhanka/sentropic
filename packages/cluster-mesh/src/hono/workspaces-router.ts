import { Hono, type Handler } from 'hono';

export type WorkspaceHandlerChain = readonly [Handler, ...Handler[]];

export interface WorkspacesRouterPorts {
  readonly workspaces: {
    readonly list: WorkspaceHandlerChain;
    readonly create: WorkspaceHandlerChain;
    readonly update: WorkspaceHandlerChain;
    readonly updateGateConfig: WorkspaceHandlerChain;
    readonly hide: WorkspaceHandlerChain;
    readonly unhide: WorkspaceHandlerChain;
    readonly remove: WorkspaceHandlerChain;
    readonly listMembers: WorkspaceHandlerChain;
    readonly listMentions: WorkspaceHandlerChain;
    readonly addMember: WorkspaceHandlerChain;
    readonly updateMember: WorkspaceHandlerChain;
    readonly removeMember: WorkspaceHandlerChain;
  };
  readonly tenants: {
    readonly requestMembership: WorkspaceHandlerChain;
    readonly listMemberships: WorkspaceHandlerChain;
    readonly listClients: WorkspaceHandlerChain;
    readonly approveMembership: WorkspaceHandlerChain;
    readonly rejectMembership: WorkspaceHandlerChain;
    readonly suspendMembership: WorkspaceHandlerChain;
  };
  readonly neutral: { readonly dashboard: WorkspaceHandlerChain };
}

export const WORKSPACE_PATHS = [
  '/workspaces',
  '/workspaces/:id',
  '/workspaces/:id/gate-config',
  '/workspaces/:id/hide',
  '/workspaces/:id/unhide',
  '/workspaces/:id/members',
  '/workspaces/:id/members/mentions',
  '/workspaces/:id/members/:userId',
  '/tenants/:tenantId/memberships',
  '/tenants/:tenantId/clients',
  '/tenants/:tenantId/memberships/:userId/approve',
  '/tenants/:tenantId/memberships/:userId/reject',
  '/tenants/:tenantId/memberships/:userId/suspend',
  '/neutral/dashboard',
] as const;

const assertPorts = (ports: WorkspacesRouterPorts): void => {
  const surfaces = [ports.workspaces, ports.tenants, ports.neutral];
  if (surfaces.some((surface) => !surface)
    || surfaces.some((surface) => Object.values(surface).some(
      (chain) => !Array.isArray(chain) || chain.length === 0,
    ))) {
    throw new Error('workspace product ports are unavailable');
  }
};

export const createWorkspacesRouter = (ports: WorkspacesRouterPorts): Hono => {
  assertPorts(ports);
  const router = new Hono();

  router.get('/workspaces', ...ports.workspaces.list);
  router.post('/workspaces', ...ports.workspaces.create);
  router.put('/workspaces/:id', ...ports.workspaces.update);
  router.patch('/workspaces/:id/gate-config', ...ports.workspaces.updateGateConfig);
  router.post('/workspaces/:id/hide', ...ports.workspaces.hide);
  router.post('/workspaces/:id/unhide', ...ports.workspaces.unhide);
  router.delete('/workspaces/:id', ...ports.workspaces.remove);
  router.get('/workspaces/:id/members', ...ports.workspaces.listMembers);
  router.get('/workspaces/:id/members/mentions', ...ports.workspaces.listMentions);
  router.post('/workspaces/:id/members', ...ports.workspaces.addMember);
  router.patch('/workspaces/:id/members/:userId', ...ports.workspaces.updateMember);
  router.put('/workspaces/:id/members/:userId', ...ports.workspaces.updateMember);
  router.delete('/workspaces/:id/members/:userId', ...ports.workspaces.removeMember);
  router.post('/tenants/:tenantId/memberships', ...ports.tenants.requestMembership);
  router.get('/tenants/:tenantId/memberships', ...ports.tenants.listMemberships);
  router.get('/tenants/:tenantId/clients', ...ports.tenants.listClients);
  router.post('/tenants/:tenantId/memberships/:userId/approve', ...ports.tenants.approveMembership);
  router.post('/tenants/:tenantId/memberships/:userId/reject', ...ports.tenants.rejectMembership);
  router.post('/tenants/:tenantId/memberships/:userId/suspend', ...ports.tenants.suspendMembership);
  router.get('/neutral/dashboard', ...ports.neutral.dashboard);

  return router;
};
