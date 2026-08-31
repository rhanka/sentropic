import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export const AGENTS_AUTHOR = 'agents-hono-module';

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh agents cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureAgentsAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/agents' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-agents-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: AGENTS_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'agent-config-prompt-profile-read-and-validated-config-intent',
          safeReadRef: 'historical:b51d1503f:api/tests/api/cluster-mesh-agents-cutover.test.ts',
          validatedIntentRef: 'historical:b51d1503f:api/tests/api/cluster-mesh-agents-cutover.test.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-agent-routes',
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
    && record.activeAuthor === AGENTS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyAgentsAuthorFence = (router: Hono, paths: readonly string[]): void => {
  for (const path of paths) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureAgentsAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'agents_control_unavailable' }, 503);
      }
    });
  }
};
