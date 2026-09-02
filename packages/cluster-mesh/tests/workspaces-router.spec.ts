import type { Handler } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  createWorkspacesRouter,
  WORKSPACE_PATHS,
  type WorkspaceHandlerChain,
  type WorkspacesRouterPorts,
} from '../src/index.js';

const fixture = () => {
  const dispatch = vi.fn<Handler>((context) => context.json({ path: context.req.path }));
  const chain = [dispatch] as WorkspaceHandlerChain;
  const ports: WorkspacesRouterPorts = {
    workspaces: {
      list: chain, create: chain, update: chain, updateGateConfig: chain,
      hide: chain, unhide: chain, remove: chain, listMembers: chain,
      listMentions: chain, addMember: chain, updateMember: chain, removeMember: chain,
    },
    tenants: {
      requestMembership: chain, listMemberships: chain, listClients: chain,
      approveMembership: chain, rejectMembership: chain, suspendMembership: chain,
    },
    neutral: { dashboard: chain },
  };
  return { dispatch, ports };
};

describe('workspace namespace transport', () => {
  it('registers only the explicit workspace, tenant, and neutral paths', () => {
    const { ports } = fixture();
    const router = createWorkspacesRouter(ports);
    const registered = [...new Set(router.routes.map(({ path }) => path))].sort();

    expect(registered).toEqual([...WORKSPACE_PATHS].sort());
    expect(router.routes.some(({ path }) => path === '/*')).toBe(false);
  });

  it.each([
    ['GET', '/workspaces'],
    ['PUT', '/workspaces/workspace-1'],
    ['POST', '/tenants/tenant-1/memberships'],
    ['GET', '/neutral/dashboard'],
  ])('delegates %s %s to an injected product port', async (method, path) => {
    const { dispatch, ports } = fixture();
    const response = await createWorkspacesRouter(ports).request(path, { method });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ path });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('fails closed when a product surface is unavailable', () => {
    const { ports } = fixture();
    expect(() => createWorkspacesRouter({
      ...ports,
      tenants: undefined as unknown as WorkspacesRouterPorts['tenants'],
    })).toThrowError('workspace product ports are unavailable');
  });
});
