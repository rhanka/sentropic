import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import {
  createFlowRouter,
  type CreateFlowRouterOptions,
} from '@sentropic/flow/hono';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';
import { workflowConfigRouter, workspaceTypeWorkflowsRouter } from './workflows-definition';
import { plansRouter } from './workflows-plan';
import queueRouter from './workflows-queue';
import { runsRouter } from './workflows-run';
import { tasksRouter } from './workflows-task';
import { todosRouter } from './workflows-todo';
import { applyWorkflowsAuthorFence, WORKFLOW_PATHS } from './workflows-cutover';

export const createProductFlowRouterPorts = (): CreateFlowRouterOptions => ({
  plan: { router: plansRouter },
  todo: { router: todosRouter },
  task: { router: tasksRouter },
  run: { router: runsRouter },
  definition: { workflowConfigRouter, workspaceTypeWorkflowsRouter },
  queue: { router: queueRouter },
});

export interface CreateWorkflowsNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly ports?: CreateFlowRouterOptions;
}

export const createWorkflowsNamespaceModule = (
  options: CreateWorkflowsNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/workflows',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const path of WORKFLOW_PATHS) {
      router.use(path, options.authenticate ?? requireAuth);
    }
    applyWorkflowsAuthorFence(router);
    router.route('/', createFlowRouter(options.ports ?? createProductFlowRouterPorts()));
    return router;
  },
});

export const productWorkflowsModule = createWorkflowsNamespaceModule();
