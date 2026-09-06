import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/rbac';
import { applyAgentsAuthorFence } from './agents-cutover';
import { createAgentConfigRouter } from './agents-config';
import { createProductAgentsPorts, type AgentsNamespacePorts } from './agents-ports';
import { createAgentPromptsRouter } from './agents-prompts';

export const AGENT_PATHS = [
  '/agent-config',
  '/agent-config/:id/copy',
  '/agent-config/:id/fork',
  '/agent-config/:id/reset',
  '/agent-config/:id',
  '/agent-config/:id/detach',
  '/prompts',
  '/prompts/test-tavily',
] as const;

export const AGENT_ADMIN_PATHS = ['/prompts', '/prompts/test-tavily'] as const;

export interface CreateAgentsNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly authorize?: MiddlewareHandler;
  readonly ports?: AgentsNamespacePorts;
}

export const createAgentsNamespaceModule = (
  options: CreateAgentsNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/agents',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    const ports = options.ports ?? createProductAgentsPorts();
    for (const path of AGENT_PATHS) {
      router.use(path, options.authenticate ?? requireAuth);
    }
    for (const path of AGENT_ADMIN_PATHS) {
      router.use(path, options.authorize ?? requireAdmin);
    }
    applyAgentsAuthorFence(router, AGENT_PATHS);
    router.route('/agent-config', createAgentConfigRouter(ports.flow));
    router.route('/prompts', createAgentPromptsRouter(ports));
    return router;
  },
});

export const productAgentsModule = createAgentsNamespaceModule();
