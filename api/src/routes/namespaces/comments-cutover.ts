import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export const COMMENTS_AUTHOR = 'comments-hono-module';

export const COMMENTS_PATHS = [
  '/comments',
  '/comments/:id',
  '/comments/:id/close',
  '/comments/:id/reopen',
] as const;

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh comments cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureCommentsAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/comments' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-comments-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: COMMENTS_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'comment-read-and-validated-mutation-intent',
          safeReadRef: 'historical:4d3e251c4:api/tests/api/cluster-mesh-comments-cutover.test.ts',
          validatedIntentRef: 'historical:4d3e251c4:api/tests/api/cluster-mesh-comments-cutover.test.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-comments-router',
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
    && record.activeAuthor === COMMENTS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyCommentsAuthorFence = (router: Hono): void => {
  for (const path of COMMENTS_PATHS) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureCommentsAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'comments_control_unavailable' }, 503);
      }
    });
  }
};
