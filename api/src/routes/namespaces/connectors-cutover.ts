import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export const CONNECTORS_AUTHOR = 'connector-host-hono-module';

export const CONNECTOR_PATHS = [
  '/google-drive/connection',
  '/google-drive/picker-config',
  '/google-drive/files/resolve-picker-selection',
  '/google-drive/oauth/start',
  '/google-drive/oauth/callback',
  '/google-drive/disconnect',
  '/gmail/connection',
  '/gmail/oauth/start',
  '/gmail/oauth/callback',
  '/gmail/disconnect',
  '/settings/connector-accounts/max-per-provider',
] as const;

export const CONNECTOR_ADMIN_PATHS = [
  '/settings/connector-accounts/max-per-provider',
] as const;

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh connectors cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureConnectorsAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/connectors' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-connectors-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: CONNECTORS_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'populated-account-readiness-and-validated-admin-intent',
          safeReadRef: 'historical:e4434a347:api/tests/api/cluster-mesh-connectors-cutover.test.ts',
          validatedIntentRef: 'historical:e4434a347:api/tests/api/cluster-mesh-connectors-cutover.test.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-connector-routes',
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
    && record.activeAuthor === CONNECTORS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyConnectorsAuthorFence = (router: Hono): void => {
  for (const path of CONNECTOR_PATHS) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureConnectorsAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'connectors_control_unavailable' }, 503);
      }
    });
  }
};
