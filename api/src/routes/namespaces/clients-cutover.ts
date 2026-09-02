import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import type { CLIENT_ROUTES } from './clients';

export const CLIENT_AUTHOR = 'clients-hono-module';

type ClientRoute = (typeof CLIENT_ROUTES)[number];

export interface ClientsCutoverControl {
  readonly runtime: { readonly generation: { readonly generationId: string } };
  readonly cutovers: {
    find(key: { compositionRoot: 'product'; namespace: '/clients' }): Promise<{
      status: string;
      activeAuthor: string;
      selectedGenerationId: string;
      shadowComparison?: unknown;
    } | null>;
    activate(record: Record<string, unknown>): Promise<unknown>;
  };
}

const productControl = clusterMeshAdapter.sessionControl as ClientsCutoverControl | undefined;
if (!productControl) throw new Error('cluster mesh client cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureClientAuthor = async (control: ClientsCutoverControl): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/clients' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= control.cutovers.activate({
      ...key,
      selectedGenerationId: control.runtime.generation.generationId,
      previousGenerationId: 'legacy-api-clients-v1',
      activeAuthor: CLIENT_AUTHOR,
      status: 'active',
      rollbackCheckpoint: {
        generationId: 'legacy-api-clients-v1',
        activeAuthor: 'legacy-api-client-routers',
      },
      activatedAt: new Date().toISOString(),
    }).then(() => undefined).finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === CLIENT_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyClientAuthorFence = (
  router: Hono,
  routes: readonly ClientRoute[],
  control: ClientsCutoverControl = productControl,
): void => {
  for (const [method, path] of routes) {
    router.on(method, path, async (context, next) => {
      try {
        if (!await ensureClientAuthor(control)) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'client_control_unavailable' }, 503);
      }
    });
  }
};
