import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export const LLM_MESH_AUTHOR = 'llm-mesh-hono-module';

const LLM_MESH_PATHS = [
  '/models/catalog',
  '/models/provider-readiness',
  '/me/ai-settings',
  '/provider-connections',
  '/provider-connections/openai/mode',
  '/provider-connections/:providerId/enrollment/:action',
] as const;

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh llm-mesh cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureLlmMeshAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/llm-mesh' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-llm-mesh-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: LLM_MESH_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'catalog-account-availability-and-validated-enrollment-intent',
          safeReadRef: 'api/tests/api/cluster-mesh-llm-mesh-cutover.test.ts',
          validatedIntentRef: 'api/tests/api/cluster-mesh-llm-mesh-cutover.test.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-llm-mesh-routes',
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
    && record.activeAuthor === LLM_MESH_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyLlmMeshAuthorFence = (router: Hono): void => {
  for (const path of LLM_MESH_PATHS) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureLlmMeshAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'llm_mesh_control_unavailable' }, 503);
      }
    });
  }
};
