import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export const LOCKS_AUTHOR = 'locks-collaboration-hono-module';

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh locks cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureLocksAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/locks' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-locks-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: LOCKS_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'safe-read-and-validated-mutation-intent',
          safeReadRef: 'historical:c0cccdc18:api/tests/api/locks.test.ts;candidate:f63c9e8cf:api/tests/api/cluster-mesh-locks-cutover.test.ts',
          validatedIntentRef: 'historical:f63c9e8cf:api/tests/api/cluster-mesh-locks-cutover.test.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-locks-router',
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
    && record.activeAuthor === LOCKS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyLocksAuthorFence = (router: Hono, paths: readonly string[]): void => {
  for (const path of paths) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureLocksAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'locks_control_unavailable' }, 503);
      }
    });
  }
};
