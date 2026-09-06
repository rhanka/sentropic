import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../../services/cluster-mesh-adapter';

export const WORKSPACES_AUTHOR = 'workspaces-hono-module';

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh workspace cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureWorkspacesAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/workspaces' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-workspaces-v1';
      await control.cutovers.activate({
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: WORKSPACES_AUTHOR,
        status: 'active',
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-workspaces-router',
        },
        activatedAt: new Date().toISOString(),
      });
    })().finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === WORKSPACES_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyWorkspacesAuthorFence = (router: Hono, paths: readonly string[]): void => {
  for (const path of paths) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureWorkspacesAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'workspace_control_unavailable' }, 503);
      }
    });
  }
};
