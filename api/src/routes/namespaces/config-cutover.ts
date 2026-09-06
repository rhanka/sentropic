import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import type { CONFIG_ROUTES } from './config';

export const CONFIG_AUTHOR = 'config-hono-module';

type ConfigRoute = (typeof CONFIG_ROUTES)[number];

export interface ConfigCutoverControl {
  readonly runtime: { readonly generation: { readonly generationId: string } };
  readonly cutovers: {
    find(key: { compositionRoot: 'product'; namespace: '/config' }): Promise<{
      status: string;
      activeAuthor: string;
      selectedGenerationId: string;
      shadowComparison?: unknown;
    } | null>;
    activate(record: Record<string, unknown>): Promise<unknown>;
  };
}

const productControl = clusterMeshAdapter.sessionControl as ConfigCutoverControl | undefined;
if (!productControl) throw new Error('cluster mesh config cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureConfigAuthor = async (control: ConfigCutoverControl): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/config' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= control.cutovers.activate({
      ...key,
      selectedGenerationId: control.runtime.generation.generationId,
      previousGenerationId: 'legacy-api-config-v1',
      activeAuthor: CONFIG_AUTHOR,
      status: 'active',
      rollbackCheckpoint: {
        generationId: 'legacy-api-config-v1',
        activeAuthor: 'legacy-api-config-routers',
      },
      activatedAt: new Date().toISOString(),
    }).then(() => undefined).finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === CONFIG_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyConfigAuthorFence = (
  router: Hono,
  routes: readonly ConfigRoute[],
  control: ConfigCutoverControl = productControl,
): void => {
  for (const [method, path] of routes) {
    router.on(method, path, async (context, next) => {
      try {
        if (!await ensureConfigAuthor(control)) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'config_control_unavailable' }, 503);
      }
    });
  }
};
