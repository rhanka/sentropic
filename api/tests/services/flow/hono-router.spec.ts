import { createFlowRouter, type FlowHonoRouterPort } from '@sentropic/flow/hono';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

const port = (name: string): FlowHonoRouterPort => {
  const router = new Hono();
  router.all('*', (context) => context.json({ name, path: context.req.path }));
  return { router };
};

describe('flow Hono router', () => {
  it('routes every workflow surface through its injected port', async () => {
    const definitions = {
      workflowConfigRouter: port('definition').router,
      workspaceTypeWorkflowsRouter: port('workspace-type-definition').router,
    };
    const router = createFlowRouter({
      plan: port('plan'),
      todo: port('todo'),
      task: port('task'),
      run: port('run'),
      definition: definitions,
      queue: port('queue'),
    });
    const paths = [
      ['/plans/plan-1', 'plan'],
      ['/todos/todo-1', 'todo'],
      ['/tasks/task-1', 'task'],
      ['/runs/run-1', 'run'],
      ['/workflow-config/config-1', 'definition'],
      ['/workspace-types/code/workflows', 'workspace-type-definition'],
      ['/queue/jobs/job-1', 'queue'],
    ] as const;

    for (const [path, name] of paths) {
      const response = await router.request(path);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ name });
    }
  });

  it('does not add a second public workflows prefix', async () => {
    const empty = port('unused');
    const router = createFlowRouter({
      plan: empty,
      todo: empty,
      task: empty,
      run: empty,
      definition: {
        workflowConfigRouter: empty.router,
        workspaceTypeWorkflowsRouter: empty.router,
      },
      queue: empty,
    });

    expect((await router.request('/workflows/plans')).status).toBe(404);
  });
});
