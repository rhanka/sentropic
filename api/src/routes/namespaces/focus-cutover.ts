import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export const FOCUS_AUTHOR = 'focus-hono-module';

const FOCUS_PATHS = [
  '/decisions/:decisionId',
  '/owner-signatures',
] as const;

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh focus cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureFocusAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/focus' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-focus-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: FOCUS_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'pre-deletion-shadow-suite',
          safeReadRef: 'api/tests/api/cluster-mesh-focus-cutover.test.ts',
          validatedIntentRef: 'api/tests/unit/focus-owner-signature-route.test.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-focus-router',
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
    && record.activeAuthor === FOCUS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyFocusAuthorFence = (router: Hono): void => {
  for (const path of FOCUS_PATHS) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureFocusAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'focus_control_unavailable' }, 503);
      }
    });
  }
};
