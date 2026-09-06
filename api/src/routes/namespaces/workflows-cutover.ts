import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export const WORKFLOWS_AUTHOR = 'workflows-hono-module';

export const WORKFLOW_PATHS = [
  '/plans',
  '/plans/:planId',
  '/plans/:planId/todos',
  '/todos/:todoId',
  '/todos/:todoId/tasks',
  '/todos/:todoId/assign',
  '/tasks/:taskId',
  '/tasks/:taskId/assign',
  '/tasks/:taskId/start',
  '/tasks/:taskId/complete',
  '/runs/:runId/pause',
  '/runs/:runId/resume',
  '/workflow-config',
  '/workflow-config/:id',
  '/workflow-config/:id/copy',
  '/workflow-config/:id/fork',
  '/workflow-config/:id/reset',
  '/workflow-config/:id/detach',
  '/workspace-types/:type/workflows',
  '/workspace-types/:type/workflows/:id',
  '/queue/jobs',
  '/queue/jobs/:id',
  '/queue/jobs/:id/stream-bootstrap',
  '/queue/jobs/:id/cancel',
  '/queue/jobs/:id/retry',
  '/queue/stats',
  '/queue/purge',
  '/queue/purge-global',
  '/queue/purge-mine',
  '/queue/pause',
  '/queue/resume',
  '/queue/cancel-all',
] as const;

export const WORKFLOW_ADMIN_PATHS = [
  '/workspace-types/:type/workflows',
  '/workspace-types/:type/workflows/:id',
] as const;

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh workflows cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureWorkflowsAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/workflows' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-workflows-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: WORKFLOWS_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'workflow-read-and-validated-transition-job-intent',
          safeReadRef: 'historical:47a8a5963:api/tests/api/cluster-mesh-workflows-cutover.test.ts',
          validatedIntentRef: 'historical:47a8a5963:api/tests/api/cluster-mesh-workflows-cutover.test.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-workflow-routes',
        },
      };
      await control.cutovers.activate(shadow);
      await control.cutovers.activate({
        ...shadow,
        status: 'active',
        activatedAt: new Date().toISOString(),
      });
    })().finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === WORKFLOWS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyWorkflowsAuthorFence = (router: Hono): void => {
  for (const path of WORKFLOW_PATHS) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureWorkflowsAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'workflows_control_unavailable' }, 503);
      }
    });
  }
};
