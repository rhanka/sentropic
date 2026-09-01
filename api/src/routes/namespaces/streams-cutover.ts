import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export const STREAMS_AUTHOR = 'streams-transport-hono-module';

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh streams cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureStreamsAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/streams' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-streams-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: STREAMS_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'envelope-cursor-replay-and-read-only-route-intent',
          safeReadRef: 'historical:0f3266c96:api/tests/api/cluster-mesh-streams-cutover.test.ts',
          validatedIntentRef: 'historical:0f3266c96:api/tests/api/cluster-mesh-streams-cutover.test.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-streams-router',
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
    && record.activeAuthor === STREAMS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyStreamsAuthorFence = (router: Hono, paths: readonly string[]): void => {
  for (const path of paths) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureStreamsAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'streams_control_unavailable' }, 503);
      }
    });
  }
};
