import { Hono } from 'hono';

export interface FlowHonoRouterPort {
  readonly router: Hono;
}

export interface FlowDefinitionHonoPort {
  readonly workflowConfigRouter: Hono;
  readonly workspaceTypeWorkflowsRouter: Hono;
}

export interface CreateFlowRouterOptions {
  readonly plan: FlowHonoRouterPort;
  readonly todo: FlowHonoRouterPort;
  readonly task: FlowHonoRouterPort;
  readonly run: FlowHonoRouterPort;
  readonly definition: FlowDefinitionHonoPort;
  readonly queue: FlowHonoRouterPort;
}

export const createFlowRouter = (ports: CreateFlowRouterOptions): Hono => {
  const router = new Hono();
  router.route('/plans', ports.plan.router);
  router.route('/todos', ports.todo.router);
  router.route('/tasks', ports.task.router);
  router.route('/runs', ports.run.router);
  router.route('/workflow-config', ports.definition.workflowConfigRouter);
  router.route('/workspace-types', ports.definition.workspaceTypeWorkflowsRouter);
  router.route('/queue', ports.queue.router);
  return router;
};
