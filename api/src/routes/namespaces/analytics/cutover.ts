import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../../services/cluster-mesh-adapter';

export const ANALYTICS_AUTHOR = 'analytics-hono-module';

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh analytics cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureAnalyticsAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/analytics' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-analytics-v1';
      await control.cutovers.activate({
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: ANALYTICS_AUTHOR,
        status: 'active',
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-analytics-router',
        },
        activatedAt: new Date().toISOString(),
      });
    })().finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === ANALYTICS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyAnalyticsAuthorFence = (router: Hono, paths: readonly string[]): void => {
  for (const path of paths) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureAnalyticsAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'analytics_control_unavailable' }, 503);
      }
    });
  }
};
