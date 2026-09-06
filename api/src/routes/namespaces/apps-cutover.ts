import { Hono, type MiddlewareHandler } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import type { APP_ROUTES } from './apps';

export const APPS_AUTHOR = 'apps-hono-module';

type AppsRoute = (typeof APP_ROUTES)[number];

export interface AppsCutoverControl {
  readonly runtime: { readonly generation: { readonly generationId: string } };
  readonly cutovers: {
    find(key: { compositionRoot: 'product'; namespace: '/apps' }): Promise<{
      status: string;
      activeAuthor: string;
      selectedGenerationId: string;
      shadowComparison?: unknown;
    } | null>;
    activate(record: Record<string, unknown>): Promise<unknown>;
  };
}

const productControl = clusterMeshAdapter.sessionControl as AppsCutoverControl | undefined;
if (!productControl) throw new Error('cluster mesh apps cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureAppsAuthor = async (control: AppsCutoverControl): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/apps' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= control.cutovers.activate({
      ...key,
      selectedGenerationId: control.runtime.generation.generationId,
      previousGenerationId: 'pre-http-app-control-service-v1',
      activeAuthor: APPS_AUTHOR,
      status: 'active',
      rollbackCheckpoint: {
        generationId: 'pre-http-app-control-service-v1',
        activeAuthor: 'no-apps-http-author',
      },
      activatedAt: new Date().toISOString(),
    }).then(() => undefined).finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === APPS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const createAppsAuthorFence = (
  control: AppsCutoverControl,
): MiddlewareHandler => async (context, next) => {
  try {
    if (!await ensureAppsAuthor(control)) return context.json({ error: 'wrong_author' }, 503);
    await next();
  } catch {
    return context.json({ error: 'apps_control_unavailable' }, 503);
  }
};

export const appsAuthorFence = createAppsAuthorFence(productControl);

export const applyAppsAuthorFence = (
  router: Hono,
  routes: readonly AppsRoute[],
  control?: AppsCutoverControl,
): void => {
  const handler = control ? createAppsAuthorFence(control) : appsAuthorFence;
  for (const [method, path] of routes) router.on(method, path, handler);
};
