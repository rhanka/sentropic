import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../../services/cluster-mesh-adapter';

export const BUSINESS_AUTHOR = 'business-domain-hono-module';

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh business cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureBusinessAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/business' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-business-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: BUSINESS_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'safe-read-and-validated-mutation-intent',
          safeReadRef: 'historical:36a93f2b0:api/tests/api/companies.test.ts;candidate:api/tests/api/cluster-mesh-business-cutover.test.ts',
          validatedIntentRef: 'candidate:api/tests/api/cluster-mesh-business-cutover.test.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-business-routers',
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
    && record.activeAuthor === BUSINESS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyBusinessAuthorFence = (router: Hono, paths: readonly string[]): void => {
  for (const path of paths) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureBusinessAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'business_control_unavailable' }, 503);
      }
    });
  }
};
