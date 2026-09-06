import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export type AuthCompositionRoot = 'product' | 'auth-idp';

export const AUTH_AUTHOR = 'auth-hono-identity-module';

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh auth cutover control is not configured');

const activations = new Map<AuthCompositionRoot, Promise<void>>();

const ensureAuthAuthor = async (compositionRoot: AuthCompositionRoot): Promise<boolean> => {
  const key = { compositionRoot, namespace: '/auth' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    let activation = activations.get(compositionRoot);
    if (!activation) {
      activation = (async () => {
        const previousGenerationId = `legacy-${compositionRoot}-auth-v1`;
        const shadow = {
          ...key,
          selectedGenerationId: control.runtime.generation.generationId,
          previousGenerationId,
          activeAuthor: AUTH_AUTHOR,
          status: 'shadow' as const,
          shadowComparison: {
            strategy: 'pre-deletion-shadow-suite',
            safeReadRef: 'historical:1918af23f:api/tests/api/cluster-mesh-auth-roots.test.ts',
            validatedIntentRef: 'packages/auth-hono/tests/router-factory.test.ts',
            effectsDuplicated: false,
          },
          rollbackCheckpoint: {
            generationId: previousGenerationId,
            activeAuthor: 'legacy-auth-router',
          },
        };
        await control.cutovers.activate(shadow);
        await control.cutovers.activate({
          ...shadow,
          status: 'active',
          activatedAt: new Date().toISOString(),
        });
      })().finally(() => activations.delete(compositionRoot));
      activations.set(compositionRoot, activation);
    }
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === AUTH_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyAuthAuthorFence = (
  router: Hono,
  compositionRoot: AuthCompositionRoot,
  paths: readonly string[],
): void => {
  for (const path of paths) {
    router.use(path, async (c, next) => {
      try {
        if (!await ensureAuthAuthor(compositionRoot)) {
          return c.json({ error: 'wrong_author' }, 503);
        }
        await next();
      } catch {
        return c.json({ error: 'auth_control_unavailable' }, 503);
      }
    });
  }
};
